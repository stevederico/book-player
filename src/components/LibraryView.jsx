import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

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
  const [guides, setGuides] = useState([]);
  const [query, setQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitLabel, setSubmitLabel] = useState('Create guide');

  async function load() {
    const res = await fetch('/guides/index.json');
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
    const fd = new FormData(e.currentTarget);
    const body = Object.fromEntries(fd.entries());
    body.duration = Number(body.duration) || 0;
    setSubmitting(true);
    setSubmitLabel('Creating…');
    try {
      const res = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed');
      setModalOpen(false);
      setSubmitLabel('Create guide');
      await load();
    } catch {
      setSubmitLabel('Try again');
      setTimeout(() => setSubmitLabel('Create guide'), 1500);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="top-nav">
        <div className="brand">
          <span className="brand-mark"></span>
          <span className="brand-name">PG / Audio</span>
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
                <span className="field-label">Audio URL</span>
                <input name="audio" placeholder="/audio/MyEssay.mp3" />
              </label>
              <label className="field">
                <span className="field-label">Hero image URL</span>
                <input name="thumbnail" placeholder="/images/my-essay/hero.jpg" />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Summary / opening line</span>
              <textarea name="summary" rows="3" placeholder="One line that captures the piece." />
            </label>
            <label className="field">
              <span className="field-label">Duration (seconds)</span>
              <input name="duration" type="number" min="0" placeholder="2133" />
            </label>
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
