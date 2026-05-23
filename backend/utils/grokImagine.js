// xAI Grok Imagine — text → image.
//
// One round-trip: POST /v1/images/generations returns a URL; we then fetch
// the URL bytes and return them as a Buffer. Caller decides where to save.
// Retries on 429/5xx with exponential backoff (1s → 2s → 4s), max 3 retries.

const GROK_IMAGE_URL = 'https://api.x.ai/v1/images/generations';
const MODEL = 'grok-imagine-image-quality';
const TIMEOUT_MS = 90_000;
const MAX_RETRIES = 3;

/**
 * Sleep for `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Call Grok Imagine and download the resulting image bytes.
 *
 * @param {Object} args
 * @param {string} args.prompt - Text prompt
 * @returns {Promise<{buffer: Buffer, contentType: string, url: string}>} Raw image bytes + reported MIME
 * @throws {Error} If XAI_API_KEY missing or all retries fail
 */
export async function generateImage({ prompt }) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set');
  if (!prompt || prompt.length < 3) throw new Error('Prompt too short');

  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(GROK_IMAGE_URL, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ model: MODEL, prompt }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`Grok Imagine ${res.status} (retryable)`);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Grok Imagine ${res.status}: ${text.slice(0, 400)}`);
      }

      const data = await res.json();
      const url = data?.data?.[0]?.url;
      if (!url) throw new Error('Grok Imagine returned no image URL');

      // Download the actual bytes.
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error(`Image download ${imgRes.status}`);
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      return {
        buffer,
        contentType: imgRes.headers.get('content-type') || 'image/png',
        url,
      };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        lastErr = new Error(`Grok Imagine timed out after ${TIMEOUT_MS / 1000}s`);
        continue;
      }
      // Non-retryable: bubble up immediately
      throw err;
    }
  }
  throw lastErr || new Error('Grok Imagine: all retries failed');
}

/**
 * Choose a file extension from a content-type header.
 *
 * @param {string} contentType
 * @returns {string} e.g. 'png', 'jpg', 'webp'
 */
export function extFromContentType(contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('png')) return 'png';
  return 'png';
}

/**
 * Simple promise-pool: caps concurrent in-flight async tasks.
 *
 * @param {number} concurrency - Max simultaneous tasks
 * @param {Array<() => Promise<any>>} tasks - Thunks that start work when invoked
 * @returns {Promise<any[]>} Results in the same order as `tasks`
 */
export async function pLimit(concurrency, tasks) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= tasks.length) return;
      try { results[i] = await tasks[i](); }
      catch (e) { results[i] = { error: e }; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}
