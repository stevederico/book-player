// AI-generated chapters from a transcript + word timings.
//
// Calls xAI Grok via the OpenAI-compatible chat/completions endpoint —
// no SDK dep. The model returns a JSON array of chapter objects; we look
// up each chapter's start time by finding the first word of the quote in
// the supplied word-timing array.

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions';
const MODEL = 'grok-4.3';
const MAX_TOKENS = 4096;

/**
 * Lowercase + strip non-alphanumeric so quote matching survives punctuation/case.
 *
 * @param {string} s
 * @returns {string}
 */
function norm(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Find the start time (in seconds) of the first word of `quote` inside the
 * timed-word stream. Match is whole-word, case-insensitive, punctuation-tolerant.
 *
 * Walks the words array from `fromIdx` and matches the first 1-3 quote tokens
 * in sequence. Returns the matched word's `t` plus the next-token index for
 * monotonic scanning across chapters.
 *
 * @param {Array<{w: string, t: number}>} words - Word-timing stream
 * @param {string} quote - Chapter quote from the model
 * @param {number} fromIdx - Search start index (for monotonic scan)
 * @returns {{ time: number|null, nextIdx: number }}
 */
function findQuoteTime(words, quote, fromIdx = 0) {
  const tokens = norm(quote).split(/\s+/).filter(Boolean);
  if (!tokens.length || !words?.length) return { time: null, nextIdx: fromIdx };

  const probe = tokens.slice(0, Math.min(3, tokens.length));
  for (let i = fromIdx; i <= words.length - probe.length; i++) {
    let ok = true;
    for (let j = 0; j < probe.length; j++) {
      if (norm(words[i + j].w) !== probe[j]) { ok = false; break; }
    }
    if (ok) return { time: words[i].t, nextIdx: i + probe.length };
  }
  // Fallback: try first token alone, single-pass forward.
  const first = tokens[0];
  for (let i = fromIdx; i < words.length; i++) {
    if (norm(words[i].w) === first) return { time: words[i].t, nextIdx: i + 1 };
  }
  return { time: null, nextIdx: fromIdx };
}

/**
 * Build the prompt that asks Claude for chapter divisions.
 *
 * @param {string} transcript - Full essay text
 * @param {number} durationSec - Total audio duration (helps the model size chapter count)
 * @returns {string}
 */
function buildPrompt(transcript, durationSec) {
  const targetChapters = Math.max(6, Math.min(15, Math.round(durationSec / 180)));
  return `You are splitting an audio essay into chapters for a visual player.

Total audio duration: ${Math.round(durationSec)}s. Aim for about ${targetChapters} chapters.

For each chapter, return:
- "title": 2-6 words, headline style, no trailing punctuation
- "quote": a verbatim phrase (4-12 words) copied EXACTLY from the transcript that opens that chapter. Must appear in the transcript exactly as written. This is the anchor used to compute the chapter's start time.
- "caption": one sentence (max 18 words) summarizing what happens in this chapter

Rules:
- Chapter 1 must start at the beginning of the transcript.
- Each "quote" must be a direct copy-paste from the transcript text below — no paraphrasing.
- Quotes must appear in the order they occur in the transcript.
- Return ONLY a JSON array, no prose, no markdown fences.

Transcript:
"""
${transcript}
"""`;
}

/**
 * Strip code fences and parse the model's JSON output. Throws on bad JSON.
 *
 * @param {string} raw - Raw text from Claude
 * @returns {Array}
 */
function parseChapters(raw) {
  let text = (raw || '').trim();
  // Strip ```json ... ``` or ``` ... ``` if present
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  // If the model wrapped in prose, find the first '[' and matching last ']'
  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error('Model did not return an array');
  return parsed;
}

/**
 * Generate AI chapters for a guide.
 *
 * Calls Claude with the transcript, parses returned chapters, and looks up
 * each chapter's start time by finding the first 1-3 words of its quote in
 * the word-timing stream. Chapters whose quote can't be located are dropped.
 *
 * @param {Object} args
 * @param {string} args.transcript - Full essay text
 * @param {Array<{w: string, t: number}>} args.words - Word-timing stream
 * @param {number} args.durationSec - Total audio duration
 * @returns {Promise<Array<{time: number, title: string, quote: string, caption: string}>>}
 * @throws {Error} If XAI_API_KEY is missing or the API call fails
 */
export async function generateChapters({ transcript, words, durationSec }) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set');
  if (!transcript || transcript.length < 50) throw new Error('Transcript too short');
  if (!Array.isArray(words) || !words.length) throw new Error('Missing word timings');

  const res = await fetch(XAI_API_URL, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: buildPrompt(transcript, durationSec) }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`xAI API ${res.status}: ${errText.slice(0, 400)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content || '';
  const rawChapters = parseChapters(raw);

  // Resolve times via monotonic forward scan
  let cursor = 0;
  const chapters = [];
  for (const ch of rawChapters) {
    const quote = String(ch.quote || '').trim();
    const title = String(ch.title || '').trim();
    const caption = String(ch.caption || '').trim();
    if (!quote || !title) continue;
    const { time, nextIdx } = findQuoteTime(words, quote, cursor);
    if (time == null) continue;
    chapters.push({ time: Number(time.toFixed(2)), title, quote, caption });
    cursor = nextIdx;
  }
  // Force chapter 1 to start at 0
  if (chapters.length) chapters[0].time = 0;
  return chapters;
}
