/**
 * Migrate guide content from public/ static files into the SQLite Guides table.
 *
 * Reads:
 *   <repoRoot>/public/guides/index.json      — array of guide summaries
 *   <repoRoot>/public/guides/<slug>.json     — full guide manifest per slug
 *   <repoRoot>/public/essays/...              — transcript (path comes from guide.transcript)
 *   <repoRoot>/public/audio/...words.json     — word timings (path comes from guide.timing)
 *
 * Idempotent — upserts by slug. Safe to re-run after editing source files.
 *
 * Usage:
 *   cd backend && node scripts/migrate-guides.js
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseManager } from '../adapters/manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = resolve(__dirname, '..');
const repoRoot = resolve(backendDir, '..');
const publicDir = resolve(repoRoot, 'public');

const dbConfig = await loadDbConfig();

/**
 * Load and parse JSON from a file path. Returns null if the file is missing.
 *
 * @param {string} path - Absolute file path
 * @returns {Promise<*>} Parsed JSON, or null if file not found
 */
async function readJson(path) {
  try {
    const buf = await readFile(path, 'utf8');
    return JSON.parse(buf);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Load backend/config.json to discover the SQLite connection.
 *
 * @returns {Promise<{dbType: string, db: string, connectionString: string}>}
 */
async function loadDbConfig() {
  const raw = await readFile(resolve(backendDir, 'config.json'), 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.database;
}

/**
 * Resolve a content URL like "/essays/brandage.txt" to an absolute filesystem path
 * inside the repo's public/ directory. Returns null for non-public URLs.
 *
 * @param {string|undefined|null} url - URL referenced in the guide manifest
 * @returns {string|null} Absolute path or null
 */
function publicUrlToPath(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith('/')) return null;
  return join(publicDir, url.replace(/^\/+/, ''));
}

/**
 * Build a guide payload ready for upsertGuide() from a raw manifest file.
 *
 * Inlines the transcript text and word-timing payload by reading the referenced
 * files. Leaves audio + thumbnail URLs as-is — those still resolve to filesystem
 * assets served by the backend.
 *
 * @param {Object} manifest - Parsed JSON from public/guides/<slug>.json
 * @returns {Promise<Object>} Guide payload for upsertGuide
 */
async function buildGuidePayload(manifest) {
  const transcriptPath = publicUrlToPath(manifest.transcript);
  const timingPath = publicUrlToPath(manifest.timing);
  let transcript = null;
  let timing = null;
  if (transcriptPath) {
    try { transcript = await readFile(transcriptPath, 'utf8'); }
    catch (err) { console.warn(`[skip transcript] ${manifest.slug}: ${err.message}`); }
  }
  if (timingPath) {
    const parsed = await readJson(timingPath);
    if (parsed) timing = parsed;
  }
  return {
    slug: manifest.slug,
    title: manifest.title,
    author: manifest.author ?? null,
    date: manifest.date ?? null,
    duration: manifest.duration ?? null,
    audio: manifest.audio ?? null,
    thumbnail: manifest.thumbnail ?? null,
    timingOffset: typeof manifest.timingOffset === 'number' ? manifest.timingOffset : 0,
    defaultViewMode: manifest.defaultViewMode || 'real',
    transcript,
    chapters: Array.isArray(manifest.chapters) ? manifest.chapters : [],
    timing,
    visibility: 'public',
  };
}

/**
 * Resolve the list of slugs to migrate and any per-slug overrides drawn from
 * index.json (notably `thumbnail`, which the per-slug manifest doesn't carry).
 *
 * Prefers public/guides/index.json so the migration matches what the
 * frontend currently displays. Falls back to discovering <slug>.json files
 * in public/guides/.
 *
 * @returns {Promise<{slugs: string[], overrides: Object<string, Object>}>}
 */
async function discoverSlugs() {
  const indexPath = resolve(publicDir, 'guides', 'index.json');
  const index = await readJson(indexPath);
  if (Array.isArray(index) && index.length) {
    const overrides = Object.fromEntries(
      index.filter(e => e?.slug).map(e => [e.slug, e]),
    );
    return { slugs: Object.keys(overrides), overrides };
  }
  // Fallback: glob *.json (excluding index.json) in public/guides/
  const dir = resolve(publicDir, 'guides');
  let entries = [];
  try { entries = await readdir(dir); }
  catch { return { slugs: [], overrides: {} }; }
  const slugs = entries
    .filter(name => name.endsWith('.json') && name !== 'index.json')
    .map(name => name.replace(/\.json$/, ''));
  return { slugs, overrides: {} };
}

async function main() {
  const { slugs, overrides } = await discoverSlugs();
  if (slugs.length === 0) {
    console.log('No guides found under public/guides/. Nothing to migrate.');
    return;
  }
  console.log(`Found ${slugs.length} guide(s): ${slugs.join(', ')}`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  for (const slug of slugs) {
    const manifestPath = resolve(publicDir, 'guides', `${slug}.json`);
    const manifest = await readJson(manifestPath);
    if (!manifest) {
      console.warn(`[skip] ${slug}: no manifest at ${manifestPath}`);
      skipped++;
      continue;
    }
    if (!manifest.slug) manifest.slug = slug;
    // Merge in fields that only live in index.json (e.g. thumbnail).
    // Per-slug manifest wins for any overlapping key.
    const merged = { ...(overrides[slug] || {}), ...manifest };
    const payload = await buildGuidePayload(merged);
    const result = await databaseManager.upsertGuide(
      dbConfig.dbType, dbConfig.db, dbConfig.connectionString, payload,
    );
    if (result.inserted) {
      inserted++;
      console.log(`  + inserted ${slug}`);
    } else {
      updated++;
      console.log(`  ~ updated  ${slug}`);
    }
  }

  console.log(`\nDone. inserted=${inserted} updated=${updated} skipped=${skipped}`);
  await databaseManager.closeAll();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
