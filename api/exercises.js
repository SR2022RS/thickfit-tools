import {
  authorize, handle, readJsonBody, rest, storage,
  BUCKET, PUBLIC_COLUMNS, TABLE,
} from './_lib.js';

const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const LOCATIONS = ['Home', 'Gym', 'Both'];

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Shared validation for create and edit. Returns {fields} or {error}. */
function validate(body, { partial = false } = {}) {
  const name = clean(body.name, 120);
  const muscleGroup = clean(body.muscle_group, 60);
  const level = clean(body.level, 20);
  const equipment = clean(body.equipment, 60);
  const location = clean(body.location, 10);

  if (!partial || body.name !== undefined) {
    if (!name) return { error: 'Give the exercise a name.' };
  }
  if (!partial || body.muscle_group !== undefined) {
    if (!muscleGroup) return { error: 'Pick a muscle group.' };
  }
  if (level && !LEVELS.includes(level)) {
    return { error: `Level must be one of: ${LEVELS.join(', ')}.` };
  }
  if (location && !LOCATIONS.includes(location)) {
    return { error: `Where must be one of: ${LOCATIONS.join(', ')}.` };
  }

  const fields = {};
  if (name) fields.name = name;
  if (muscleGroup) fields.muscle_group = muscleGroup;
  if (level) fields.level = level;
  if (body.equipment !== undefined) fields.equipment = equipment || 'None';
  if (location) fields.location = location;
  return { fields };
}

/** Only exercises she added herself may be changed — the original 298 are locked. */
async function loadCustom(id, res) {
  const [row] = await rest(`${TABLE}?checklist_id=eq.${id}&select=checklist_id,is_custom,video_path`);
  if (!row) {
    res.status(404).json({ error: `No exercise ${id}.` });
    return null;
  }
  if (!row.is_custom) {
    res.status(403).json({
      error: 'That exercise is part of the original checklist and can\'t be edited or removed.',
    });
    return null;
  }
  return row;
}

const listAll = () => rest(`${TABLE}?select=${PUBLIC_COLUMNS}&order=checklist_id.asc`);

export default handle(async (req, res) => {
  if (!authorize(req, res)) return;

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    const { error, fields } = validate(body);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    // Reject a duplicate name outright rather than quietly creating a twin.
    const encoded = encodeURIComponent(fields.name.replace(/[(),*]/g, ' '));
    const existing = await rest(`${TABLE}?name=ilike.${encoded}&select=checklist_id,name`);
    if (existing.some(row => row.name.toLowerCase() === fields.name.toLowerCase())) {
      res.status(409).json({ error: `"${fields.name}" is already on the checklist.` });
      return;
    }

    const [row] = await rest(`${TABLE}?select=${PUBLIC_COLUMNS}`, {
      method: 'POST',
      prefer: 'return=representation',
      // checklist_id is left out on purpose — the sequence assigns it.
      body: {
        ...fields,
        level: fields.level || 'Beginner',
        equipment: fields.equipment || 'None',
        location: fields.location || 'Both',
        is_custom: true,
      },
    });

    res.status(201).json({ item: row, items: await listAll() });
    return;
  }

  if (req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const id = body.checklist_id;
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'checklist_id must be an integer.' });
      return;
    }
    if (!await loadCustom(id, res)) return;

    const { error, fields } = validate(body, { partial: true });
    if (error) {
      res.status(400).json({ error });
      return;
    }
    if (!Object.keys(fields).length) {
      res.status(400).json({ error: 'Nothing to update.' });
      return;
    }

    const [row] = await rest(`${TABLE}?checklist_id=eq.${id}&select=${PUBLIC_COLUMNS}`, {
      method: 'PATCH', prefer: 'return=representation', body: fields,
    });
    res.status(200).json({ item: row, items: await listAll() });
    return;
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query?.checklist_id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'checklist_id must be an integer.' });
      return;
    }
    const row = await loadCustom(id, res);
    if (!row) return;

    // Take the video with it, so the bucket doesn't keep orphans.
    if (row.video_path) {
      await storage(`object/${BUCKET}/${row.video_path}`, { method: 'DELETE' })
        .catch(error => console.error('Failed to remove video for deleted exercise:', error.message));
    }

    await rest(`${TABLE}?checklist_id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
    res.status(200).json({ deleted: id, items: await listAll() });
    return;
  }

  res.setHeader('Allow', 'POST, PATCH, DELETE');
  res.status(405).json({ error: `${req.method} not allowed.` });
});
