import { authorize, handle, readJsonBody, rest, PUBLIC_COLUMNS, TABLE } from './_lib.js';

export default handle(async (req, res) => {
  if (!authorize(req, res)) return;

  if (req.method === 'GET') {
    const items = await rest(
      `${TABLE}?select=${PUBLIC_COLUMNS}&order=checklist_id.asc`
    );
    res.status(200).json({ items });
    return;
  }

  // One-time import of checkoffs that predate Supabase, when they lived in
  // the browser's localStorage. Only ticks boxes — never unticks — so running
  // it twice, or after real progress exists, can't lose anything.
  if (req.method === 'POST') {
    const { recorded_ids: ids } = await readJsonBody(req);
    if (!Array.isArray(ids)) {
      res.status(400).json({ error: 'recorded_ids must be an array.' });
      return;
    }
    const clean = [...new Set(ids.filter(Number.isInteger))];
    if (!clean.length) {
      res.status(200).json({ imported: 0, items: await rest(`${TABLE}?select=${PUBLIC_COLUMNS}&order=checklist_id.asc`) });
      return;
    }

    // `is_recorded=eq.false` keeps the original recorded_at on anything already ticked.
    const updated = await rest(
      `${TABLE}?checklist_id=in.(${clean.join(',')})&is_recorded=eq.false&select=checklist_id`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { is_recorded: true, recorded_at: new Date().toISOString() },
      }
    );

    res.status(200).json({
      imported: updated.length,
      items: await rest(`${TABLE}?select=${PUBLIC_COLUMNS}&order=checklist_id.asc`),
    });
    return;
  }

  if (req.method === 'PATCH') {
    const { checklist_id: id, is_recorded: isRecorded, note } = await readJsonBody(req);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'checklist_id must be an integer.' });
      return;
    }

    const patch = {};
    if (typeof isRecorded === 'boolean') {
      patch.is_recorded = isRecorded;
      if (!isRecorded) {
        patch.recorded_at = null;
      } else {
        // Keep the first recorded date if she's re-ticking a box she'd unticked.
        const [current] = await rest(`${TABLE}?checklist_id=eq.${id}&select=recorded_at`);
        patch.recorded_at = current?.recorded_at ?? new Date().toISOString();
      }
    }
    if (note !== undefined) patch.note = note === '' ? null : String(note).slice(0, 2000);

    if (!Object.keys(patch).length) {
      res.status(400).json({ error: 'Nothing to update.' });
      return;
    }

    const [row] = await rest(
      `${TABLE}?checklist_id=eq.${id}&select=${PUBLIC_COLUMNS}`,
      { method: 'PATCH', body: patch, prefer: 'return=representation' }
    );
    if (!row) {
      res.status(404).json({ error: `No checklist item ${id}.` });
      return;
    }
    res.status(200).json({ item: row });
    return;
  }

  res.setHeader('Allow', 'GET, POST, PATCH');
  res.status(405).json({ error: `${req.method} not allowed.` });
});
