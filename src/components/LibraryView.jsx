import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import GuideProgress from './GuideProgress.jsx';

function fmtDuration(sec) {
  if (!sec) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function resolveThumb(p) {
  if (!p) return '';
  return p.replace(/^\.\.\//, '/');
}

function initials(name) {
  return (name || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

export default function LibraryView() {
  const navigate = useNavigate();
  const [guides, setGuides] = useState([]);
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState('url'); // 'url' | 'text'
  const [sourceUrl, setSourceUrl] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [fetching, setFetching] = useState(false);

  // Data collected from URL or pasted text
  const [sourceData, setSourceData] = useState({ title: '', author: '', transcript: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitLabel, setSubmitLabel] = useState('Create guide');
  const [submitError, setSubmitError] = useState('');

  // After create, the modal flips into "progress" mode showing the GuideProgress stepper
  // so the user can kick off the remaining enrichment jobs (TTS, chapters, images, etc.)
  // before opening the player.
  const [createdGuide, setCreatedGuide] = useState(null); // full guide payload returned by GET /:slug

  // Delete confirmation state — when set, a modal asks the user to confirm.
  const [pendingDelete, setPendingDelete] = useState(null); // {slug, title} | null
  const [deletingSlug, setDeletingSlug] = useState(null);
  const [deleteError, setDeleteError] = useState('');

  const urlInputRef = useRef(null);
  const textInputRef = useRef(null);

  async function load() {
    const res = await fetch('/api/guides');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setGuides(await res.json());
  }

  /**
   * Confirm deletion via the modal. Optimistically removes the card from the
   * grid and rolls back the change if the request fails.
   */
  async function confirmDelete() {
    if (!pendingDelete) return;
    const { slug } = pendingDelete;
    const prev = guides;
    setDeletingSlug(slug);
    setDeleteError('');
    setGuides(gs => gs.filter(x => x.slug !== slug));
    try {
      const res = await fetch(`/api/guides/${encodeURIComponent(slug)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setPendingDelete(null);
    } catch (err) {
      console.error('Delete guide failed', err);
      setGuides(prev);
      setDeleteError(err.message || 'Could not delete that guide.');
    } finally {
      setDeletingSlug(null);
    }
  }

  useEffect(() => { load(); }, []);

  // Backend orchestrates the create-guide pipeline in the background. While any
  // guide in the library is still running, poll the list every 3s so cards flip
  // from "processing" to ready (or error) without a refresh.
  useEffect(() => {
    const hasRunning = guides.some(g => g.jobs?.pipeline?.status === 'running');
    if (!hasRunning) return;
    const id = setInterval(() => { load().catch(() => {}); }, 3000);
    return () => clearInterval(id);
  }, [guides]);

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return;
      if (modalOpen) setModalOpen(false);
      if (pendingDelete && !deletingSlug) setPendingDelete(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalOpen, pendingDelete, deletingSlug]);

  // Auto-focus the correct input when modal opens or when switching between URL/Text mode
  useEffect(() => {
    if (!modalOpen) return;

    const timer = setTimeout(() => {
      if (sourceMode === 'url' && urlInputRef.current) {
        urlInputRef.current.focus();
        urlInputRef.current.select?.();
      } else if (sourceMode === 'text' && textInputRef.current) {
        textInputRef.current.focus();
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [modalOpen, sourceMode]);

  // In text mode, keep sourceData.transcript synced with the textarea and derive a default
  // title from the first long line (only when the title field is still empty / unedited).
  useEffect(() => {
    if (sourceMode !== 'text') return;
    const trimmed = pastedText.trim();
    if (!trimmed) {
      setSourceData(d => (d.transcript ? { title: '', author: '', transcript: '' } : d));
      return;
    }
    setSourceData(d => {
      const firstLine = pastedText.split('\n').find(l => l.trim().length > 12) || 'Untitled Guide';
      const derivedTitle = firstLine.trim().slice(0, 140);
      // Preserve any title the user has edited (different from the previously-derived value)
      const title = d.title && d.title !== d._derivedTitle ? d.title : derivedTitle;
      return { ...d, title, transcript: trimmed, _derivedTitle: derivedTitle };
    });
  }, [pastedText, sourceMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return guides;
    return guides.filter(g =>
      g.title.toLowerCase().includes(q) || (g.author || '').toLowerCase().includes(q)
    );
  }, [guides, query]);

  function resetCreateForm() {
    setSourceMode('url');
    setSourceUrl('');
    setPastedText('');
    setFetching(false);
    setSourceData({ title: '', author: '', transcript: '' });
    setCreatedGuide(null);
    setSubmitError('');
    setSubmitLabel('Create guide');
  }

  // Refetch the full guide payload so the GuideProgress component sees newly-produced
  // fields (audio, timing, chapters, etc.) after each enrichment step.
  async function refreshCreatedGuide() {
    if (!createdGuide?.slug) return;
    try {
      const res = await fetch(`/api/guides/${encodeURIComponent(createdGuide.slug)}`);
      if (!res.ok) return;
      const g = await res.json();
      setCreatedGuide(g);
    } catch {}
  }

  // Backend orchestrates the whole pipeline on create — poll the guide while
  // jobs.pipeline is running so the GuideProgress UI updates without any
  // per-step button clicks.
  useEffect(() => {
    if (!createdGuide?.slug) return;
    const status = createdGuide.jobs?.pipeline?.status;
    if (status && status !== 'running') return; // pipeline finished
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/guides/${encodeURIComponent(createdGuide.slug)}`);
        if (!res.ok) return;
        const g = await res.json();
        setCreatedGuide(g);
      } catch {}
    }, 2500);
    return () => clearInterval(id);
  }, [createdGuide?.slug, createdGuide?.jobs?.pipeline?.status]);

  // === New source-first create flow ===

  // Reusable fetch that returns data (now calls our backend for reliable extraction)
  async function fetchFromUrl(url) {
    const res = await fetch('/api/fetch-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url.trim() }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(json.error || 'Failed to fetch the page');
    }

    return {
      title: json.title || 'Untitled Guide',
      author: json.author || '',
      transcript: json.transcript || '',
      sourceUrl: json.sourceUrl || url.trim(),
      date: json.date || '',
      thumbnail: json.thumbnail || '',
    };
  }

  // Kept for potential future manual use, but not shown in UI anymore
  async function handleFetchUrl() {
    if (!sourceUrl.trim()) return;
    setFetching(true);
    setSubmitError('');
    try {
      const data = await fetchFromUrl(sourceUrl);
      setSourceData(data);
      setPastedText(data.transcript);
    } catch (err) {
      setSubmitError(err.message || 'Could not fetch the page.');
    } finally {
      setFetching(false);
    }
  }

  function handleUsePastedText() {
    if (!pastedText.trim()) return;
    const firstLine = pastedText.split('\n').find(l => l.trim().length > 12) || 'Untitled Guide';
    const title = firstLine.trim().slice(0, 140);
    setSourceData({ title, author: '', transcript: pastedText });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;

    setSubmitting(true);
    setSubmitError('');

    try {
      let data = { ...sourceData };

      // Auto-fetch for URL mode inside the Create button
      if (sourceMode === 'url' && sourceUrl.trim() && !data.transcript) {
        setSubmitLabel('Fetching content…');
        data = await fetchFromUrl(sourceUrl);
        setSourceData(data);
      }

      // Auto-prepare from pasted text
      if (sourceMode === 'text' && pastedText.trim() && !data.transcript) {
        const firstLine = pastedText.split('\n').find(l => l.trim().length > 12) || 'Untitled Guide';
        data = {
          title: firstLine.trim().slice(0, 140),
          author: '',
          transcript: pastedText.trim(),
        };
        setSourceData(data);
      }

      if (!data.transcript) {
        throw new Error('Please enter a URL or paste some text');
      }

      setSubmitLabel('Creating…');

      const metadata = {
        title: data.title || 'Untitled Guide',
        author: data.author || null,
        transcript: data.transcript,
        sourceUrl: data.sourceUrl || (sourceMode === 'url' ? sourceUrl.trim() : null),
        date: data.date || null,
        thumbnail: data.thumbnail || null,
      };

      const createRes = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(metadata),
      });
      const createBody = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        const msg = createBody?.error || `Failed (HTTP ${createRes.status})`;
        throw new Error(msg);
      }

      // Backend orchestrates the rest. Close the modal immediately and let the
      // library grid show the new guide as "processing" until the pipeline finishes.
      await load();
      setModalOpen(false);
      resetCreateForm();
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong');
      setSubmitLabel('Create guide');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="top-nav">
        <div className="brand">
          <span className="brand-mark"></span>
          <span className="brand-name">Book Player</span>
        </div>
        <div className="nav-search">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search guides"
          />
        </div>
        <button className="btn-create" onClick={() => { resetCreateForm(); setModalOpen(true); }} aria-label="Create new guide">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Create</span>
        </button>
      </header>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No guides yet.</div>
          <div className="empty-sub">Tap <strong>Create</strong> to add one.</div>
        </div>
      ) : (
        <main className="grid">
          {filtered.map(g => {
            const pipe = g.jobs?.pipeline;
            const processing = pipe?.status === 'running';
            const failed = pipe?.status === 'failed';
            const stepLabels = {
              analyze: 'Analyzing transcript',
              thumbnail: 'Generating cover',
              tts: 'Synthesizing audio',
              'chapter-timing': 'Timing chapters',
              'chapter-images': 'Generating chapter images',
              'chapter-real-images': 'Finding chapter photos',
            };
            let processingLabel = 'Processing…';
            if (processing && g.jobs) {
              for (const key of ['chapter-real-images','chapter-images','chapter-timing','tts','thumbnail','analyze']) {
                if (g.jobs[key]?.status === 'running') { processingLabel = stepLabels[key]; break; }
              }
            }
            const cardProps = processing
              ? { onClick: e => e.preventDefault(), tabIndex: -1, 'aria-disabled': true }
              : {};
            return (
            <a
              key={g.slug}
              className={`card${processing ? ' is-processing' : ''}${failed ? ' is-failed' : ''}`}
              href={`/app/${encodeURIComponent(g.slug)}`}
              target="_blank"
              rel="noopener noreferrer"
              {...cardProps}
            >
              <div className="card-thumb">
                {g.thumbnail && <img loading="lazy" alt="" src={resolveThumb(g.thumbnail)} />}
                {g.duration ? <span className="duration">{fmtDuration(g.duration)}</span> : null}
                {processing && (
                  <span className="status-badge status-processing" role="status" aria-live="polite">
                    {processingLabel}
                  </span>
                )}
                {failed && (
                  <span className="status-badge status-failed" role="alert">
                    Failed: {pipe.error || 'unknown error'}
                  </span>
                )}
                <button
                  type="button"
                  className="card-delete"
                  aria-label={`Delete ${g.title}`}
                  onClick={e => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteError('');
                    setPendingDelete({ slug: g.slug, title: g.title });
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              </div>
              <h3 className="card-title">{g.title}</h3>
              <div className="card-meta-row">
                <div className="card-avatar" aria-hidden="true">{initials(g.author)}</div>
                <div className="card-text">
                  {g.author && <div className="card-sub">{g.author}</div>}
                  {g.date && <div className="card-meta">{g.date}</div>}
                </div>
              </div>
            </a>
            );
          })}
        </main>
      )}

      <div
        className="modal-backdrop"
        hidden={!modalOpen}
        onClick={e => { if (e.target === e.currentTarget) { setModalOpen(false); resetCreateForm(); } }}
      >
        <form className="modal" autoComplete="off" onSubmit={handleSubmit}>
          <header className="modal-head">
            <h2>{createdGuide ? 'Guide created' : 'New guide'}</h2>
            <button type="button" className="modal-close" onClick={() => { setModalOpen(false); resetCreateForm(); }} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </header>
          <div className="modal-body">
            {createdGuide ? (
              <GuideProgress
                slug={createdGuide.slug}
                guide={createdGuide}
                onRefresh={refreshCreatedGuide}
              />
            ) : (
            <>
            {/* Pure URL or Text flow — nothing else */}
            <div className="source-toggle">
              <button
                type="button"
                className={`source-btn ${sourceMode === 'url' ? 'active' : ''}`}
                onClick={() => setSourceMode('url')}
              >
                From URL
              </button>
              <button
                type="button"
                className={`source-btn ${sourceMode === 'text' ? 'active' : ''}`}
                onClick={() => setSourceMode('text')}
              >
                Paste Text
              </button>
            </div>

            {sourceMode === 'url' ? (
              <div className="source-url-block">
                <input
                  ref={urlInputRef}
                  type="url"
                  value={sourceUrl}
                  onChange={e => setSourceUrl(e.target.value)}
                  placeholder="https://example.com/article"
                />
              </div>
            ) : (
              <div className="source-text-block">
                <textarea
                  ref={textInputRef}
                  value={pastedText}
                  onChange={e => setPastedText(e.target.value)}
                  rows={10}
                  placeholder="Paste the full article or essay text here..."
                />
              </div>
            )}

            {sourceData.transcript && (
              <div className="title-edit-block">
                <label className="title-edit-label">Title</label>
                <input
                  type="text"
                  value={sourceData.title}
                  onChange={e => setSourceData(d => ({ ...d, title: e.target.value }))}
                  placeholder="Untitled Guide"
                  className="title-edit-input"
                />
              </div>
            )}
            {submitError ? (
              <div role="alert" className="field-error" style={{ color: 'tomato', fontSize: 13, marginTop: 8 }}>
                {submitError}
              </div>
            ) : null}
            </>
            )}
          </div>
          <footer className="modal-foot" style={{ justifyContent: 'flex-end', gap: 10 }}>
            {createdGuide ? (
              <>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => { setModalOpen(false); resetCreateForm(); }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    const slug = createdGuide.slug;
                    setModalOpen(false);
                    resetCreateForm();
                    navigate(`/app/${encodeURIComponent(slug)}`);
                  }}
                >
                  <span className="btn-label">Open player</span>
                </button>
              </>
            ) : (
              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || (sourceMode === 'url' ? !sourceUrl.trim() : !pastedText.trim())}
              >
                <span className="btn-label">{submitLabel}</span>
              </button>
            )}
          </footer>
        </form>
      </div>

      <div
        className="modal-backdrop"
        hidden={!pendingDelete}
        onClick={e => { if (e.target === e.currentTarget && !deletingSlug) setPendingDelete(null); }}
      >
        <div className="modal" role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-desc">
          <header className="modal-head">
            <h2 id="delete-title">Delete guide?</h2>
            <button
              type="button"
              className="modal-close"
              onClick={() => setPendingDelete(null)}
              aria-label="Close"
              disabled={!!deletingSlug}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </header>
          <div className="modal-body">
            <p id="delete-desc" style={{ margin: 0 }}>
              <strong>{pendingDelete?.title}</strong> will be permanently removed. This can't be undone.
            </p>
            {deleteError ? (
              <div role="alert" className="field-error" style={{ color: 'tomato', fontSize: 13, marginTop: 12 }}>
                {deleteError}
              </div>
            ) : null}
          </div>
          <footer className="modal-foot" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setPendingDelete(null)}
              disabled={!!deletingSlug}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary btn-danger"
              onClick={confirmDelete}
              disabled={!!deletingSlug}
            >
              <span className="btn-label">{deletingSlug ? 'Deleting…' : 'Delete'}</span>
            </button>
          </footer>
        </div>
      </div>
    </>
  );
}
