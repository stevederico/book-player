// Per-guide TTS pipeline.
//
// Chunks a transcript at sentence boundaries, runs `synthesize()` on each
// chunk, offsets per-word timings by the accumulated audio duration, and
// concatenates the WAV outputs into a single file. Designed to be invoked
// from a background promise — emits progress via the `onProgress` callback
// so the HTTP layer can update Guides.jobs_json without blocking.

import { synthesize, concatWav, KOKORO_SAMPLE_RATE } from './kokoro.js';

// Kokoro hard-caps input at 510 tokens (including BOS/EOS). English text
// phonemizes to roughly 1.5x its char length, so ~330 chars keeps us safe
// with headroom. Larger chunks trigger ONNX "invalid expand shape" errors
// at /encoder/bert/Expand.
const MAX_CHUNK_CHARS = 330;

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
  const chunksTotal = chunks.length;
  onProgress?.({ chunksDone: 0, chunksTotal });

  const wavs = [];
  const words = [];
  let elapsed = 0;
  for (let i = 0; i < chunks.length; i++) {
    const { audioWav, words: chunkWords, durationSec } = await synthesize(chunks[i], { voice, speed });
    for (const w of chunkWords) {
      words.push({ w: w.w, t: Number((w.t + elapsed).toFixed(3)) });
    }
    wavs.push(audioWav);
    elapsed += durationSec;
    onProgress?.({ chunksDone: i + 1, chunksTotal });
  }

  return {
    audioWav: concatWav(wavs, KOKORO_SAMPLE_RATE),
    words,
    totalDuration: Number(elapsed.toFixed(3)),
    sampleRate: KOKORO_SAMPLE_RATE,
  };
}
