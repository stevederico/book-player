// Kokoro tokenizer — char-level vocab over IPA phonemes + punctuation.
// Source: onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/tokenizer.json
// Special token: `$` (id=0) wraps every input as BOS/EOS.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENIZER_PATH = resolve(__dirname, './tokenizer.json');

let VOCAB = null;
let BOS_ID = null;

/**
 * Load the Kokoro vocab once (cached for subsequent calls).
 *
 * @returns {Promise<{vocab: Record<string, number>, bos: number}>}
 */
async function loadVocab() {
  if (VOCAB) return { vocab: VOCAB, bos: BOS_ID };
  const raw = await readFile(TOKENIZER_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  VOCAB = parsed.model.vocab;
  BOS_ID = VOCAB['$'];
  if (BOS_ID == null) throw new Error('Kokoro tokenizer missing $ BOS token');
  return { vocab: VOCAB, bos: BOS_ID };
}

/**
 * Tokenize an IPA phoneme string into model input_ids.
 *
 * Iterates by Unicode code point (not UTF-16 units) so multi-byte IPA glyphs
 * map to a single id. Silently drops chars not in the vocab.
 *
 * @param {string} phonemes - IPA phoneme string from `phonemize()`
 * @returns {Promise<number[]>} input_ids including leading + trailing BOS
 */
export async function tokenizePhonemes(phonemes) {
  const { vocab, bos } = await loadVocab();
  const ids = [bos];
  for (const ch of phonemes) {
    if (vocab[ch] != null) ids.push(vocab[ch]);
  }
  ids.push(bos);
  return ids;
}
