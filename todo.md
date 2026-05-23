# Todo

- export as video
- images
- chapters
- audio wav
- captions
- thumbnail
- summary
- authorname
- date


## Import EPUB

- New source type in create modal alongside URL / paste: "Upload EPUB" (`.epub` file picker)
- Backend: `POST /api/import/epub` accepts multipart upload, parses with a zero-dep approach (EPUB is a zip of XHTML + OPF manifest) — unzip, read `META-INF/container.xml` → `.opf` → spine order
- Extract metadata from OPF: `dc:title`, `dc:creator`, `dc:date`, `dc:language`, cover image (`<meta name="cover">` → manifest item)
- Walk spine in order, strip XHTML to plain text per item — each spine item becomes a candidate chapter
- Map EPUB nav (`toc.ncx` or EPUB3 `nav.xhtml`) to chapter titles; fall back to `<h1>`/`<h2>` from each spine item if no nav
- Build the same payload shape as URL import: `{ title, author, date, transcript, chapters: [{ time: 0, title, ... }], thumbnail }` so downstream pipeline (TTS → timings → images) is unchanged
- Chapter `time` stays 0 until TTS runs; TTS step needs to emit per-chapter start offsets so chapter markers line up
- Persist original EPUB to `backend/public/uploads/<slug>.epub` for re-imports / debugging
- Size + rate limits: cap upload at ~50MB, reject non-EPUB MIME, sanitize XHTML before storing (strip scripts)
- Stretch: detect DRM (Adobe ADEPT, Apple FairPlay) and surface a clear error — those can't be parsed

## More visuals per chapter

- Move from 1 hero image per chapter to a timed sequence — multiple images that swap as the audio plays through the chapter
- Schema: `chapter.images: [{ src, time, caption?, alt? }]` (sorted by `time`); keep `realImage` / generated single-image as fallback
- Image generation: split chapter transcript into N beats (sentence clusters or every ~20s of audio), generate one image per beat via xAI Grok Imagine (`grok-imagine-image-quality`) with prompt = beat text + author/style anchor
- Real-image variant: run Unsplash/Pexels search per beat instead of per chapter
- PlayerView: pick current image by binary-searching `images[]` against `currentTime`; crossfade between images (`transition-opacity`, not `transition-all`)
- Caption overlay: optionally show `image.caption` when it changes (debounced so quick swaps don't flash text)
- Ken Burns / subtle zoom on the active image so static images don't feel dead — respect `prefers-reduced-motion`
- Storage layout: `/images/<slug>/beats/<chapter-idx>/<beat-idx>.webp` to keep chapter scoping intact
- Backend: extend `/api/guides/:slug/chapter-images` to accept `beatsPerChapter` or auto-derive from chapter duration; concurrency cap stays
- Cost guard: cap total images per guide (e.g. 60) so a long book doesn't blow the image budget; surface count in create flow

## Mobile formatting

- Audit `LibraryView` + `PlayerView` at 375px / 414px viewports — current split-pane and overlays assume desktop widths
- Player hero + caption overlay: stack vertically on mobile, ensure hero image scales to viewport width without cropping the caption
- Transcript pane: full-width below player on mobile (no side-by-side split), preserve word highlight + click-to-seek
- Chapters menu + settings: open as bottom sheet (`<Sheet side="bottom">`) instead of side panel on `<md`
- Timeline scrubber: enlarge touch target to 44px min, verify drag works under thumb without accidental seeks
- Library cards: 1-column on mobile, 2 on `sm`, 3 on `md+`; thumbnail aspect ratio stays consistent
- Create modal: full-screen on mobile (`<Dialog>` already supports — verify), URL input + paste flow usable one-handed
- Header: collapse desktop nav into hamburger or simplified bar at `<sm`
- Captions overlay: position above safe area on iOS (account for home indicator + notch)
- Test on iOS Safari + Android Chrome — audio autoplay restrictions, range request streaming, background playback

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

### C. LLM-driven text (xAI Grok API)
- Implement `POST /api/guides/:slug/summary`
  - 2–3 paragraph summary of `guide.transcript`
  - persist to `guide.summary` (already rendered in PlayerView's Summary tab)
  - add `XAI_API_KEY` to `.env`; use `grok-4-fast` (or current cheap Grok model) via `https://api.x.ai/v1/chat/completions` (OpenAI-compatible)
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

### E. Image generation (xAI Grok Imagine)
- All image gen goes through xAI Grok Imagine — `POST https://api.x.ai/v1/images/generations`, model `grok-imagine-image-quality`, body `{ model, prompt }`, response `data[].url`. Auth via `Authorization: Bearer $XAI_API_KEY`. Flat per-image pricing.
- Helper: `backend/lib/grokImagine.js` — single `generateImage({ prompt })` that downloads the URL, transcodes to webp, returns the local path. Reused by every image endpoint.
- `POST /api/guides/:slug/thumbnail`:
  - if `guide.thumbnail` already set (from og:image), no-op
  - else generate a single hero image from `guide.title` + first paragraph of transcript → save to `/images/<slug>/cover.webp`
- `POST /api/guides/:slug/chapter-images`:
  - for each chapter without `image.generated`, generate one image per `chapter.quote` (or `chapter.title`)
  - save to `/images/<slug>/generated/<idx>.webp`, update each chapter
  - parallelize with a concurrency cap (e.g. 3 at a time) to respect xAI rate limits
- `POST /api/guides/:slug/chapter-real-images`:
  - search Unsplash or Pexels per chapter (`q = chapter.title + author`)
  - download + cache the top result → `/images/<slug>/real/<idx>.webp`
  - update each chapter's `realImage`
- Add `XAI_API_KEY` (reused from Section C) + `UNSPLASH_ACCESS_KEY` to `.env`; rate limit + exponential backoff on 429/5xx per CLAUDE.md
- Cost guard: per-guide image cap (see "More visuals per chapter" — 60 default) applies here too

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

- Move audio/images off local disk (persistent volume)
- Proper backup strategy for SQLite + assets

## Misc

- Pin exact Kokoro version + tokenizer used for existing timing files
- Surface `defaultViewMode` toggle in create modal
- Ensure prod SPA fallback works after removing backend/public/index.html



**Note**: Local progress saving (`pg.progress.${slug}`) has already been implemented as the offline fallback. Many "Phase 4" items can be partially delivered today using localStorage only.


slow scroller like a script next to a movie https://www.youtube.com/watch?v=kunUvYIJtHM
