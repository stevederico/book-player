// One-shot Grok call: author + summary + chapter outlines for an essay.
//
// Replaces the previous two calls (summary + auto-chapters). Chapter times
// are filled in separately by `attachChapterTimes()` once word timings exist,
// so this module never hits the model more than once per guide.

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions';
const MODEL = 'grok-4.3';
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 90_000;

/**
 * Build the prompt that asks Grok for everything in one JSON object.
 *
 * @param {string} transcript - Full essay text
 * @param {number} [chapterTarget=8] - Suggested chapter count
 * @param {string} [sourceUrl] - URL the essay was scraped from; helps identify author
 * @returns {string}
 */
function buildPrompt(transcript, chapterTarget = 8, sourceUrl = '') {
  const sourceLine = sourceUrl
    ? `\nSource URL (use this to help identify the author — e.g. paulgraham.com → "Paul Graham"): ${sourceUrl}\n`
    : '';
  return `Read the essay below and return ONLY a JSON object with these fields:

{
  "author": "<author's name as plain string (e.g. \\"Paul Graham\\"), or null if you cannot determine it confidently>",
  "summary": "<2-3 paragraph plain-prose summary, ~150 words, no preamble, no headings, no markdown, no quotes>",
  "chapters": [
    {
      "title": "<2-6 word headline, no trailing punctuation>",
      "quote": "<verbatim 4-12 word phrase copied EXACTLY from the transcript that opens this chapter>",
      "caption": "<one sentence, max 18 words, summarizing the chapter>"
    },
    ...
  ]
}

Rules for chapters:
- Aim for about ${chapterTarget} chapters.
- Chapter 1's quote must be the very beginning of the transcript.
- Each "quote" must be a direct copy-paste from the transcript text below — no paraphrasing.
- Quotes must appear in the order they occur in the transcript.

Rules for author:
- Use the source URL and any byline / signature in the transcript to determine the author.
- Recognize well-known author domains (e.g. paulgraham.com → Paul Graham, patio11.com → Patrick McKenzie, stratechery.com → Ben Thompson, waitbutwhy.com → Tim Urban).
- Set null only when nothing in the URL or text identifies the author.
${sourceLine}
Return raw JSON only — no code fences, no prose.

Essay:
"""
${transcript}
"""`;
}

/**
 * Strip code fences / prose and pull a JSON object out of model output.
 *
 * @param {string} raw
 * @returns {Object}
 */
function parseJsonObject(raw) {
  let text = (raw || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  return JSON.parse(text);
}

/**
 * Run a single Grok call to extract author, summary, and chapter outlines.
 *
 * Chapter outlines have title/quote/caption but NO time yet — call
 * `attachChapterTimes()` once you have word timings from TTS.
 *
 * @param {Object} args
 * @param {string} args.transcript - Full essay text (min ~50 chars)
 * @param {number} [args.durationSec] - Audio duration (if known) to size chapter count
 * @returns {Promise<{author: string|null, summary: string, chapterOutlines: Array<{title:string, quote:string, caption:string}>}>}
 * @throws {Error} If XAI_API_KEY is missing, transcript too short, or the API call fails
 */
export async function analyzeTranscript({ transcript, durationSec, sourceUrl }) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set');
  if (!transcript || transcript.length < 50) throw new Error('Transcript too short');

  const chapterTarget = durationSec
    ? Math.max(6, Math.min(15, Math.round(durationSec / 180)))
    : 8;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(XAI_API_URL, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: buildPrompt(transcript, chapterTarget, sourceUrl) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`xAI API ${res.status}: ${errText.slice(0, 400)}`);
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const parsed = parseJsonObject(raw);

    const summary = String(parsed.summary || '').trim().replace(/^["']|["']$/g, '');
    if (!summary) throw new Error('Empty summary from model');
    const author = typeof parsed.author === 'string' && parsed.author.trim()
      ? parsed.author.trim()
      : null;
    const chapterOutlines = Array.isArray(parsed.chapters)
      ? parsed.chapters
          .map(ch => ({
            title: String(ch.title || '').trim(),
            quote: String(ch.quote || '').trim(),
            caption: String(ch.caption || '').trim(),
          }))
          .filter(ch => ch.title && ch.quote)
      : [];

    return { author, summary, chapterOutlines };
  } finally {
    clearTimeout(timer);
  }
}

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
 * timed-word stream. Walks forward from `fromIdx` and matches the first
 * 1-3 quote tokens in sequence.
 *
 * @param {Array<{w: string, t: number}>} words
 * @param {string} quote
 * @param {number} fromIdx
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
  const first = tokens[0];
  for (let i = fromIdx; i < words.length; i++) {
    if (norm(words[i].w) === first) return { time: words[i].t, nextIdx: i + 1 };
  }
  return { time: null, nextIdx: fromIdx };
}

/**
 * Attach `time` to each chapter outline by matching its `quote` against the
 * word-timing stream. Drops chapters whose quote cannot be located.
 *
 * @param {Object} args
 * @param {Array<{title:string, quote:string, caption:string}>} args.chapterOutlines
 * @param {Array<{w: string, t: number}>} args.words
 * @returns {Array<{time:number, title:string, quote:string, caption:string}>}
 */
export function attachChapterTimes({ chapterOutlines, words }) {
  if (!Array.isArray(chapterOutlines) || !chapterOutlines.length) return [];
  if (!Array.isArray(words) || !words.length) return [];

  let cursor = 0;
  const out = [];
  for (const ch of chapterOutlines) {
    const { time, nextIdx } = findQuoteTime(words, ch.quote, cursor);
    if (time == null) continue;
    out.push({ time: Number(time.toFixed(2)), title: ch.title, quote: ch.quote, caption: ch.caption });
    cursor = nextIdx;
  }
  // Force chapter 1 to start at 0
  if (out.length) out[0].time = 0;
  return out;
}
