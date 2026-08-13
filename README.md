# thickfit-tools

Exercise video production checklist for Thick Fit Coaching — 298 exercises, tracked
through to a recorded demo video. Checkoffs and uploads are stored in Supabase, so
they survive a refresh and follow you across devices.

## How it works

```
Browser  ──password──▶  /api/*  ──service role key──▶  Supabase (Postgres + Storage)
   │                  (Vercel functions)
   └──────────── video file, direct via signed URL ───────────▶ Storage
```

- **Checkoffs** live in `public.video_checklist` (298 rows, keyed 1–298).
- **Videos** live in the private `exercise-demos` bucket, played back through
  short-lived signed URLs.
- **Uploads go browser → Supabase directly** using a signed upload URL. They never
  pass through the serverless function, which would cap them at its request body limit.
- The service role key stays server-side. The table has RLS enabled with **no policies**,
  so the anon key can read and write nothing — verified.

## Setup

Set these three variables in the Vercel project (Settings → Environment Variables),
for Production, Preview and Development:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://cpwesaeyhklmjbqppeah.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase → Settings → API keys |
| `CHECKLIST_PASSWORD` | whatever password Stephanie should type |

Or from the CLI:

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add CHECKLIST_PASSWORD production
```

Locally, the same values go in `.env` (gitignored — see `.env.example`), and
`vercel dev` picks them up.

## Using it

1. Open the site, enter the password once — it's remembered in that browser.
2. Tap a row to tick it off. Saves immediately; the dot under the header shows sync state.
3. Tap **Watch** for the detail view: YouTube reference search, and **Upload your
   recording** for your own demo.
4. Uploading a video ticks the exercise off automatically. Rows with a video show 🎬.

## Known limits

- **50 MB per video.** This is the Supabase project's global upload limit, not a choice
  in this code. To raise it: Supabase dashboard → Storage → Settings → global file size
  limit (requires a paid plan for >50 MB), then bump `file_size_limit` on the
  `exercise-demos` bucket and `MAX_UPLOAD_BYTES` in `api/upload.js` + `index.html`.
- **The checklist's 298 exercises are still a separate list** from the app's main
  `public.exercises` table (1,305 rows). `video_checklist.exercise_id` is a nullable
  foreign key reserved for linking the two, but nothing is linked yet — the names don't
  match cleanly (`Clamshells` has no row; `Bodyweight Hip Thrust` vs `Body weight hip
  thrust`). Until that reconciliation happens, uploads here do **not** appear in the
  coaching app.
- One shared password, so there's no per-user audit trail of who ticked what.

## Layout

| Path | Purpose |
| --- | --- |
| `index.html` | The whole UI — exercise data, filters, modal, upload client |
| `api/_lib.js` | Auth check + Supabase REST/Storage helpers (no npm dependencies) |
| `api/checklist.js` | `GET` the list, `PATCH` a checkoff or note |
| `api/upload.js` | `POST` signed upload URL, `PATCH` to attach, `DELETE` to remove |
| `api/video.js` | `GET` a signed playback URL |
