// Kokoro TTS — text → {WAV bytes, per-word timestamps}.
//
// Wraps the timestamped ONNX export of Kokoro-82M:
//   onnx-community/Kokoro-82M-v1.0-ONNX-timestamped
// which adds a `durations` output tensor on top of the standard `waveform`
// (one entry per input token, in 25ms frames).
//
// Voice style embeddings (510 rows × 256 floats) are downloaded per-voice
// from the same HF repo and cached on disk under tts/models/voices/.

import ort from 'onnxruntime-node';
import { phonemize } from 'phonemizer';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenizePhonemes } from './vocab.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = resolve(__dirname, './models');
const MODEL_PATH = resolve(MODELS_DIR, 'kokoro-timestamped.onnx');
const VOICES_DIR = resolve(MODELS_DIR, 'voices');

const HF_BASE = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/resolve/main';
const MODEL_URL = `${HF_BASE}/onnx/model.onnx`;
const VOICE_URL = (voice) => `${HF_BASE}/voices/${voice}.bin`;

const SAMPLE_RATE = 24000;  // model output rate
const FRAME_RATE = 40;       // duration frames per second
const STYLE_DIM = 256;
const STYLE_ROWS = 510;      // rows in each voice .bin file

let session = null;
let sessionPromise = null;
const voiceCache = new Map(); // voice name -> Float32Array (full 510*256 buffer)

/**
 * Ensure a file exists on disk; download from `url` if missing. Creates parent dir.
 *
 * @param {string} path - Absolute destination path
 * @param {string} url - Source URL
 * @returns {Promise<void>}
 */
