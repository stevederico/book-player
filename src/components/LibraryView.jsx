import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

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
  const [submitting, setSubmitting] = useState(false);
  const [submitLabel, setSubmitLabel] = useState('Create guide');
  const [submitError, setSubmitError] = useState('');

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return guides;
    return guides.filter(g =>
      g.title.toLowerCase().includes(q) || (g.author || '').toLowerCase().includes(q)
    );
  }, [guides, query]);

  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const audioFile = fd.get('audio');
    const metadata = {
      title: (fd.get('title') || '').toString().trim(),
      author: (fd.get('author') || '').toString().trim() || null,
      thumbnail: (fd.get('thumbnail') || '').toString().trim() || null,
      duration: Number(fd.get('duration')) || null,
      transcript: (fd.get('transcript') || '').toString(),
    };
    setSubmitting(true);
    setSubmitError('');
    setSubmitLabel('Creating…');
    try {
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

      if (audioFile instanceof File && audioFile.size > 0) {
        setSubmitLabel('Uploading audio…');
        const upload = new FormData();
        upload.append('audio', audioFile);
        const upRes = await fetch(`/api/guides/${encodeURIComponent(slug)}/audio`, {
          method: 'POST',
          body: upload,
        });
        if (!upRes.ok) {
          const body = await upRes.json().catch(() => ({}));
          throw new Error(body?.error || `Audio upload failed (HTTP ${upRes.status})`);
        }
      }

      setModalOpen(false);
      setSubmitLabel('Create guide');
      form.reset();
      await load();
      navigate(`/app/player/${encodeURIComponent(slug)}`);
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong');
      setSubmitLabel('Try again');
      setTimeout(() => setSubmitLabel('Create guide'), 2000);
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
        <button className="btn-create" onClick={() => setModalOpen(true)} aria-label="Create new guide">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Create</span>
        </button>
      </header>

      <div className="chip-row">
        <button className="chip active">All</button>
        <button className="chip">Essays</button>
        <button className="chip">Lectures</button>
        <button className="chip">Recent</button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-title">No guides yet.</div>
          <div className="empty-sub">Tap <strong>Create</strong> to add one.</div>
        </div>
      ) : (
        <main className="grid">
          {filtered.map(g => (
            <Link key={g.slug} className="card" to={`/app/player/${encodeURIComponent(g.slug)}`}>
              <div className="card-thumb">
                {g.thumbnail && <img loading="lazy" alt="" src={resolveThumb(g.thumbnail)} />}
                {g.duration ? <span className="duration">{fmtDuration(g.duration)}</span> : null}
              </div>
              <div className="card-meta-row">
                <div className="card-avatar" aria-hidden="true">{initials(g.author)}</div>
                <div className="card-text">
                  <h3 className="card-title">{g.title}</h3>
                  <div className="card-sub">{g.author || ''}</div>
                  <div className="card-meta">{g.chapterCount || 0} chapters{g.date ? ` • ${g.date}` : ''}</div>
                </div>
              </div>
            </Link>
          ))}
        </main>
      )}

      <div
        className="modal-backdrop"
        hidden={!modalOpen}
        onClick={e => { if (e.target === e.currentTarget) setModalOpen(false); }}
      >
        <form className="modal" autoComplete="off" onSubmit={handleSubmit}>
          <header className="modal-head">
            <h2>New guide</h2>
            <button type="button" className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </header>
          <div className="modal-body">
            <label className="field">
              <span className="field-label">Title</span>
              <input name="title" required placeholder="The Brand Age" autoFocus />
            </label>
            <label className="field">
              <span className="field-label">Author</span>
              <input name="author" placeholder="Paul Graham" defaultValue="Paul Graham" />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field-label">Audio file (MP3)</span>
                <input name="audio" type="file" accept="audio/*" />
              </label>
              <label className="field">
                <span className="field-label">Hero image URL</span>
                <input name="thumbnail" placeholder="/images/my-essay/hero.jpg" />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Transcript</span>
              <textarea name="transcript" rows="10" placeholder="Paste the full essay text here. Plays alongside the audio with word-level highlighting." />
            </label>
            <label className="field">
              <span className="field-label">Duration (seconds, optional)</span>
              <input name="duration" type="number" min="0" placeholder="2133" />
            </label>
            {submitError ? (
              <div role="alert" className="field-error" style={{ color: 'tomato', fontSize: 13, marginTop: 8 }}>
                {submitError}
              </div>
            ) : null}
          </div>
          <footer className="modal-foot">
            <button type="button" className="btn-ghost" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              <span className="btn-label">{submitLabel}</span>
            </button>
          </footer>
        </form>
      </div>
    </>
  );
}
