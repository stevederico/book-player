// LLM-generated 2-3 paragraph summary of a transcript.
//
// Calls xAI Grok via the OpenAI-compatible chat/completions endpoint —
// same auth + endpoint pattern as backend/tts/chapters.js.

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions';
const MODEL = 'grok-4.3';
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 60_000;

/**
 * Build the prompt that asks Grok for a summary + author.
 *
 * Returns JSON so we can parse both fields from one call. The model is
 * instructed to emit null for author when it can't determine one — never
 * to guess.
 *
 * @param {string} transcript - Full essay text
 * @returns {string}
 */
function buildPrompt(transcript) {
  return `Read the essay below and return ONLY a JSON object with two fields:

{
  "summary": "<2-3 paragraph plain-prose summary, ~150 words, no preamble, no headings, no markdown, no quotation marks>",
  "author": "<the author's name as a plain string, e.g. \\"Paul Graham\\", or null if it cannot be determined from the text>"
}

Rules:
- Only set author when you are confident — never guess from style alone.
- Do NOT wrap the response in code fences. Return raw JSON only.

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
function parseSummaryResponse(raw) {
  let text = (raw || '').trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  return JSON.parse(text);
}

/**
 * Generate a plain-text summary + extracted author for a guide.
 *
 * @param {Object} args
 * @param {string} args.transcript - Full essay text (min ~50 chars)
 * @returns {Promise<{summary: string, author: string|null}>}
 * @throws {Error} If XAI_API_KEY is missing, transcript too short, or the API call fails
 */
export async function summarize({ transcript }) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set');
  if (!transcript || transcript.length < 50) throw new Error('Transcript too short');

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
        messages: [{ role: 'user', content: buildPrompt(transcript) }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`xAI API ${res.status}: ${errText.slice(0, 400)}`);
    }
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const parsed = parseSummaryResponse(raw);
    const summary = String(parsed.summary || '').trim().replace(/^["']|["']$/g, '');
    if (!summary) throw new Error('Empty summary from model');
    const author = typeof parsed.author === 'string' && parsed.author.trim() ? parsed.author.trim() : null;
    return { summary, author };
  } finally {
    clearTimeout(timer);
  }
}
