# Todo

- Side by side transcription playback
- Make transcription area more like Kindle reader
- npm i kokoro-js for backend
- Name project
- Generate full audio for remaining essays
- Improve Kokoro chunking quality

## Auth (do first — blocks Phase 4)

- Gate write routes — `POST /api/guides`, `POST /api/guides/:slug/audio`, future `PUT`/`DELETE` — behind `authMiddleware` + `csrfProtection` (existing patterns in `backend/server.js`)
- Decide whether `GET /api/guides` and `GET /api/guides/:slug` should also require sign-in, or stay public
- Wrap the create button + modal in `LibraryView.jsx:92` so anonymous users see a sign-in prompt instead of an open form
- Surface auth failures from `apiRequest` as toasts in the modal (CSRF auto-regen on server restart is already handled)

## Phase 4 — Per-user state (depends on auth)

- Schema: add `UserProgress(user_id, guide_slug, position_sec, updated_at)` and `UserLibrary(user_id, guide_slug, added_at)` tables + composite PKs in `backend/adapters/sqlite.js`
- Adapter methods: `getProgress(userID, slug)`, `setProgress(userID, slug, positionSec)`, `listLibrary(userID)`, `addToLibrary(userID, slug)`, `removeFromLibrary(userID, slug)` — plumb through `manager.js` + `db.*` helpers in `server.js`
- Routes (all auth + CSRF where mutating):
  - `GET  /api/me/progress/:slug` → `{positionSec}`
  - `PUT  /api/me/progress/:slug` body `{positionSec}` — debounced from client
  - `GET  /api/me/library` → `[{slug, addedAt}]`
  - `POST /api/me/library/:slug`
  - `DELETE /api/me/library/:slug`
- `PlayerView`: on mount fetch saved position and seek; throttle a PUT every ~5s while playing; keep localStorage as offline fallback
- `LibraryView`: "Save to library" button on each card; wire the placeholder "Saved" chip at `LibraryView.jsx:101` to filter by `/api/me/library`
- Edge case: anonymous users see no progress + no library — degrade gracefully, no errors in console

## Create flow gaps (Phase 3 follow-ups)

- No edit / delete UI — once a guide is created, you can't fix the title or take it down. Add `PUT /api/guides/:slug` + `DELETE /api/guides/:slug` and an admin/owner-only edit modal
- No chapter editor — guides created via the modal have `chapters_json: []`. Add a repeating-row editor (time, title, quote, image URL, real image URL, caption)
- No word-timing upload in the modal — without it, the captions overlay + word highlight don't work for user-created guides. Add a file picker for the `{words: [...]}` JSON, or wire the `koko` ONNX pipeline server-side
- Thumbnail is URL-only — add an image upload to `POST /api/guides/:slug/thumbnail` (mirrors the audio upload pattern)
- Audio upload has no progress indicator — `fetch` doesn't expose upload progress. Switch to `XMLHttpRequest` or chunked upload to surface a real progress bar
- `duration` is manual entry — probe MP3 metadata server-side on upload (e.g. `music-metadata` package or a small ffprobe shell-out) and write it to `Guides.duration` automatically
- Filter chips at `LibraryView.jsx:100-103` (Essays / Lectures / Recent) are placeholders — either wire them (add a `kind` column to `Guides`, or sort by `created_at` for Recent) or remove them
- `chapterCount: 0` shows as "0 chapters" on the card — hide the chapter-count line for chapterless guides, or default it off

## Backend hardening

- `c.req.parseBody()` buffers the full 200 MB audio in memory — for prod, switch to a streaming write (Hono's `c.req.raw.body` is a `ReadableStream`)
- Add a rate limiter to `POST /api/guides` and `/audio` (the existing in-memory pattern used for auth would work)
- Add unit tests in `backend/server.test.js` covering: slug regex rejection, 409 on duplicate, 415/413/404 on audio upload, transcript round-trip via `getGuide` shape

## Production storage

- `backend/public/audio/` + `backend/public/images/` sit on local disk — fine for self-host, ephemeral on Railway. Either provision a persistent volume or move to object storage (R2 / S3) and rewrite the `serveStatic` mounts as proxies / signed URLs
- The SQLite file `backend/databases/App.db` has the same constraint
- Backup strategy: SQLite WAL + a nightly `VACUUM INTO ./backups/App-YYYYMMDD.db` cron, plus copying audio files to wherever the volume snapshots live

## Misc

- `backend/public/index.html` was removed — make sure the prod build's SPA fallback at `server.js:1311` still works correctly (`staticDir` points at `../dist`, which is built from the Vite output)
- README references `koko` (Kokoro-82M ONNX CLI) — pin or link to a specific version so future-you knows which model + tokenizer combo produced existing `.words.json` files
- `defaultViewMode` accepts `'real' | 'generated'` — surface this as a toggle in the create modal so user-uploaded guides can default to whichever they prefer
