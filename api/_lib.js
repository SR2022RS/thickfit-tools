import { timingSafeEqual } from 'node:crypto';

export const BUCKET = 'exercise-demos';
export const TABLE = 'video_checklist';

/** Fields the browser is allowed to see. Never widen this to include secrets. */
export const PUBLIC_COLUMNS = [
  'checklist_id', 'name', 'muscle_group', 'level', 'equipment', 'location',
  'is_recorded', 'recorded_at', 'video_path', 'video_filename',
  'video_uploaded_at', 'note', 'updated_at',
].join(',');

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const supabaseUrl = () => env('SUPABASE_URL').replace(/\/+$/, '');

function serviceHeaders() {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, authorization: `Bearer ${key}` };
}

/**
 * Constant-time password check. The password lives only in the Vercel
 * environment; the service role key never leaves the server.
 */
export function authorize(req, res) {
  const expected = process.env.CHECKLIST_PASSWORD;
  if (!expected) {
    res.status(500).json({ error: 'CHECKLIST_PASSWORD is not configured on the server.' });
    return false;
  }
  const supplied = req.headers['x-tf-key'];
  const a = Buffer.from(String(supplied ?? ''));
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    res.status(401).json({ error: 'Wrong password.' });
    return false;
  }
  return true;
}

/** PostgREST call against the checklist table. */
export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const headers = { ...serviceHeaders(), 'content-type': 'application/json' };
  if (prefer) headers.prefer = prefer;
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(text || `Supabase returned ${response.status}`), {
      status: response.status,
    });
  }
  return text ? JSON.parse(text) : null;
}

/** Storage API call. Returns the parsed JSON body. */
export async function storage(path, { method = 'POST', body } = {}) {
  const headers = { ...serviceHeaders() };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${supabaseUrl()}/storage/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw Object.assign(new Error(text || `Storage returned ${response.status}`), {
      status: response.status,
    });
  }
  return text ? JSON.parse(text) : null;
}

/** Storage returns root-relative URLs; make them absolute for the browser. */
export const absoluteStorageUrl = (relative) =>
  `${supabaseUrl()}/storage/v1${relative.startsWith('/') ? '' : '/'}${relative}`;

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) return JSON.parse(req.body);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/** Wraps a handler so thrown errors become JSON instead of an opaque 500. */
export function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      console.error(error);
      res.status(error.status && error.status < 600 ? error.status : 500)
         .json({ error: error.message || 'Unexpected server error.' });
    }
  };
}
