# Todo

- save as video
slow scroller like a script next to a movie https://www.youtube.com/watch?v=kunUvYIJtHM

## Complete-guide pipeline (replace stub endpoints)

Each row maps to a stub in `backend/server.js` (NOT_IMPLEMENTED_STEPS) or a frontend field that's never set today. Ordered by dependency: top-down is also a sensible build order.

### A. Cheap defaults at create time (no external calls) — DONE
- ~~Set `visibility: 'public'` on create~~
- ~~Set `defaultViewMode: 'generated'` on create~~ — auto-flip to 'real' once realImages exist is deferred to Section E
- `kind` removed from the project (was Essay/Lecture taxonomy); SQLite column stays as dead data — drop with `ALTER TABLE Guides DROP COLUMN kind` if a clean schema is wanted

### B. Source-page enrichment (extend `/api/fetch-url`)
- Extract `date` from `<meta property="article:published_time">`, `<meta name="date">`, `<meta name="article:published">`, `<time datetime="…">`, falling back to first `Month YYYY` in body — return as `data.date` so create flow can store it
- Extract `og:image` / `twitter:image` from page meta → return as `data.thumbnail` so the cover is set even before chapter images exist
- Move the `/api/guides/:slug/date` stub: implement by re-scraping the stored source URL (need to also store the URL on the guide row) and re-running the extractor

### C. LLM-driven text (Anthropic Claude API)
- Implement `POST /api/guides/:slug/summary`
  - 2–3 paragraph summary of `guide.transcript`
  - persist to `guide.summary` (already rendered in PlayerView's Summary tab)
  - add `ANTHROPIC_API_KEY` to `.env`; use `claude-haiku-4-5` for cost
- Auto-chapters quality pass — `/api/guides/:slug/auto-chapters` already exists; verify it populates `chapter.quote` and `chapter.caption` for every chapter (sample The Brand Age fields). If captions are inconsistent, add a `/chapter-captions` enrichment endpoint.

### D. TTS + word timing (Kokoro)
- Wire Kokoro pipeline used for The Brand Age: `backend/scripts/migrate-guides.js` references existing timing files — pin the Kokoro version + tokenizer in a README before changing anything
- Implement `POST /api/guides/:slug/tts`:
  - chunk transcript at sentence boundaries
  - run Kokoro to produce per-chunk MP3 + word timestamps
  - concatenate MP3s → write to `backend/public/audio/<slug>.mp3`
  - merge per-chunk word timings, offset each by the chunk start → `guide.timing.words`
  - read MP3 duration → `guide.duration`
  - compute `timingOffset` (currently 0.15 for Brand Age) — calibration pass against the first audible word
- Surface progress: TTS is minutes-scale, so the stepper needs Server-Sent Events or polling. Pick polling (`GET /api/guides/:slug/jobs/tts`) and run TTS in a background promise; persist job state under `tts_jobs` row.

### E. Image generation (Replicate or OpenAI)
- `POST /api/guides/:slug/thumbnail`:
  - if `guide.thumbnail` already set (from og:image), no-op
  - else generate a single hero image from `guide.title` + first paragraph of transcript → save to `/images/<slug>/cover.webp`
- `POST /api/guides/:slug/chapter-images`:
  - for each chapter without `image.generated`, generate one image per `chapter.quote` (or `chapter.title`)
  - save to `/images/<slug>/generated/<idx>.webp`, update each chapter
  - parallelize with a concurrency cap (e.g. 3 at a time) to respect provider rate limits
- `POST /api/guides/:slug/chapter-real-images`:
  - search Unsplash or Pexels per chapter (`q = chapter.title + author`)
  - download + cache the top result → `/images/<slug>/real/<idx>.webp`
  - update each chapter's `realImage`
- Add `UNSPLASH_ACCESS_KEY` / `REPLICATE_API_TOKEN` to `.env`; both need rate limit + backoff per CLAUDE.md

### F. Frontend orchestration polish
- Add "Run all remaining" button on `GuideProgress` that walks rows in dependency order: text → tts → chapters → images
- For long-running endpoints (tts, chapter-images): poll the guide every 2–3s while the row is "running" so newly-produced fields flip the row green automatically
- Show stepper on `PlayerView` too (behind a `?debug=1` query param) so any guide can be inspected — same component, no extra work
- When all 17 rows are green, surface a "Mark public" / "Publish" affordance instead of "Open player"

### G. Schema + adapter touch-ups
- Add `source_url` column to `Guides` so the `/date` re-scrape and any future re-fetch can find the original URL
- Add `tts_job_id` column for the polling endpoint (or a sibling `Jobs` table for any background work)
- Update `backend/adapters/sqlite.js`, `postgres.js`, `mongodb.js` so the new columns round-trip

### H. Hardening
- Rate-limit each enrichment endpoint (LLM + image gen are paid)
- Add `c.req.timeout` style guards so a hung Replicate/Kokoro call doesn't pile up
- Tests in `backend/server.test.js` for each new endpoint — assert 501 disappears, success-path stores the right field

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
- Create flow rebuilt around URL fetch / paste text + kind (Essay/Lecture); chapter editor + timing upload removed
- Drag-select notes with re-highlightable anchors on timeline (touch-friendly)
- Filter chips on home actually work
- Guide cards open in new tab

**Note**: Local progress saving (`pg.progress.${slug}`) has already been implemented as the offline fallback. Many "Phase 4" items can be partially delivered today using localStorage only.
