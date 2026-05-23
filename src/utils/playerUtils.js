// Pure utility functions extracted from PlayerView.jsx

const TOKEN_STRIP_RX = /[^\w']/g;
const QUOTE_STRIP_RX = /[^\w\s']/g;
const WHITESPACE_RX = /\s+/;
const WHITESPACE_RX_G = /\s+/g;
const HARD_BREAK_RX = /[.!?]/;
const SOFT_BREAK_RX = /[,;:]/;
const LINE_BREAK_RX = /\r?\n/;
const SOURCE_PREFIX_RX = /^Source:/i;
const PARA_SPLIT_RX = /\n\s*\n+/;
const SENTENCE_TERMINAL_RX = /[.!?][)"'""']?$/;
const NUMERIC_MARKER_RX = /^\d+\.?$/;
const NOTE_TIMESTAMP_RX = /\[(\d+):(\d{2})\]/g;

export function normalizeToken(s) {
  return s.toLowerCase().replace(TOKEN_STRIP_RX, '');
}

export function alignTimings(transcriptParas, timingWords) {
  if (!transcriptParas || !timingWords?.length) return null;
  const flat = transcriptParas.flatMap(p => p.words);
  const times = new Array(flat.length).fill(null);
  let ti = 0;
  for (let i = 0; i < flat.length && ti < timingWords.length; i++) {
    const tw = normalizeToken(flat[i].text);
    if (!tw) continue;
    for (let k = 0; k < 5 && ti + k < timingWords.length; k++) {
      if (normalizeToken(timingWords[ti + k].w) === tw) {
        times[i] = timingWords[ti + k].t;
        ti += k + 1;
        break;
      }
    }
  }
  let last = 0;
  for (let i = 0; i < times.length; i++) {
    if (times[i] == null) times[i] = last;
    else last = times[i];
  }
  return times;
}

export function wordIndexFromTimes(wordStartTimes, t) {
  if (!wordStartTimes?.length) return -1;
  let lo = 0, hi = wordStartTimes.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (wordStartTimes[mid] <= t) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

export function findQuoteStartWord(flatWords, quote, hintIdx = 0) {
  const q = (quote || '')
    .toLowerCase()
    .replace(QUOTE_STRIP_RX, ' ')
    .split(WHITESPACE_RX)
    .filter(Boolean)
    .slice(0, 6);
  if (q.length < 2) return -1;
  for (let i = hintIdx; i <= flatWords.length - q.length; i++) {
    let match = true;
    for (let j = 0; j < q.length; j++) {
      if (normalizeToken(flatWords[i + j]) !== q[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

export function buildAnchors(transcriptParas, chapters, duration) {
  if (!transcriptParas || !chapters?.length || !duration) return null;
  const flat = transcriptParas.flatMap(p => p.words.map(w => w.text));
  const total = flat.length;

  const found = [];
  let hint = 0;
  chapters.forEach(ch => {
    if (ch.time == null) return;
    const wIdx = findQuoteStartWord(flat, ch.quote, hint);
    if (wIdx < 0) return;
    found.push({ word: wIdx, time: ch.time });
    hint = wIdx + 1;
  });

  let pace = 0;
  if (found.length >= 2) {
    const paces = [];
    for (let i = 1; i < found.length; i++) {
      const dw = found[i].word - found[i - 1].word;
      const dt = found[i].time - found[i - 1].time;
      if (dw > 0 && dt > 0) paces.push(dw / dt);
    }
    if (paces.length) {
      paces.sort((a, b) => a - b);
      pace = paces[Math.floor(paces.length / 2)];
    }
  }

  if (found.length && found[0].word > 0 && found[0].time === 0 && pace > 0) {
    found[0] = { word: found[0].word, time: found[0].word / pace };
  }

  const anchors = [...found].sort((a, b) => a.time - b.time);
  if (!anchors.length || anchors[0].time > 0 || anchors[0].word > 0) {
    anchors.unshift({ word: 0, time: 0 });
  }
  if (anchors.length && anchors[anchors.length - 1].word < total) {
    anchors.push({ word: total, time: duration });
  }
  return anchors;
}

export function wordIndexAtTime(anchors, t) {
  if (!anchors || anchors.length < 2) return 0;
  let i = 0;
  while (i < anchors.length - 1 && anchors[i + 1].time <= t) i++;
  const a = anchors[i];
  const b = anchors[i + 1] || a;
  if (!b || b.time <= a.time) return a.word;
  const frac = (t - a.time) / (b.time - a.time);
  return Math.round(a.word + frac * (b.word - a.word));
}

export function timeAtWordIndex(anchors, wIdx) {
  if (!anchors || anchors.length < 2) return 0;
  let i = 0;
  while (i < anchors.length - 1 && anchors[i + 1].word <= wIdx) i++;
  const a = anchors[i];
  const b = anchors[i + 1] || a;
  if (!b || b.word <= a.word) return a.time;
  const frac = (wIdx - a.word) / (b.word - a.word);
  return a.time + frac * (b.time - a.time);
}

export function buildCaptionChunks(transcriptParas) {
  if (!transcriptParas) return null;
  const flat = transcriptParas.flatMap(p => p.words);
  const chunks = [];
  const MAX = 12;
  const SOFT = 7;
  let buf = [];
  const flush = () => {
    if (!buf.length) return;
    chunks.push({
      start: buf[0].index,
      end: buf[buf.length - 1].index,
      text: buf.map(w => w.text).join(' ')
    });
    buf = [];
  };
  for (const w of flat) {
    buf.push(w);
    const last = w.text[w.text.length - 1];
    const hardBreak = HARD_BREAK_RX.test(last);
    const softBreak = SOFT_BREAK_RX.test(last);
    if (hardBreak || buf.length >= MAX || (softBreak && buf.length >= SOFT)) flush();
  }
  flush();
  return chunks;
}

export function chunkIndexAtWord(chunks, wIdx) {
  if (!chunks?.length) return -1;
  let lo = 0, hi = chunks.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chunks[mid].start <= wIdx) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

export function parseTranscript(text) {
  const lines = text.split(LINE_BREAK_RX);
  let start = 0;
  if (lines[0]?.startsWith('#')) {
    start = lines.findIndex((l, i) => i > 0 && l.trim() === '');
    start = start === -1 ? 0 : start + 1;
  }
  while (start < lines.length && SOURCE_PREFIX_RX.test(lines[start])) start++;
  while (start < lines.length && lines[start].trim() === '') start++;
  const body = lines.slice(start).join('\n');
  const chunks = body.split(PARA_SPLIT_RX).map(p => p.replace(WHITESPACE_RX_G, ' ').trim()).filter(Boolean);
  // Many sources hard-wrap every visual line with a blank line between, losing real
  // paragraph boundaries. Merge fragments that don't end on sentence-terminal
  // punctuation with the next chunk; standalone numeric markers (footnotes, section
  // numbers) stay as their own paragraph.
  const paras = [];
  let current = '';
  for (const chunk of chunks) {
    const endsTerminal = SENTENCE_TERMINAL_RX.test(chunk);
    const wordCount = chunk.split(WHITESPACE_RX).length;
    // Standalone: numeric markers, or short heading-like chunks (≤5 words) that
    // don't end with sentence-terminal punctuation — titles, dates, section labels.
    if (NUMERIC_MARKER_RX.test(chunk) || (wordCount <= 5 && !endsTerminal)) {
      if (current) { paras.push(current); current = ''; }
      paras.push(chunk);
      continue;
    }
    current = current ? current + ' ' + chunk : chunk;
    if (endsTerminal) {
      paras.push(current);
      current = '';
    }
  }
  if (current) paras.push(current);
  let wordCounter = 0;
  return paras.map(p => {
    const words = p.split(' ').map(w => ({ text: w, index: wordCounter++ }));
    return { words };
  });
}

export function fmt(sec) {
  if (!sec || isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

/**
 * Extracts all [m:ss] timestamps from the notes text and returns sorted unique seconds.
 * Matches the format written by the note popup.
 */
export function parseNoteTimestamps(notesText) {
  if (!notesText) return [];
  const times = new Set();
  for (const match of notesText.matchAll(NOTE_TIMESTAMP_RX)) {
    const min = parseInt(match[1], 10);
    const sec = parseInt(match[2], 10);
    times.add(min * 60 + sec);
  }
  return Array.from(times).sort((a, b) => a - b);
}

export function resolveAsset(p) {
  if (!p) return '';
  return p.startsWith('../') ? '/' + p.slice(3) : p;
}

export function findChapterIndex(chapters, t) {
  let idx = 0;
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].time <= t) idx = i;
    else break;
  }
  return idx;
}
