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

  const urlInputRef = useRef(null);
  const textInputRef = useRef(null);

  async function load() {
    const res = await fetch('/api/guides');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setGuides(await res.json());
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && modalOpen) setModalOpen(false); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [modalOpen]);

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

      const slug = createBody.slug;

      // Refresh the library list and pull the full new-guide payload so the
      // GuideProgress stepper can show what's still missing for a complete guide.
      await load();
      try {
        const r = await fetch(`/api/guides/${encodeURIComponent(slug)}`);
        if (r.ok) setCreatedGuide(await r.json());
        else setCreatedGuide(createBody);
      } catch {
        setCreatedGuide(createBody);
      }
      setSubmitLabel('Created');

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
          {filtered.map(g => (
            <a 
              key={g.slug} 
              className="card" 
              href={`/app/${encodeURIComponent(g.slug)}`} 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <div className="card-thumb">
                {g.thumbnail && <img loading="lazy" alt="" src={resolveThumb(g.thumbnail)} />}
                {g.duration ? <span className="duration">{fmtDuration(g.duration)}</span> : null}
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
          ))}
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
    </>
  );
}
