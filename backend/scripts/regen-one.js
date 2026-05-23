// One-off: regenerate a single guide's audio+timing in place. Usage:
//   node backend/scripts/regen-one.js <slug>
import { DatabaseSync } from 'node:sqlite';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizeGuide } from '../tts/tts-pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const slug = process.argv[2];
if (!slug) { console.error('usage: node regen-one.js <slug>'); process.exit(1); }

const dbPath = resolve(__dirname, '../databases/App.db');
const db = new DatabaseSync(dbPath);
const row = db.prepare('SELECT transcript FROM Guides WHERE slug = ?').get(slug);
if (!row?.transcript) { console.error(`no transcript for ${slug}`); process.exit(2); }

const t0 = Date.now();
let lastTick = 0;
const { audioWav, words, totalDuration } = await synthesizeGuide({
  transcript: row.transcript,
  onProgress: ({ chunksDone, chunksTotal }) => {
    const now = Date.now();
    if (now - lastTick > 1500 || chunksDone === chunksTotal) {
      lastTick = now;
      console.log(`[regen] ${chunksDone}/${chunksTotal} (${Math.round(100 * chunksDone / chunksTotal)}%)`);
    }
  },
});

const outDir = resolve(__dirname, '../public/audio');
await mkdir(outDir, { recursive: true });
const outPath = resolve(outDir, `${slug}.wav`);
await writeFile(outPath, audioWav);

const timingJson = JSON.stringify({ words });
db.prepare('UPDATE Guides SET timing_json = ?, duration = ?, audio_url = ? WHERE slug = ?')
  .run(timingJson, Math.round(totalDuration), `/audio/${slug}.wav`, slug);

console.log(`[regen] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — duration=${totalDuration.toFixed(1)}s words=${words.length} wav=${outPath}`);
