import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';

function fmt(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function resolveAsset(p) {
  if (!p) return '';
  return p.startsWith('../') ? '/' + p.slice(3) : p;
}

function findChapterIndex(chapters, t) {
  let idx = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].time <= t) idx = i;
    else break;
  }
  return idx;
}

export default function PlayerView() {
  const { slug = 'the-brand-age' } = useParams();
  const [guide, setGuide] = useState(null);
  const [mode, setMode] = useState('real');
  const [activeIdx, setActiveIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const menuRef = useRef(null);
  const feedbackTimerRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const audioRef = useRef(null);
  const heroRef = useRef(null);
  const timelineRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/guides/${slug}.json`)
      .then(r => r.json())
      .then(g => {
        if (cancelled) return;
        setGuide(g);
        setMode(g.defaultViewMode || 'real');
        setDuration(g.duration || 0);
        document.title = (g.title || 'Player') + ' — Visual Player';
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    function onKey(e) {
      const a = audioRef.current;
      if (!a) return;
      if (e.target.matches && e.target.matches('input,select,textarea')) return;
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        a.currentTime = Math.max(0, a.currentTime - 10);
      } else if (e.key === 'ArrowRight') {
        a.currentTime = Math.min(a.duration || 9999, a.currentTime + 10);
      } else if (e.key.toLowerCase() === 'f') {
        toggleFs();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function toggleFs() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (heroRef.current?.requestFullscreen) {
      heroRef.current.requestFullscreen().catch(() => {});
    }
  }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    const wasPaused = a.paused;
    if (wasPaused) a.play().catch(() => {});
    else a.pause();
    flashFeedback(wasPaused ? 'play' : 'pause');
  }

  function flashFeedback(kind) {
    setFeedback({ kind, id: Date.now() });
    clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), 600);
  }

  function handleHeroClick(e) {
    if (e.target.closest('.overlay')) return;
    togglePlay();
  }

  const jumpToChapter = useCallback((ch, idx) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = ch.time || 0;
    a.play().catch(() => {});
    setActiveIdx(idx);
  }, []);

  function onTimelineClick(e) {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = pct * a.duration;
  }

  if (!guide) return null;
  const chapters = guide.chapters || [];
  const ch = chapters[activeIdx] || chapters[0] || {};
  const wantsReal = (mode === 'real') && ch.realImage;
  const heroSrc = resolveAsset(wantsReal ? ch.realImage : (ch.image && ch.image.generated) || '');
  const genSrc = resolveAsset((ch.image && ch.image.generated) || '');
  const realSrc = resolveAsset(ch.realImage || '');
  const isBoth = mode === 'both' && ch.realImage;
  const dur = duration || guide.duration || 1;
  const pct = Math.max(0, Math.min(100, (current / dur) * 100));

  return (
    <>
      <nav className="player-nav">
        <h1 className="nav-title">{guide.title || ''}</h1>
        <div className="nav-meta">
          {[guide.author, guide.date || guide.publishedAt].filter(Boolean).join(' • ')}
        </div>
      </nav>

      <div className="player-container">
        <div className="player-main">
          <div className={`hero${playing ? '' : ' paused'}${isBoth ? ' split' : ''}`} ref={heroRef} onClick={handleHeroClick}>
            {isBoth ? (
              <div className="hero-split">
                <div className="hero-pane">
                  {genSrc && <div className="hero-backdrop" style={{ backgroundImage: `url(${genSrc})` }} aria-hidden="true" />}
                  <img className="hero-half" alt="Generated" src={genSrc} />
                </div>
                <div className="hero-pane">
                  {realSrc && <div className="hero-backdrop" style={{ backgroundImage: `url(${realSrc})` }} aria-hidden="true" />}
                  <img className="hero-half" alt="Real photo" src={realSrc} />
                </div>
              </div>
            ) : (
              heroSrc && (
                <>
                  <div className="hero-backdrop" style={{ backgroundImage: `url(${heroSrc})` }} aria-hidden="true" />
                  <img id="main-img" alt="Current illustration" src={heroSrc} />
                </>
              )
            )}

            <div className="overlay">
              <div className="timeline" ref={timelineRef} onClick={onTimelineClick}>
                <div className="timeline-progress" style={{ width: pct + '%' }} />
                <div className="chapter-markers">
                  {chapters.map((c, i) => (
                    <div
                      key={i}
                      className={`marker${i === activeIdx ? ' active' : ''}`}
                      style={{ left: ((c.time / dur) * 100) + '%' }}
                      title={c.title}
                      onClick={e => { e.stopPropagation(); jumpToChapter(c, i); }}
                    />
                  ))}
                </div>
                <div className="timeline-thumb" style={{ left: pct + '%' }} />
              </div>
              <div className="overlay-inner">
                <div className="yt-bar">
                  <button
                    className={`play-btn${playing ? ' playing' : ''}`}
                    title="Play/Pause (Space)"
                    aria-label={playing ? 'Pause' : 'Play'}
                    onClick={togglePlay}
                  >
                    <svg className="icon-play" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                    <svg className="icon-pause" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                  </button>

                  <div className="time-group">
                    <span className="time">{fmt(current / rate)}</span>
                    <span className="time-sep">/</span>
                    <span className="time">{fmt(dur / rate)}</span>
                  </div>

                  <select
                    className="speed-select"
                    defaultValue="1"
                    title="Playback speed"
                    onChange={e => {
                      const r = parseFloat(e.target.value) || 1;
                      if (audioRef.current) audioRef.current.playbackRate = r;
                      setRate(r);
                    }}
                  >
                    <option value="0.75">0.75×</option>
                    <option value="1">1×</option>
                    <option value="1.25">1.25×</option>
                    <option value="1.5">1.5×</option>
                    <option value="2">2×</option>
                  </select>

                  <div className="chapter-title">{ch.title || ''}</div>

                  <div className="volume-control" title="Volume">
                    <svg className="vol-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M11 5 6 9H2v6h4l5 4z" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                    <input
                      type="range"
                      min="0" max="1" step="0.05" defaultValue="1"
                      onInput={e => { if (audioRef.current) audioRef.current.volume = parseFloat(e.target.value); }}
                    />
                  </div>
                  <button className="fs-btn" title="Fullscreen (f)" onClick={toggleFs}>⛶</button>
                </div>
              </div>
            </div>

            {feedback && (
              <div className="play-feedback" key={feedback.id} aria-hidden="true">
                <div className="play-feedback-icon">
                  {feedback.kind === 'play' ? (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  ) : (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
                  )}
                </div>
              </div>
            )}

          </div>

          <audio
            ref={audioRef}
            src={resolveAsset(guide.audio)}
            style={{ display: 'none' }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onLoadedMetadata={e => setDuration(e.currentTarget.duration || guide.duration || 0)}
            onTimeUpdate={e => {
              const t = e.currentTarget.currentTime || 0;
              setCurrent(t);
              const i = findChapterIndex(chapters, t);
              if (i !== activeIdx) setActiveIdx(i);
            }}
          />
        </div>
      </div>

<div className="chapters-section">
        <div className="chapters-header">
          <span><span id="chapter-count">{chapters.length}</span> Chapters</span>
          <div className="view-mode-menu" ref={menuRef}>
            <button
              className="gear-btn"
              title="View settings"
              aria-label="View settings"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(o => !o)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            {menuOpen && (
              <div className="view-mode-dropdown" role="menu">
                {['generated', 'real', 'both'].map(m => (
                  <button
                    key={m}
                    role="menuitemradio"
                    aria-checked={mode === m}
                    className={`view-mode-item${mode === m ? ' active' : ''}`}
                    onClick={() => { setMode(m); setMenuOpen(false); }}
                  >
                    {m[0].toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="chapters">
          {chapters.map((c, i) => (
            <div
              key={i}
              className={`chapter${i === activeIdx ? ' active' : ''}`}
              onClick={() => jumpToChapter(c, i)}
            >
              <div className="time">{fmt(c.time)}</div>
              <div className="label">{c.title}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="note">
        Use the <strong>Generated / Real / Both</strong> toggle to switch between illustrations and historical photos.
      </div>
    </>
  );
}
