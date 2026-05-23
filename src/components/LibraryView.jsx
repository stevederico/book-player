import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

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
  const [activeFilter, setActiveFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitLabel, setSubmitLabel] = useState('Create guide');
  const [submitError, setSubmitError] = useState('');

  // For improved create flow (dev mode)
  const [chapters, setChapters] = useState([]);
  const [timingFile, setTimingFile] = useState(null);

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
    let result = [...guides];

    // Apply category filter using the 'kind' field
    if (activeFilter === 'recent') {
      // Already sorted newest-first by backend
    } else if (activeFilter === 'essays') {
      result = result.filter(g => (g.kind || 'essay') === 'essay');
    } else if (activeFilter === 'lectures') {
      result = result.filter(g => g.kind === 'lecture');
    }

    // Apply search
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(g =>
        g.title.toLowerCase().includes(q) || (g.author || '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [guides, query, activeFilter]);

  function resetCreateForm() {
    setChapters([]);
    setTimingFile(null);
  }

  function addChapter() {
    setChapters(prev => [...prev, { time: 0, title: '', quote: '', realImage: '', caption: '' }]);
  }

  function updateChapter(index, field, value) {
    setChapters(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: field === 'time' ? Number(value) || 0 : value };
      return next;
    });
  }

  function removeChapter(index) {
    setChapters(prev => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    // Parse optional word timing file
    let timing = null;
    if (timingFile instanceof File) {
      try {
        const text = await timingFile.text();
        timing = JSON.parse(text);
      } catch (e) {
        throw new Error('Invalid timing JSON file');
      }
    }

    const audioUrl = (fd.get('audio') || '').toString().trim() || null;

    const metadata = {
      title: (fd.get('title') || '').toString().trim(),
      author: (fd.get('author') || '').toString().trim() || null,
      thumbnail: (fd.get('thumbnail') || '').toString().trim() || null,
      audio: audioUrl,
      duration: Number(fd.get('duration')) || null,
      transcript: (fd.get('transcript') || '').toString(),
      chapters: chapters.length > 0 ? chapters : undefined,
      timing: timing || undefined,
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

      // Audio is provided as URL in metadata (we generate it outside the modal)
      setModalOpen(false);
      setSubmitLabel('Create guide');
      form.reset();
      resetCreateForm();
      await load();
      navigate(`/app/${encodeURIComponent(slug)}`);
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
        <button className="btn-create" onClick={() => { resetCreateForm(); setModalOpen(true); }} aria-label="Create new guide">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span>Create</span>
        </button>
      </header>

      <div className="chip-row">
        <button 
          className={`chip ${activeFilter === 'all' ? 'active' : ''}`}
          onClick={() => setActiveFilter('all')}
        >
          All
        </button>
        <button 
          className={`chip ${activeFilter === 'essays' ? 'active' : ''}`}
          onClick={() => setActiveFilter('essays')}
        >
          Essays
        </button>
        <button 
          className={`chip ${activeFilter === 'lectures' ? 'active' : ''}`}
          onClick={() => setActiveFilter('lectures')}
        >
          Lectures
        </button>
        <button 
          className={`chip ${activeFilter === 'recent' ? 'active' : ''}`}
          onClick={() => setActiveFilter('recent')}
        >
          Recent
        </button>
      </div>

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
              <div className="card-meta-row">
                <div className="card-avatar" aria-hidden="true">{initials(g.author)}</div>
                <div className="card-text">
                  <h3 className="card-title">{g.title}</h3>
                  <div className="card-sub">{g.author || ''}</div>
                  <div className="card-meta">{g.chapterCount || 0} chapters{g.date ? ` • ${g.date}` : ''}</div>
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
            <h2>New guide</h2>
            <button type="button" className="modal-close" onClick={() => { setModalOpen(false); resetCreateForm(); }} aria-label="Close">
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

            <label className="field">
              <span className="field-label">Kind</span>
              <select name="kind" defaultValue="essay">
                <option value="essay">Essay</option>
                <option value="lecture">Lecture</option>
              </select>
            </label>

            <div className="field-row">
              <label className="field">
                <span className="field-label">Audio URL</span>
                <input name="audio" placeholder="/audio/my-essay.mp3" />
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

            {/* Chapters (dev mode improvement) */}
            <div className="field">
              <div className="field-label-row" style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <span className="field-label">Chapters</span>
                <button type="button" onClick={addChapter} className="btn-ghost" style={{fontSize:12, padding:'2px 8px'}}>+ Add chapter</button>
              </div>
              {chapters.length === 0 && (
                <div style={{fontSize:12, color:'#888', marginTop:4}}>Optional — add time/title/quote/realImage for full player features</div>
              )}
              {chapters.map((ch, idx) => (
                <div key={idx} className="field-row" style={{marginTop:6, gap:6, flexWrap:'wrap'}}>
                  <input type="number" step="0.1" value={ch.time} onChange={e => updateChapter(idx, 'time', e.target.value)} placeholder="Time (s)" style={{width:80}} />
                  <input value={ch.title} onChange={e => updateChapter(idx, 'title', e.target.value)} placeholder="Title" style={{flex:1, minWidth:120}} />
                  <input value={ch.quote} onChange={e => updateChapter(idx, 'quote', e.target.value)} placeholder="Quote (for anchoring)" style={{flex:2, minWidth:140}} />
                  <input value={ch.realImage} onChange={e => updateChapter(idx, 'realImage', e.target.value)} placeholder="/images/slug/real/xx.webp" style={{flex:1.5, minWidth:140}} />
                  <input value={ch.caption} onChange={e => updateChapter(idx, 'caption', e.target.value)} placeholder="Caption" style={{flex:1, minWidth:100}} />
                  <button type="button" onClick={() => removeChapter(idx)} className="btn-ghost" style={{fontSize:11}}>×</button>
                </div>
              ))}
            </div>

            {/* Word timing JSON */}
            <label className="field">
              <span className="field-label">Word timing JSON (optional but recommended)</span>
              <input
                type="file"
                accept="application/json,.json"
                onChange={e => setTimingFile(e.target.files?.[0] || null)}
              />
              <div style={{fontSize:11, color:'#888', marginTop:2}}>
                Drop the <code>.words.json</code> file (same format used by the player for word sync & captions)
              </div>
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
            <button type="button" className="btn-ghost" onClick={() => { setModalOpen(false); resetCreateForm(); }}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              <span className="btn-label">{submitLabel}</span>
            </button>
          </footer>
        </form>
      </div>
    </>
  );
}
