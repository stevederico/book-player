# Todo

- Add auth to endpoints and application — gate write routes (POST/PUT/DELETE /api/guides, /api/guides/:slug/audio) behind JWT + CSRF; decide whether to gate read routes too; add a sign-in wall to the create modal in LibraryView so anonymous users can't open it

- Phase 4: per-user state (depends on auth above)
  - Schema: add `UserProgress(user_id, guide_slug, position_sec, updated_at)` and `UserLibrary(user_id, guide_slug, added_at)` tables + composite PKs in `backend/adapters/sqlite.js`
  - Adapter methods: `getProgress(userID, slug)`, `setProgress(userID, slug, positionSec)`, `listLibrary(userID)`, `addToLibrary(userID, slug)`, `removeFromLibrary(userID, slug)` — plumb through `manager.js` + `db.*` helpers in `server.js`
  - Routes (all auth + CSRF where mutating):
    - `GET  /api/me/progress/:slug` → `{positionSec}`
    - `PUT  /api/me/progress/:slug` body `{positionSec}` — debounced from client
    - `GET  /api/me/library` → `[{slug, addedAt}]`
    - `POST /api/me/library/:slug`
    - `DELETE /api/me/library/:slug`
  - PlayerView: on mount fetch saved position and seek; throttle a PUT every ~5s while playing; keep localStorage as offline fallback
  - LibraryView: "Save to library" button on each card; wire the placeholder "Saved" chip at `LibraryView.jsx:101` to filter by `/api/me/library`
  - Edge case: anonymous users see no progress + no library — degrade gracefully, no errors in console
