import {
  absoluteStorageUrl, authorize, handle, readJsonBody, rest, storage,
  BUCKET, PUBLIC_COLUMNS, TABLE,
} from './_lib.js';

/** Matches the bucket's file_size_limit, which is capped by the project's global 50 MB limit. */
const MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/x-matroska',
]);

/** Keep storage keys predictable and free of anything that needs escaping. */
function storageKey(id, filename) {
  const dot = filename.lastIndexOf('.');
  const ext = (dot > 0 ? filename.slice(dot + 1) : 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '');
  const stem = (dot > 0 ? filename.slice(0, dot) : filename)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'demo';
  return `${id}/${Date.now()}-${stem}.${ext || 'mp4'}`;
}

export default handle(async (req, res) => {
  if (!authorize(req, res)) return;

  // Step 1: hand the browser a signed URL so the video goes straight to Supabase.
  // Uploading through this function instead would hit Vercel's request body limit.
  if (req.method === 'POST') {
    const { checklist_id: id, filename, contentType, size } = await readJsonBody(req);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'checklist_id must be an integer.' });
      return;
    }
    if (!filename || typeof filename !== 'string') {
      res.status(400).json({ error: 'filename is required.' });
      return;
    }
    if (contentType && !ALLOWED_TYPES.has(contentType)) {
      res.status(415).json({
        error: `${contentType} is not an accepted video format. Use MP4, MOV, WebM or MKV.`,
      });
      return;
    }
    if (Number.isFinite(size) && size > MAX_BYTES) {
      res.status(413).json({
        error: `That file is ${(size / 1048576).toFixed(0)} MB. The limit is 50 MB.`,
      });
      return;
    }

    const path = storageKey(id, filename);
    const signed = await storage(`object/upload/sign/${BUCKET}/${path}`);
    res.status(200).json({ path, uploadUrl: absoluteStorageUrl(signed.url) });
    return;
  }

  // Step 2: the browser tells us the upload landed, and we record it.
  if (req.method === 'PATCH') {
    const { checklist_id: id, path, filename } = await readJsonBody(req);
    if (!Number.isInteger(id) || !path || !String(path).startsWith(`${id}/`)) {
      res.status(400).json({ error: 'checklist_id and a matching path are required.' });
      return;
    }

    const [previous] = await rest(`${TABLE}?checklist_id=eq.${id}&select=video_path`);
    const now = new Date().toISOString();
    const [row] = await rest(
      `${TABLE}?checklist_id=eq.${id}&select=${PUBLIC_COLUMNS}`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: {
          video_path: path,
          video_filename: filename ? String(filename).slice(0, 255) : null,
          video_uploaded_at: now,
          // Having a video is what "recorded" means, so tick the box too.
          is_recorded: true,
          recorded_at: now,
        },
      }
    );

    // Replacing a video: drop the old object so the bucket doesn't accumulate orphans.
    if (previous?.video_path && previous.video_path !== path) {
      await storage(`object/${BUCKET}/${previous.video_path}`, { method: 'DELETE' })
        .catch((error) => console.error('Failed to remove replaced video:', error.message));
    }

    res.status(200).json({ item: row });
    return;
  }

  if (req.method === 'DELETE') {
    const id = Number(req.query?.checklist_id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'checklist_id must be an integer.' });
      return;
    }

    const [current] = await rest(`${TABLE}?checklist_id=eq.${id}&select=video_path`);
    if (current?.video_path) {
      await storage(`object/${BUCKET}/${current.video_path}`, { method: 'DELETE' })
        .catch((error) => console.error('Failed to remove video:', error.message));
    }

    // The checkbox stays ticked — deleting a file shouldn't silently undo her progress.
    const [row] = await rest(
      `${TABLE}?checklist_id=eq.${id}&select=${PUBLIC_COLUMNS}`,
      {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { video_path: null, video_filename: null, video_uploaded_at: null },
      }
    );
    res.status(200).json({ item: row });
    return;
  }

  res.setHeader('Allow', 'POST, PATCH, DELETE');
  res.status(405).json({ error: `${req.method} not allowed.` });
});
