# Todo

## Current Development Priorities (no auth)

While `noLogin: true` (fast iteration, no sign-in friction):

- **Improve create flow polish** (core flow is now usable):
  - Basic chapter editor + word timing upload + Kind selector working
  - Audio is URL-based (we generate it externally) — no longer required in modal
  - Filter chips (All / Essays / Lectures / Recent) now actually filter the list
  - Remaining nice-to-haves: better chapter UI, auto-detect duration, thumbnail file upload, show selected timing filename
- Add more real guides (essays + generated or recorded audio).
- Local progress + resume (done via `pg.progress.${slug}` localStorage + restore on load).
- Hide "0 chapters" when chapterCount is zero or missing on cards.
- Backend quality-of-life (non-auth):
  - Switch `c.req.parseBody()` to streaming write for large audio uploads
  - Rate limit public create endpoints
  - Add server tests for create flow edge cases

## Future — Auth + Per-user State

Everything below only becomes relevant once auth is enabled (`noLogin: false`, real user accounts, write gating).

## Auth (do first — blocks Phase 4)

- Gate write routes — `POST /api/guides`, `POST /api/guides/:slug/audio`, future `PUT`/`DELETE` — behind `authMiddleware` + `csrfProtection`
- Decide whether `GET /api/guides` and `GET /api/guides/:slug` should also require sign-in, or stay public
- Wrap the create button + modal in `LibraryView.jsx:92` so anonymous users see a sign-in prompt instead of an open form
- Surface auth failures from `apiRequest` as toasts in the modal

## Phase 4 — Per-user state (depends on auth)

- Schema: add `UserProgress(user_id, guide_slug, position_sec, updated_at)` and `UserLibrary(user_id, guide_slug, added_at)` tables + composite PKs in `backend/adapters/sqlite.js`
- Adapter methods + routes for progress and library (all auth + CSRF where mutating)
- `PlayerView`: on mount fetch saved position from server (localStorage already done as fallback); throttle PUT every ~5s
- `LibraryView`: "Save to library" + filtering by personal library
- Graceful degradation for anonymous users

## Create flow gaps (when auth is on)

- No edit / delete UI — `PUT /api/guides/:slug` + `DELETE` + admin/owner edit modal
- (Other create improvements listed above should be done in dev mode first)

## Backend hardening

- Add unit tests in `backend/server.test.js` covering slug validation, duplicate handling, audio upload errors, transcript round-trips
- Rate limiter on create endpoints (can be done now)

## Production storage

- Move audio/images off local disk (R2/S3 or persistent volume)
- Proper backup strategy for SQLite + assets

## Misc

- Pin exact Kokoro version + tokenizer used for existing timing files
- Surface `defaultViewMode` toggle in create modal
- Ensure prod SPA fallback works after removing backend/public/index.html

---

**Recent wins (dev mode)**:
- Major PlayerView refactor (utilities + useTranscript hook + 5 components extracted; file reduced from ~993 → ~522 lines)
- Local progress + resume (`pg.progress.${slug}`)
- Create flow now supports chapters + timing JSON + kind (Essay/Lecture)
- Filter chips on home actually work
- Guide cards open in new tab
- Audio is optional (URL-based) since we generate it externally

**Note**: Local progress saving (`pg.progress.${slug}`) has already been implemented as the offline fallback. Many "Phase 4" items can be partially delivered today using localStorage only.