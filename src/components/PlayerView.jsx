import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router';
import {
  fmt,
  resolveAsset,
  findChapterIndex,
  timeAtWordIndex,
  chunkIndexAtWord,
} from '../lib/playerUtils.js';
import { useTranscript } from '../hooks/useTranscript.js';

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
  const [settingsPage, setSettingsPage] = useState('main');
  const [feedback, setFeedback] = useState(null);
  const [panel, setPanel] = useState('transcript');
  const [captionsOn, setCaptionsOn] = useState(() => {
    try { return localStorage.getItem('pg.cc') !== '0'; } catch { return true; }
  });
  const [splitTranscript, setSplitTranscript] = useState(() => {
    try { return localStorage.getItem('pg.split') === '1'; } catch { return false; }
  });
  const [chaptersMenuOpen, setChaptersMenuOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const menuRef = useRef(null);
  const chaptersMenuRef = useRef(null);
  const activeChapterItemRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const activeWordRef = useRef(null);
  const sideTranscriptScrollRef = useRef(null);
  const sideActiveWordRef = useRef(null);
  const userScrollUntilRef = useRef(0);
  const lastProgressSaveRef = useRef(0);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) setSettingsPage('main');
  }, [menuOpen]);

  useEffect(() => {
    if (!chaptersMenuOpen) return;
    function onDoc(e) {
      if (chaptersMenuRef.current && !chaptersMenuRef.current.contains(e.target)) setChaptersMenuOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [chaptersMenuOpen]);

  useEffect(() => {
    if (!chaptersMenuOpen) return;
    const el = activeChapterItemRef.current;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [chaptersMenuOpen]);

  function changeRate(r) {
    if (audioRef.current) audioRef.current.playbackRate = r;
    setRate(r);
  }

  function toggleSplitTranscript() {
    setSplitTranscript(v => {
      const next = !v;
      try { localStorage.setItem('pg.split', next ? '1' : '0'); } catch {}
      return next;
    });
  }

  useEffect(() => {
    try { setNotes(localStorage.getItem(`pg.notes.${slug}`) || ''); } catch { setNotes(''); }
  }, [slug]);

  function updateNotes(v) {
    setNotes(v);
    try { localStorage.setItem(`pg.notes.${slug}`, v); } catch {}
  }

  const audioRef = useRef(null);
  const heroRef = useRef(null);
  const timelineRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/guides/${encodeURIComponent(slug)}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(g => {
        if (cancelled) return;
        setGuide(g);
        setMode(g.defaultViewMode === 'generated' ? 'generated' : 'real');
        setDuration(g.duration || 0);
        document.title = (g.title || 'Player') + ' — Visual Player';
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Failed to load guide:', err);
      });
    return () => { cancelled = true; };
  }, [slug]);

  const {
    transcriptParas,
    totalWords,
    anchors,
    wordStartTimes,
    captionChunks,
    activeWord,
    activeCaption,
  } = useTranscript(guide, duration, current, captionsOn);

  useEffect(() => {
    if (!playing) return;
    const chs = guide?.chapters || [];
    let raf;
    const tick = () => {
      const a = audioRef.current;
      if (a) {
        const t = a.currentTime || 0;
        setCurrent(t);
        const i = findChapterIndex(chs, t);
        setActiveIdx(prev => (prev === i ? prev : i));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, guide]);

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
      } else if (e.key.toLowerCase() === 'c') {
        toggleCaptions();
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

  // Note: transcriptParas, anchors, activeWord, etc. now come from useTranscript hook
  function toggleCaptions() {
    setCaptionsOn(v => {
      const next = !v;
      try { localStorage.setItem('pg.cc', next ? '1' : '0'); } catch {}
      return next;
    });
  }

  useEffect(() => {
    const scroller = transcriptScrollRef.current;
    if (!scroller) return;
    function pauseAutoScroll() { userScrollUntilRef.current = Date.now() + 5000; }
    scroller.addEventListener('wheel', pauseAutoScroll, { passive: true });
    scroller.addEventListener('touchmove', pauseAutoScroll, { passive: true });
    return () => {
      scroller.removeEventListener('wheel', pauseAutoScroll);
      scroller.removeEventListener('touchmove', pauseAutoScroll);
    };
  }, [panel]);

  useEffect(() => {
    const scroller = sideTranscriptScrollRef.current;
    if (!scroller) return;
    function pauseAutoScroll() { userScrollUntilRef.current = Date.now() + 5000; }
    scroller.addEventListener('wheel', pauseAutoScroll, { passive: true });
    scroller.addEventListener('touchmove', pauseAutoScroll, { passive: true });
    return () => {
      scroller.removeEventListener('wheel', pauseAutoScroll);
      scroller.removeEventListener('touchmove', pauseAutoScroll);
    };
  }, [splitTranscript, transcriptParas]);

  useEffect(() => {
    if (!playing) return;
    if (Date.now() < userScrollUntilRef.current) return;
    function scrollActiveIntoView(el, scroller) {
      if (!el || !scroller) return;
      const elRect = el.getBoundingClientRect();
      const sRect = scroller.getBoundingClientRect();
      const relTop = elRect.top - sRect.top;
      const h = sRect.height;
      if (relTop > h * 0.75 || elRect.bottom < sRect.top) {
        const target = scroller.scrollTop + relTop - h * 0.2;
        scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
    }
    if (panel === 'transcript') {
      scrollActiveIntoView(activeWordRef.current, transcriptScrollRef.current);
    }
    if (splitTranscript && transcriptParas) {
      scrollActiveIntoView(sideActiveWordRef.current, sideTranscriptScrollRef.current);
    }
  }, [activeWord, panel, playing, splitTranscript, transcriptParas]);

  function seekToWord(wIdx) {
    const a = audioRef.current;
    if (!a || !totalWords || !duration) return;
    let t;
    if (wordStartTimes && wordStartTimes[wIdx] != null) t = wordStartTimes[wIdx];
    else if (anchors) t = timeAtWordIndex(anchors, wIdx);
    else t = (wIdx / totalWords) * duration;
    a.currentTime = t;
    a.play().catch(() => {});
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
  const showSplit = splitTranscript && !!transcriptParas;
  const dur = duration || guide.duration || 1;
  const pct = Math.max(0, Math.min(100, (current / dur) * 100));

  return (
    <>
      <div className="player-container">
        <div className="player-main">
          <div className={`hero${playing ? '' : ' paused'}${showSplit ? ' split' : ''}`} ref={heroRef} onClick={handleHeroClick}>
            {showSplit ? (
              <div className="hero-split">
                <div className="hero-pane">
                  {heroSrc && <div className="hero-backdrop" style={{ backgroundImage: `url(${heroSrc})` }} aria-hidden="true" />}
                  {heroSrc && <img className="hero-half" alt="Current illustration" src={heroSrc} />}
                </div>
                <div
                  className="hero-pane hero-transcript-pane"
                  ref={sideTranscriptScrollRef}
                  onClick={e => e.stopPropagation()}
                >
                  {transcriptParas.map((p, pi) => (
                    <p key={pi} className="transcript-para">
                      {p.words.map((w, wi) => {
                        const isActive = w.index === activeWord;
                        const isPast = w.index < activeWord;
                        return (
                          <span
                            key={wi}
                            ref={isActive ? sideActiveWordRef : null}
                            className={`tw${isActive ? ' active' : ''}${isPast ? ' past' : ''}`}
                            onClick={() => seekToWord(w.index)}
                          >
                            {w.text}{wi < p.words.length - 1 ? ' ' : ''}
                          </span>
                        );
                      })}
                    </p>
                  ))}
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

                  <div className="chapters-menu" ref={chaptersMenuRef}>
                    <button
                      type="button"
                      className="chapter-title-btn"
                      title="Jump to chapter"
                      aria-haspopup="menu"
                      aria-expanded={chaptersMenuOpen}
                      onClick={() => setChaptersMenuOpen(o => !o)}
                    >
                      <span className="chapter-title-text">{ch.title || ''}</span>
                    </button>
                    {chaptersMenuOpen && (
                      <div className="chapters-popup" role="menu">
                        <div className="chapters-popup-header">Chapters</div>
                        <div className="chapters-popup-list">
                          {chapters.map((c, i) => (
                            <button
                              key={i}
                              role="menuitemradio"
                              aria-checked={i === activeIdx}
                              ref={i === activeIdx ? activeChapterItemRef : null}
                              className={`chapters-popup-item${i === activeIdx ? ' active' : ''}`}
                              onClick={() => { jumpToChapter(c, i); setChaptersMenuOpen(false); }}
                            >
                              <span className="chapters-popup-time">{fmt(c.time)}</span>
                              <span className="chapters-popup-title">{c.title}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

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
                  <div className="settings-menu" ref={menuRef}>
                    <button
                      className="gear-btn"
                      title="Settings"
                      aria-label="Settings"
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
                      <div className="settings-panel" role="menu">
                        {settingsPage === 'main' && (
                          <>
                            <button
                              className="settings-row"
                              role="menuitem"
                              onClick={() => setSettingsPage('mode')}
                            >
                              <span className="settings-row-icon">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <rect x="3" y="5" width="18" height="14" rx="2" />
                                  <circle cx="9" cy="11" r="2" />
                                  <path d="m21 17-4-4-6 6" />
                                </svg>
                              </span>
                              <span className="settings-row-label">View</span>
                              <span className="settings-row-value">
                                {mode[0].toUpperCase() + mode.slice(1)}
                              </span>
                              <svg className="settings-row-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m9 18 6-6-6-6" />
                              </svg>
                            </button>
                            {transcriptParas && (
                              <button
                                className="settings-row"
                                role="menuitemcheckbox"
                                aria-checked={splitTranscript}
                                onClick={toggleSplitTranscript}
                              >
                                <span className="settings-row-icon">
                                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <rect x="3" y="5" width="18" height="14" rx="2" />
                                    <path d="M14 5v14" />
                                    <path d="M16.5 9.5h3" />
                                    <path d="M16.5 12h3" />
                                    <path d="M16.5 14.5h3" />
                                  </svg>
                                </span>
                                <span className="settings-row-label">Show transcript</span>
                                <span className={`settings-toggle${splitTranscript ? ' on' : ''}`} aria-hidden="true">
                                  <span className="settings-toggle-knob" />
                                </span>
                              </button>
                            )}
                            <button
                              className="settings-row"
                              role="menuitemcheckbox"
                              aria-checked={captionsOn}
                              onClick={toggleCaptions}
                            >
                              <span className="settings-row-icon">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                  <path d="M19 4H5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zM11 11.5H9.5v-.5h-2v2h2v-.5H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v2h2v-.5H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z" />
                                </svg>
                              </span>
                              <span className="settings-row-label">Captions</span>
                              <span className={`settings-toggle${captionsOn ? ' on' : ''}`} aria-hidden="true">
                                <span className="settings-toggle-knob" />
                              </span>
                            </button>
                            <button
                              className="settings-row"
                              role="menuitem"
                              onClick={() => setSettingsPage('speed')}
                            >
                              <span className="settings-row-icon">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M12 22a10 10 0 1 0-10-10" />
                                  <path d="m12 12 4-4" />
                                </svg>
                              </span>
                              <span className="settings-row-label">Playback speed</span>
                              <span className="settings-row-value">
                                {rate === 1 ? 'Normal' : rate + '×'}
                              </span>
                              <svg className="settings-row-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m9 18 6-6-6-6" />
                              </svg>
                            </button>
                          </>
                        )}

                        {settingsPage === 'mode' && (
                          <>
                            <button className="settings-sub-header" onClick={() => setSettingsPage('main')}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m15 18-6-6 6-6" />
                              </svg>
                              <span>View</span>
                            </button>
                            {['generated', 'real'].map(m => (
                              <button
                                key={m}
                                role="menuitemradio"
                                aria-checked={mode === m}
                                className={`settings-option${mode === m ? ' selected' : ''}`}
                                onClick={() => { setMode(m); setMenuOpen(false); }}
                              >
                                <span className="settings-option-check" aria-hidden="true">
                                  {mode === m && (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M20 6 9 17l-5-5" />
                                    </svg>
                                  )}
                                </span>
                                {m[0].toUpperCase() + m.slice(1)}
                              </button>
                            ))}
                          </>
                        )}

                        {settingsPage === 'speed' && (
                          <>
                            <button className="settings-sub-header" onClick={() => setSettingsPage('main')}>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m15 18-6-6 6-6" />
                              </svg>
                              <span>Playback speed</span>
                            </button>
                            {[0.75, 1, 1.25, 1.5, 2].map(r => (
                              <button
                                key={r}
                                role="menuitemradio"
                                aria-checked={rate === r}
                                className={`settings-option${rate === r ? ' selected' : ''}`}
                                onClick={() => { changeRate(r); setMenuOpen(false); }}
                              >
                                <span className="settings-option-check" aria-hidden="true">
                                  {rate === r && (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M20 6 9 17l-5-5" />
                                    </svg>
                                  )}
                                </span>
                                {r === 1 ? 'Normal' : r + '×'}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    className={`cc-btn${captionsOn ? ' active' : ''}`}
                    title={captionsOn ? 'Captions on (c)' : 'Captions off (c)'}
                    aria-label={captionsOn ? 'Turn captions off' : 'Turn captions on'}
                    aria-pressed={captionsOn}
                    onClick={toggleCaptions}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M19 4H5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zM11 11.5H9.5v-.5h-2v2h2v-.5H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v2h2v-.5H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z" />
                    </svg>
                  </button>
                  <button className="fs-btn" title="Fullscreen (f)" onClick={toggleFs}>⛶</button>
                </div>
              </div>
            </div>

            {activeCaption && !showSplit && (
              <div className="cc-box" aria-live="polite">
                <span className="cc-text">{activeCaption.text}</span>
              </div>
            )}

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
            onPause={() => {
              setPlaying(false);
              const a = audioRef.current;
              if (a) {
                try { localStorage.setItem(`pg.progress.${slug}`, a.currentTime); } catch {}
              }
            }}
            onEnded={() => {
              setPlaying(false);
              try { localStorage.removeItem(`pg.progress.${slug}`); } catch {}
            }}
            onLoadedMetadata={e => {
              setDuration(e.currentTarget.duration || guide.duration || 0);
              // Restore last position from localStorage (no auth path)
              const saved = parseFloat(localStorage.getItem(`pg.progress.${slug}`) || '0');
              const dur = e.currentTarget.duration || guide.duration || 0;
              if (saved > 1 && saved < dur - 5) {
                e.currentTarget.currentTime = saved;
              }
            }}
            onTimeUpdate={e => {
              const t = e.currentTarget.currentTime || 0;
              setCurrent(t);
              const i = findChapterIndex(chapters, t);
              if (i !== activeIdx) setActiveIdx(i);

              // Throttle progress save to localStorage (~every 5s)
              const now = Date.now();
              if (now - lastProgressSaveRef.current > 5000) {
                lastProgressSaveRef.current = now;
                try { localStorage.setItem(`pg.progress.${slug}`, t); } catch {}
              }
            }}
          />
        </div>
      </div>

<div className="chapters-section">
        <div className="player-heading">
          <h1 className="player-heading-title">{guide.title || ''}</h1>
          <div className="player-heading-meta">
            <div className="author-avatar" aria-hidden="true">
              {(guide.author || '?').trim().charAt(0).toUpperCase()}
            </div>
            <span className="player-heading-byline">
              {[guide.author, guide.date || guide.publishedAt].filter(Boolean).join(' • ')}
            </span>
          </div>
        </div>
        <div className="chapters-header">
          <div className="panel-toggle" role="tablist" aria-label="Panel">
            <button
              role="tab"
              aria-selected={panel === 'chapters'}
              className={`panel-tab${panel === 'chapters' ? ' active' : ''}`}
              onClick={() => setPanel('chapters')}
            >
              Chapters
            </button>
            {guide.transcript && (
              <button
                role="tab"
                aria-selected={panel === 'transcript'}
                className={`panel-tab${panel === 'transcript' ? ' active' : ''}`}
                onClick={() => setPanel('transcript')}
              >
                Transcript
              </button>
            )}
            <button
              role="tab"
              aria-selected={panel === 'summary'}
              className={`panel-tab${panel === 'summary' ? ' active' : ''}`}
              onClick={() => setPanel('summary')}
            >
              Summary
            </button>
            <button
              role="tab"
              aria-selected={panel === 'notes'}
              className={`panel-tab${panel === 'notes' ? ' active' : ''}`}
              onClick={() => setPanel('notes')}
            >
              Notes
            </button>
          </div>
        </div>
        {panel === 'chapters' && (
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
        )}
        {panel === 'summary' && (
          <div className="summary-panel">
            {guide.summary ? (
              <p className="summary-body">{guide.summary}</p>
            ) : (
              <div className="summary-empty">No summary available for this guide yet.</div>
            )}
          </div>
        )}
        {panel === 'notes' && (
          <div className="notes-panel">
            <textarea
              className="notes-textarea"
              placeholder="Write your notes here…"
              value={notes}
              onChange={e => updateNotes(e.target.value)}
              aria-label="Notes for this guide"
            />
          </div>
        )}
        {panel === 'transcript' && (
          <div className="transcript" ref={transcriptScrollRef}>
            {!guide ? (
              <div className="transcript-empty">Loading transcript…</div>
            ) : !transcriptParas ? (
              <div className="transcript-empty">Transcript unavailable.</div>
            ) : (
              transcriptParas.map((p, pi) => (
                <p key={pi} className="transcript-para">
                  {p.words.map((w, wi) => {
                    const isActive = w.index === activeWord;
                    const isPast = w.index < activeWord;
                    return (
                      <span
                        key={wi}
                        ref={isActive ? activeWordRef : null}
                        className={`tw${isActive ? ' active' : ''}${isPast ? ' past' : ''}`}
                        onClick={() => seekToWord(w.index)}
                      >
                        {w.text}{wi < p.words.length - 1 ? ' ' : ''}
                      </span>
                    );
                  })}
                </p>
              ))
            )}
          </div>
        )}
      </div>

    </>
  );
}
