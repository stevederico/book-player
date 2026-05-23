import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router';
import GuideProgress from './GuideProgress.jsx';
import {
  fmt,
  resolveAsset,
  findChapterIndex,
  timeAtWordIndex,
  chunkIndexAtWord,
} from '../lib/playerUtils.js';
import { useTranscript } from '../hooks/useTranscript.js';
import TranscriptView from './TranscriptView.jsx';
import PlayerSettings from './PlayerSettings.jsx';
import PlayerChaptersMenu from './PlayerChaptersMenu.jsx';
import PlayerInfoPanel from './PlayerInfoPanel.jsx';
import { useTheme } from '@stevederico/skateboard-ui/ThemeProvider';

export default function PlayerView() {
  const { slug = 'the-brand-age' } = useParams();
  const [searchParams] = useSearchParams();
  const debugMode = searchParams.get('debug') === '1';
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
  const [panel, setPanel] = useState('summary');
  const [captionsOn, setCaptionsOn] = useState(() => {
    try { return localStorage.getItem('pg.cc') !== '0'; } catch { return true; }
  });
  const [splitTranscript, setSplitTranscript] = useState(() => {
    try { return localStorage.getItem('pg.split') === '1'; } catch { return false; }
  });
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimerRef = useRef(null);
  const pointerInsideRef = useRef(false);
  const [chaptersMenuOpen, setChaptersMenuOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [noteSelection, setNoteSelection] = useState(null);
  const [noteCustomText, setNoteCustomText] = useState('');
  const [noteAnchors, setNoteAnchors] = useState([]);
  const [noteHighlight, setNoteHighlight] = useState(null); // { start: number, end: number }

  const { resolvedTheme, setTheme } = useTheme();
  const isDarkMode = resolvedTheme === 'dark';
  function toggleTheme() {
    setTheme(isDarkMode ? 'light' : 'dark');
  }

  // Controls overlay visibility with inactivity auto-hide (YouTube-style)
  function showControls(immediate = false) {
    pointerInsideRef.current = true;
    // Sync DOM update for instant show on enter/move (before React re-render)
    if (heroRef.current) {
      heroRef.current.classList.add('controls-visible');
    }
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    // Auto-hide only while actively playing and no menus/popups are open
    const hasOpenUI = menuOpen || chaptersMenuOpen || !!noteSelection;
    if (playing && !hasOpenUI) {
      const delay = immediate ? 800 : 2200;
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
        if (heroRef.current) {
          heroRef.current.classList.remove('controls-visible');
        }
      }, delay);
    }
  }
  function hideControls() {
    pointerInsideRef.current = false;
    // Drop focus inside the hero so :focus-within fallbacks don't keep controls visible
    if (heroRef.current && document.activeElement && heroRef.current.contains(document.activeElement)) {
      try { document.activeElement.blur(); } catch {}
    }
    // Sync DOM update for instant hide as soon as cursor leaves the player area
    if (heroRef.current) {
      heroRef.current.classList.remove('controls-visible');
    }
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsVisible(false);
  }

  // Keep controls visible when paused or any menu/popup is open — but only while the pointer is inside the hero.
  useEffect(() => {
    if (!pointerInsideRef.current) return;
    if (!playing || menuOpen || chaptersMenuOpen || noteSelection) {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (heroRef.current) {
        heroRef.current.classList.add('controls-visible');
      }
      setControlsVisible(true);
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [playing, menuOpen, chaptersMenuOpen, noteSelection]);

  const menuRef = useRef(null);
  const chaptersMenuRef = useRef(null);
  const activeChapterItemRef = useRef(null);
  const selectionPopupRef = useRef(null);
  const noteInputRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const transcriptScrollRef = useRef(null);
  const activeWordRef = useRef(null);
  const sideTranscriptScrollRef = useRef(null);
  const sideActiveWordRef = useRef(null);
  const userScrollUntilRef = useRef(0);
  const lastProgressSaveRef = useRef(0);
  const playheadRef = useRef(0);
  const durRef = useRef(0);
  const scrubbingRef = useRef(false);

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

  // Close selection note popup on outside click (like other menus)
  useEffect(() => {
    if (!noteSelection) return;
    function onDoc(e) {
      if (selectionPopupRef.current && !selectionPopupRef.current.contains(e.target)) {
        setNoteSelection(null);
        setNoteCustomText('');
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [noteSelection]);

  // Escape key closes the popup and clears any leftover browser selection
  useEffect(() => {
    if (!noteSelection) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        setNoteSelection(null);
        setNoteCustomText('');
        window.getSelection()?.removeAllRanges();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [noteSelection]);

  // Auto-focus the custom note textarea as soon as the popup appears
  useEffect(() => {
    if (noteSelection && noteInputRef.current) {
      const t = setTimeout(() => {
        noteInputRef.current?.focus();
        noteInputRef.current?.select?.();
      }, 60);
      return () => clearTimeout(t);
    }
  }, [noteSelection]);

  // Auto-clear the re-highlighted note text after a while
  useEffect(() => {
    if (!noteHighlight) return;
    const t = setTimeout(() => setNoteHighlight(null), 9000);
    return () => clearTimeout(t);
  }, [noteHighlight]);

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
    try {
      const raw = localStorage.getItem(`pg.noteAnchors.${slug}`);
      setNoteAnchors(raw ? JSON.parse(raw) : []);
    } catch {
      setNoteAnchors([]);
    }
    // Stale highlight/popup state from the previous guide would point at unrelated words
    setNoteHighlight(null);
    setNoteSelection(null);
    setNoteCustomText('');
  }, [slug]);

  function persistAnchors(next) {
    setNoteAnchors(next);
    try {
      localStorage.setItem(`pg.noteAnchors.${slug}`, JSON.stringify(next));
    } catch {}
  }

  // Notes textarea is the source of truth: when the user edits the textarea, drop any
  // anchor whose `[m:ss]` timestamp line no longer appears in the text.
  function updateNotes(v) {
    setNotes(v);
    try { localStorage.setItem(`pg.notes.${slug}`, v); } catch {}
    const surviving = noteAnchors.filter(a => v.includes(`[${fmt(a.time)}]`));
    if (surviving.length !== noteAnchors.length) {
      persistAnchors(surviving);
    }
  }

  function updateNoteAnchors(next) {
    persistAnchors(next);
  }

  const audioRef = useRef(null);
  const heroRef = useRef(null);
  const timelineRef = useRef(null);

  const refetchGuide = useCallback(async () => {
    try {
      const r = await fetch(`/api/guides/${encodeURIComponent(slug)}`);
      if (!r.ok) return null;
      const g = await r.json();
      setGuide(g);
      return g;
    } catch (err) {
      console.error('Failed to refetch guide:', err);
      return null;
    }
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    const previousTitle = document.title;
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
    return () => {
      cancelled = true;
      document.title = previousTitle;
    };
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

  // Keep live refs of playhead and duration so the side-scroll RAF can read
  // the latest values every frame without causing the effect to restart constantly.
  useEffect(() => { playheadRef.current = current; }, [current]);
  useEffect(() => { durRef.current = duration; }, [duration]);

  useEffect(() => {
    if (!playing) return;
    if (Date.now() < userScrollUntilRef.current) return;

    // Bottom transcript panel: discrete correction only when the active word gets too low
    const scroller = transcriptScrollRef.current;
    const el = activeWordRef.current;
    if (panel === 'transcript' && scroller && el) {
      const elRect = el.getBoundingClientRect();
      const sRect = scroller.getBoundingClientRect();
      const relTop = elRect.top - sRect.top;
      const h = sRect.height;
      if (relTop > h * 0.75 || elRect.bottom < sRect.top) {
        const target = scroller.scrollTop + relTop - h * 0.2;
        scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
      }
    }
  }, [activeWord, panel, playing]);

  // Continuous damped scroll for the *side* transcript pane in split mode.
  // Pure time-based (current / duration) + reading line offset so the active
  // words sit in the middle of the pane (not jammed at the top) and the scroll
  // never stops during pauses — classic script-to-screen roll.
  useEffect(() => {
    if (!splitTranscript || !playing) return;
    const scroller = sideTranscriptScrollRef.current;
    if (!scroller) return;

    let rafId;

    const tick = () => {
      if (Date.now() < userScrollUntilRef.current) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const d = durRef.current || duration || 0;
      const t = playheadRef.current || current || 0;
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;

      if (maxScroll <= 10 || d <= 0) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const frac = Math.min(1, Math.max(0, t / d));

      // Target the "current" moment ~40% down the visible pane (not at the very top).
      // This keeps the highlighted words in the comfortable middle/upper-middle area
      // with good lookahead below, like the script-to-screen videos.
      const paneH = scroller.clientHeight;
      const readingLine = paneH * 0.40;
      let target = frac * maxScroll - readingLine;
      const desired = Math.max(0, Math.min(maxScroll, target));

      const curr = scroller.scrollTop;
      const gap = Math.abs(desired - curr);

      if (gap > 90) {
        // Big jump (seek, chapter, word click) → snap instantly so the view matches
        scroller.scrollTop = desired;
      } else {
        // Normal playback: soft damped lerp for continuous slow roll
        const next = curr + (desired - curr) * 0.095;
        scroller.scrollTop = next;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [splitTranscript, playing]);

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

  // Move the playhead without forcing playback — used when previewing a saved note
  // so the user isn't yanked into play (and their pg.progress.<slug> isn't overwritten).
  function seekToTime(t) {
    const a = audioRef.current;
    if (!a) return;
    const clamped = Math.max(0, Math.min(t, duration || 999999));
    a.currentTime = clamped;
  }

  // Called by TranscriptView instances when user finishes a drag selection.
  // We store the exact word range so we can re-highlight the original text when the user
  // later clicks the note marker on the progress bar.
  const handleTextSelected = useCallback((text, startIdx, endIdx) => {
    if (!anchors) return;
    const t = timeAtWordIndex(anchors, startIdx);
    const sel = window.getSelection();
    let rect = null;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      rect = { top: r.top, left: r.left, bottom: r.bottom, width: r.width, height: r.height };
    }
    setNoteSelection({
      text,
      time: t,
      rect,
      startWord: startIdx,
      endWord: endIdx ?? startIdx,
    });
    setNoteCustomText('');
  }, [anchors]);

  function handleSaveNoteSelection() {
    if (!noteSelection) return;

    const quotePart = `[${fmt(noteSelection.time)}] "${noteSelection.text}"`;
    const extra = noteCustomText.trim();
    const entry = extra
      ? `\n\n${quotePart}\n${extra}`
      : `\n\n${quotePart}`;
    const base = (notes || '').trimEnd();
    updateNotes(base + entry);

    // Persist structured anchor so we can re-highlight the exact text later
    if (noteSelection.startWord != null && noteSelection.endWord != null) {
      const newAnchor = {
        time: noteSelection.time,
        startWord: noteSelection.startWord,
        endWord: noteSelection.endWord,
        selectedText: noteSelection.text,
      };
      // Avoid exact duplicates by time+range
      const exists = noteAnchors.some(a =>
        Math.abs(a.time - newAnchor.time) < 1 &&
        a.startWord === newAnchor.startWord &&
        a.endWord === newAnchor.endWord
      );
      if (!exists) {
        updateNoteAnchors([...noteAnchors, newAnchor]);
      }
    }

    setPanel('notes');
    window.getSelection()?.removeAllRanges();
    setNoteSelection(null);
    setNoteCustomText('');
  }

  const jumpToChapter = useCallback((ch, idx) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = ch.time || 0;
    a.play().catch(() => {});
    setActiveIdx(idx);
  }, []);

  // --- Timeline scrubbing (click + drag) ---
  function seekFromPointer(e) {
    const a = audioRef.current;
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!a || !rect || !rect.width) return;

    // PointerEvent has clientX for both mouse and touch (normalized)
    const x = e.clientX;
    if (x == null) return;

    const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    const targetTime = pct * (a.duration || duration || 0);
    a.currentTime = targetTime;

    // Immediately reflect in UI state so thumb/progress follow the drag live
    setCurrent(targetTime);
  }

  function handleTimelinePointerDown(e) {
    e.stopPropagation();
    scrubbingRef.current = true;

    seekFromPointer(e);

    const onMove = (ev) => {
      if (scrubbingRef.current) {
        seekFromPointer(ev);
      }
    };

    const onUp = () => {
      scrubbingRef.current = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
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
      {debugMode && guide && (
        <details className="player-debug" style={{ padding: '12px 16px', background: 'var(--color-card, #1a1a1a)', borderBottom: '1px solid var(--color-border, #333)' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Guide pipeline (debug)</summary>
          <div style={{ marginTop: 12 }}>
            <GuideProgress slug={slug} guide={guide} onRefresh={refetchGuide} />
          </div>
        </details>
      )}
      <div className="player-container">
        <div className="player-main">
          <div
            className={`hero${playing ? '' : ' paused'}${showSplit ? ' split' : ''}${controlsVisible ? ' controls-visible' : ''}`}
            ref={heroRef}
            onPointerEnter={showControls}
            onPointerMove={showControls}
            onPointerLeave={hideControls}
            onClick={handleHeroClick}
          >
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
                  <TranscriptView
                    paras={transcriptParas}
                    activeWord={activeWord}
                    onWordClick={seekToWord}
                    activeRef={sideActiveWordRef}
                    onTextSelected={handleTextSelected}
                    highlightedNoteRange={noteHighlight}
                  />
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
              <div
                className="timeline"
                ref={timelineRef}
                onPointerDown={handleTimelinePointerDown}
                onClick={e => e.stopPropagation()}
              >
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
                <div className="note-markers">
                  {duration > 0 && noteAnchors.map((anchor, i) => (
                    <div
                      key={`note-${i}`}
                      className="note-marker"
                      style={{ left: `${(anchor.time / duration) * 100}%` }}
                      onClick={e => {
                        e.stopPropagation();
                        seekToTime(anchor.time);
                        setPanel('transcript'); // make sure the transcript is visible
                        setNoteHighlight({
                          start: anchor.startWord,
                          end: anchor.endWord,
                        });
                      }}
                      title={`Note: ${anchor.selectedText?.slice(0, 60)}${anchor.selectedText?.length > 60 ? '…' : ''}`}
                    >
                      <svg width="10" height="12" viewBox="0 0 10 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1.5 1H8.5V11L5 8.2L1.5 11V1Z" fill="#fbbf24" stroke="#fff" strokeWidth="1.2" strokeLinejoin="round"/>
                      </svg>
                    </div>
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

                  <PlayerChaptersMenu
                    ref={chaptersMenuRef}
                    chapters={chapters}
                    activeIdx={activeIdx}
                    chaptersMenuOpen={chaptersMenuOpen}
                    setChaptersMenuOpen={setChaptersMenuOpen}
                    jumpToChapter={jumpToChapter}
                    activeChapterItemRef={activeChapterItemRef}
                  />

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
                      <PlayerSettings
                        mode={mode}
                        setMode={setMode}
                        setMenuOpen={setMenuOpen}
                        splitTranscript={splitTranscript}
                        toggleSplitTranscript={toggleSplitTranscript}
                        captionsOn={captionsOn}
                        toggleCaptions={toggleCaptions}
                        isDarkMode={isDarkMode}
                        toggleTheme={toggleTheme}
                        rate={rate}
                        changeRate={changeRate}
                        settingsPage={settingsPage}
                        setSettingsPage={setSettingsPage}
                        transcriptParas={transcriptParas}
                      />
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
            src={`${resolveAsset(guide.audio)}${guide.updatedAt ? `?v=${guide.updatedAt}` : ''}`}
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
          <div className="flex gap-2.5 items-start">
            <div
              aria-hidden="true"
              className="size-9 rounded-full bg-gradient-to-br from-[var(--accent)] to-[#b6291f] flex items-center justify-center text-white font-extrabold font-['Bricolage_Grotesque'] text-[0.95rem] shrink-0"
            >
              {(guide.author || '?').split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase()}
            </div>
            <div className="min-w-0">
              {guide.author && <div className="text-[0.82rem] leading-snug font-medium text-foreground mb-0.5">{guide.author}</div>}
              {(guide.date || guide.publishedAt) && (
                <div className="text-[0.82rem] leading-snug font-medium text-muted-foreground">{guide.date || guide.publishedAt}</div>
              )}
            </div>
          </div>
        </div>

        <PlayerInfoPanel
          panel={panel}
          setPanel={setPanel}
          chapters={chapters}
          transcriptParas={transcriptParas}
          guide={guide}
          notes={notes}
          updateNotes={updateNotes}
          activeIdx={activeIdx}
          jumpToChapter={jumpToChapter}
          activeWord={activeWord}
          onWordClick={seekToWord}
          activeWordRef={activeWordRef}
          transcriptScrollRef={transcriptScrollRef}
          fmt={fmt}
          onTextSelected={handleTextSelected}
          highlightedNoteRange={noteHighlight}
        />
      </div>

      {/* Floating note popup — input field shown immediately on drag select.
          Type your own note in the textarea (or leave blank to save just the quote + timestamp). */}
      {noteSelection && (
        <div
          ref={selectionPopupRef}
          className="selection-popup editor"
          style={{
            top: `${Math.max(8, (noteSelection.rect?.top || 120) - 110)}px`,
            left: `${Math.max(8, Math.min(noteSelection.rect?.left || 100, (typeof window !== 'undefined' ? window.innerWidth : 900) - 300))}px`,
          }}
        >
          <div className="selection-editor">
            <div className="selection-popup-content">
              <span className="selection-time">[{fmt(noteSelection.time)}]</span>
              <span className="selection-quote-full" title={noteSelection.text}>
                “{noteSelection.text.length > 80 ? noteSelection.text.slice(0, 77) + '…' : noteSelection.text}”
              </span>
            </div>
            <textarea
              ref={noteInputRef}
              className="selection-note-input"
              placeholder="Add your own note, insight, or reaction…"
              value={noteCustomText}
              onChange={e => setNoteCustomText(e.target.value)}
              rows={3}
            />
            <div className="selection-editor-actions">
              <button type="button" className="selection-btn" onClick={handleSaveNoteSelection}>
                Save note
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