async function ensureFile(path, url) {
  try { await stat(path); return; } catch {}
  await mkdir(dirname(path), { recursive: true });
  console.log(`[tts] downloading ${url} → ${path}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path, buf);
}

/**
 * Lazy-load the ONNX session once. Subsequent calls return the cached session.
 *
 * @returns {Promise<ort.InferenceSession>}
 */
async function getSession() {
  if (session) return session;
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    await ensureFile(MODEL_PATH, MODEL_URL);
    const s = await ort.InferenceSession.create(MODEL_PATH);
    session = s;
    return s;
  })();
  return sessionPromise;
}

/**
 * Lazy-load a voice embedding (.bin file → Float32Array of 510 × 256 floats).
 *
 * @param {string} voice - Voice name (e.g. 'af_heart')
 * @returns {Promise<Float32Array>}
 */
async function getVoice(voice) {
  if (voiceCache.has(voice)) return voiceCache.get(voice);
  const path = resolve(VOICES_DIR, `${voice}.bin`);
  await ensureFile(path, VOICE_URL(voice));
  const buf = await readFile(path);
  const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  voiceCache.set(voice, arr);
  return arr;
}

/**
 * Encode a Float32 audio array as a 16-bit PCM WAV file.
 *
 * @param {Float32Array} samples - Mono audio in [-1, 1]
 * @param {number} sampleRate
 * @returns {Buffer} WAV file bytes
 */
function floatToWav(samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE((v * 32767) | 0, 44 + i * 2);
  }
  return buf;
}

/**
 * Concatenate multiple 16-bit PCM mono WAVs with an equal-power crossfade at
 * every boundary. Eliminates the audible click/pop that you get from raw
 * concatenation, where the last sample of chunk N rarely aligns with the
 * first sample of chunk N+1.
 *
 * Crossfade length defaults to 25ms — short enough to be inaudible, long
 * enough to mask the transition. Chunks shorter than 2× the crossfade fall
 * back to butt-joining (no fade) to avoid eating the entire chunk.
 *
 * @param {Buffer[]} wavBuffers - WAV buffers from `floatToWav` / `synthesize`
 * @param {number} sampleRate - Sample rate (must match all inputs)
 * @param {Object} [opts]
 * @param {number} [opts.fadeMs=25] - Crossfade length per boundary
 * @returns {Buffer} Concatenated WAV file bytes
 */
export function concatWav(wavBuffers, sampleRate, { fadeMs = 25 } = {}) {
  if (!wavBuffers.length) throw new Error('concatWav: no buffers');
  if (wavBuffers.length === 1) return wavBuffers[0];

  // Decode each chunk's PCM into Int16Array views (no copy).
  const samples = wavBuffers.map(b => {
    const pcm = b.subarray(44);
    return new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  });

  const fadeSamples = Math.max(1, Math.floor((fadeMs / 1000) * sampleRate));

  // Worst-case output length (no overlap). We'll trim to actual at the end.
  const maxTotal = samples.reduce((n, s) => n + s.length, 0);
  const out = new Int16Array(maxTotal);

  // Copy the first chunk wholesale.
  out.set(samples[0], 0);
  let writeIdx = samples[0].length;

  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const curr = samples[i];
    const fade = Math.min(fadeSamples, prev.length >> 1, curr.length >> 1);

    if (fade < 8) {
      // Tiny chunk — just butt-join.
      out.set(curr, writeIdx);
      writeIdx += curr.length;
      continue;
    }

    // Equal-power crossfade: tail of prev (already at writeIdx-fade..writeIdx)
    // mixes with head of curr.
    const xStart = writeIdx - fade;
    for (let j = 0; j < fade; j++) {
      const t = (j + 1) / (fade + 1);          // 0..1 excluding endpoints
      const gPrev = Math.cos(t * Math.PI / 2); // 1 → 0
      const gCurr = Math.sin(t * Math.PI / 2); // 0 → 1
      const mixed = out[xStart + j] * gPrev + curr[j] * gCurr;
      out[xStart + j] = Math.max(-32768, Math.min(32767, mixed | 0));
    }
    // Copy the rest of curr after the fade region.
    out.set(curr.subarray(fade), writeIdx);
    writeIdx += curr.length - fade;
  }

  const totalPcmBytes = writeIdx * 2;
  const file = Buffer.alloc(44 + totalPcmBytes);
  file.write('RIFF', 0); file.writeUInt32LE(36 + totalPcmBytes, 4);
  file.write('WAVE', 8); file.write('fmt ', 12);
  file.writeUInt32LE(16, 16); file.writeUInt16LE(1, 20); file.writeUInt16LE(1, 22);
  file.writeUInt32LE(sampleRate, 24); file.writeUInt32LE(sampleRate * 2, 28);
  file.writeUInt16LE(2, 32); file.writeUInt16LE(16, 34);
  file.write('data', 36); file.writeUInt32LE(totalPcmBytes, 40);
  // Copy Int16Array bytes into the file buffer.
  Buffer.from(out.buffer, out.byteOffset, totalPcmBytes).copy(file, 44);
  return file;
}

export const KOKORO_SAMPLE_RATE = SAMPLE_RATE;

/**
 * Pick the style vector matching the current input length.
 *
 * Kokoro stores 510 style vectors per voice; the one at index `min(max(L-2, 0), 509)`
 * is the right embedding for an input of L tokens (including BOS/EOS).
 *
 * @param {Float32Array} voiceBuf
 * @param {number} idsLen
 * @returns {Float32Array} 256-element style vector
 */
function pickStyle(voiceBuf, idsLen) {
  const row = Math.min(Math.max(idsLen - 2, 0), STYLE_ROWS - 1);
  return voiceBuf.slice(row * STYLE_DIM, row * STYLE_DIM + STYLE_DIM);
}

/**
 * Build per-character cumulative start times in seconds.
 *
 * `durations[i]` corresponds to `input_ids[i]`. Index 0 is BOS, so the first
 * phoneme char (index 0 of phStr) maps to durations[1], and so on.
 *
 * @param {Float32Array|Int32Array} durations - Per-token frame counts (length = ids.length)
 * @param {number} phLen - Number of phoneme chars (= ids.length - 2)
 * @returns {number[]} charTimes[i] = start time of the i-th phoneme char in seconds.
 *                    Length is phLen + 1 (the last entry is the end of the last char).
 */
function buildCharTimes(durations, phLen) {
  const times = new Array(phLen + 1);
  let cum = Number(durations[0]); // skip BOS into the start time
  for (let i = 0; i < phLen; i++) {
    times[i] = cum / FRAME_RATE;
    cum += Number(durations[i + 1]);
  }
  times[phLen] = cum / FRAME_RATE;
  return times;
}

/**
 * Generate speech for `text` and return WAV bytes plus per-word timestamps.
 *
 * Phonemization is global (one call for the whole text); we then split the
 * IPA on whitespace to recover per-word phoneme spans and pair them with
 * the original input words by position. If the pairing length disagrees
 * (e.g. phonemizer merges or drops a token), we fall back to the IPA word
 * as the surface form so timestamps still cover the audio.
 *
 * @param {string} text - Text to speak
 * @param {Object} [opts]
 * @param {string} [opts.voice='af_heart'] - One of Kokoro's 28 supported voices
 * @param {number} [opts.speed=1] - Speech rate; 1 = natural
 * @returns {Promise<{audioWav: Buffer, words: Array<{w: string, t: number}>, sampleRate: number, durationSec: number}>}
 */
export async function synthesize(text, { voice = 'af_heart', speed = 1 } = {}) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('synthesize: empty text');

  // 1. Phonemize the WHOLE chunk in ONE call. This preserves espeak's natural
  // coarticulation across word boundaries (e.g. "of the" → "ʌvðə"), which is
  // what makes Kokoro sound like continuous speech instead of each word being
  // pronounced in isolation. The per-word phonemize pass that used to live
  // here killed prosody — never again.
  const inputWords = trimmed.split(/\s+/).filter(Boolean);
  const phResult = await phonemize(trimmed, 'en-us');
  const phStr = (Array.isArray(phResult) ? phResult.join(' ') : String(phResult)).trim();

  // For timing alignment we still need to know each word's IPA so we can find
  // where it lives inside phStr. Run a second per-word phonemize pass — used
  // ONLY for the substring-match offsets, never fed to the model.
  const ipaWords = await Promise.all(
    inputWords.map(async (w) => {
      const r = await phonemize(w, 'en-us');
      return (Array.isArray(r) ? r.join(' ') : String(r)).trim();
    })
  );

  // 2. Tokenize → input_ids
  const ids = await tokenizePhonemes(phStr);
  const phChars = [...phStr]; // code-point split; length should equal ids.length - 2

  // 3. Pick style vector + load model
  const [voiceBuf, sess] = await Promise.all([getVoice(voice), getSession()]);
  const style = pickStyle(voiceBuf, ids.length);

  // 4. Build ONNX inputs
  const feeds = {
    input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    style: new ort.Tensor('float32', style, [1, STYLE_DIM]),
    speed: new ort.Tensor('float32', new Float32Array([speed]), [1]),
  };

  // 5. Run inference
  const out = await sess.run(feeds);
  const wave = out.waveform.data; // Float32Array
  const durations = out.durations.data; // Float32Array or similar

  // 6. Build per-char start times
  const charTimes = buildCharTimes(durations, phChars.length);

  // 7. Locate each input word inside phStr by substring-matching its per-word
  // IPA. Walk forward monotonically so words never appear out of order. When
  // a function word's IPA was merged by the whole-text phonemize and the
  // substring can't be found, interpolate timing from neighbors.
  const words = [];
  let searchFrom = 0;
  for (let i = 0; i < inputWords.length; i++) {
    const ipa = ipaWords[i];
    let foundAt = -1;
    if (ipa) {
      // Try exact match starting from searchFrom.
      foundAt = phStr.indexOf(ipa, searchFrom);
      // If that fails, try matching just the leading 3 chars (handles merged
      // function words where the tail got fused with the next word).
      if (foundAt < 0 && ipa.length > 3) {
        foundAt = phStr.indexOf(ipa.slice(0, 3), searchFrom);
      }
    }
    if (foundAt >= 0) {
      // Convert UTF-16 indexOf result to a code-point index for charTimes.
      const cpIdx = [...phStr.slice(0, foundAt)].length;
      const t = charTimes[cpIdx] ?? 0;
      words.push({
        w: inputWords[i],
        t: Number(t.toFixed(3)),
      });
      searchFrom = foundAt + (ipa?.length || 1);
    } else {
      // Couldn't locate this word — emit a placeholder; we'll interpolate below.
      words.push({ w: inputWords[i], t: null });
    }
  }

  // Interpolate `t: null` placeholders using neighbors so the timing array
  // stays monotonically non-decreasing for downstream highlight logic.
  const audioDur = wave.length / SAMPLE_RATE;
  for (let i = 0; i < words.length; i++) {
    if (words[i].t != null) continue;
    let prev = i;
    while (prev > 0 && words[prev].t == null) prev--;
    let next = i;
    while (next < words.length && words[next].t == null) next++;
    const prevT = prev >= 0 && words[prev].t != null ? words[prev].t : 0;
    const nextT = next < words.length && words[next].t != null ? words[next].t : audioDur;
    const span = Math.max(1, next - prev);
    words[i].t = Number((prevT + ((nextT - prevT) * (i - prev)) / span).toFixed(3));
  }

  const audioWav = floatToWav(wave, SAMPLE_RATE);
  const durationSec = audioDur;
  return { audioWav, words, sampleRate: SAMPLE_RATE, durationSec };
}
