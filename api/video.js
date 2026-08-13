import { absoluteStorageUrl, authorize, handle, rest, storage, BUCKET, TABLE } from './_lib.js';

/** Long enough to watch a demo without the link going stale mid-playback. */
const LINK_TTL_SECONDS = 60 * 60;

export default handle(async (req, res) => {
  if (!authorize(req, res)) return;

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: `${req.method} not allowed.` });
    return;
  }

  const id = Number(req.query?.checklist_id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'checklist_id must be an integer.' });
    return;
  }

  const [row] = await rest(`${TABLE}?checklist_id=eq.${id}&select=video_path,video_filename`);
  if (!row?.video_path) {
    res.status(404).json({ error: 'No video uploaded for this exercise yet.' });
    return;
  }

  // The bucket is private, so playback needs a short-lived signed link.
  const signed = await storage(`object/sign/${BUCKET}/${row.video_path}`, {
    body: { expiresIn: LINK_TTL_SECONDS },
  });

  res.status(200).json({
    url: absoluteStorageUrl(signed.signedURL ?? signed.signedUrl),
    filename: row.video_filename,
  });
});
