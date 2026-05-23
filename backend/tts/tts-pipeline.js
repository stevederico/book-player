// Per-guide TTS pipeline.
//
// Chunks a transcript at sentence boundaries, runs `synthesize()` on each
// chunk, offsets per-word timings by the accumulated audio duration, and
// concatenates the WAV outputs into a single file. Designed to be invoked
// from a background promise — emits progress via the `onProgress` callback
// so the HTTP layer can update Guides.jobs_json without blocking.

import { synthesize, concatWav, KOKORO_SAMPLE_RATE } from './kokoro.js';

/**
 * Synthesize one chunk, and if Kokoro complains about input length
 * ("invalid expand shape"), recursively split the chunk in half on the
 * nearest sentence boundary and retry each half. Returns an array of
 * { audioWav, words, durationSec } segments in order.
 *
 * @param {string} text
 * @param {Object} opts - Passed through to synthesize()
 * @returns {Promise<Array<{audioWav: Buffer, words: Array<{w:string,t:number}>, durationSec: number}>>}
 */
async function synthesizeWithFallback(text, opts) {
  try {
    const r = await synthesize(text, opts);
    return [r];
  } catch (err) {
    const msg = String(err?.message || '');
    const recoverable = /expand shape|expand node|out of range|token.*exceed/i.test(msg);
    if (!recoverable) throw err;
    // Split in half at the nearest sentence boundary (or char midpoint if none).
    const sentences = text.split(/(?<=[.!?])\s+/);
    if (sentences.length < 2) {
      const mid = Math.floor(text.length / 2);
      const left = text.slice(0, mid);
      const right = text.slice(mid);
      const a = await synthesizeWithFallback(left, opts);
      const b = await synthesizeWithFallback(right, opts);
      return [...a, ...b];
    }
    const half = Math.floor(sentences.length / 2);
    const left = sentences.slice(0, half).join(' ');
    const right = sentences.slice(half).join(' ');
    const a = await synthesizeWithFallback(left, opts);
    const b = await synthesizeWithFallback(right, opts);
    return [...a, ...b];
  }
}

// Kokoro hard-caps input at 510 tokens (including BOS/EOS). For English the
// phonemizer is roughly 1:1 (sometimes 1:1.2) on char-to-phoneme, so ~450
// chars lands at ~400-500 tokens — under the cap with headroom while giving
// the model enough text per chunk (3-5 sentences) to maintain prosody and
// intonation across sentence boundaries. Smaller chunks → flat, choppy
// pronunciation; larger chunks → "invalid expand shape" ONNX error at
// /encoder/bert/Expand.
const MAX_CHUNK_CHARS = 380;

/**
 * Split text into chunks of at most `maxChars` characters, breaking only at
 * sentence boundaries (period/!/? followed by whitespace). Falls back to a
 * hard split if any single sentence is longer than `maxChars`.
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {string[]}
 */
function chunkBySentence(text, maxChars = MAX_CHUNK_CHARS) {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  const chunks = [];
  let buf = '';
  for (const s of sentences) {
    if (s.length > maxChars) {
      if (buf) { chunks.push(buf); buf = ''; }
      for (let i = 0; i < s.length; i += maxChars) {
        chunks.push(s.slice(i, i + maxChars));
      }
      continue;
    }
    if (buf.length + s.length + 1 > maxChars) {
      chunks.push(buf);
      buf = s;
    } else {
      buf = buf ? `${buf} ${s}` : s;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * Run Kokoro TTS over an entire transcript, chunk-by-chunk, returning a single
 * WAV buffer plus the merged per-word timing stream.
 *
 * @param {Object} args
 * @param {string} args.transcript - Full essay text
 * @param {string} [args.voice='af_heart'] - Kokoro voice id
 * @param {number} [args.speed=1] - Speech rate
 * @param {function({chunksDone: number, chunksTotal: number}): void} [args.onProgress]
 * @returns {Promise<{audioWav: Buffer, words: Array<{w: string, t: number}>, totalDuration: number, sampleRate: number}>}
 */
export async function synthesizeGuide({ transcript, voice = 'af_heart', speed = 1, onProgress }) {
  if (!transcript || transcript.length < 50) throw new Error('Transcript too short');

  const chunks = chunkBySentence(transcript);
  let chunksTotal = chunks.length;
  onProgress?.({ chunksDone: 0, chunksTotal });

  const wavs = [];
  const words = [];
  let elapsed = 0;
  let done = 0;
  for (let i = 0; i < chunks.length; i++) {
    const result = await synthesizeWithFallback(chunks[i], { voice, speed });
    for (const segment of result) {
      for (const w of segment.words) {
        words.push({ w: w.w, t: Number((w.t + elapsed).toFixed(3)) });
      }
      wavs.push(segment.audioWav);
      elapsed += segment.durationSec;
    }
    done += 1;
    onProgress?.({ chunksDone: done, chunksTotal });
  }

  return {
    audioWav: concatWav(wavs, KOKORO_SAMPLE_RATE),
    words,
    totalDuration: Number(elapsed.toFixed(3)),
    sampleRate: KOKORO_SAMPLE_RATE,
  };
}
