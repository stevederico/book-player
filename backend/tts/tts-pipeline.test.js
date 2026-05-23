import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { concatWav } from './kokoro.js';

// Re-import internals via dynamic export-shim isn't needed; chunkBySentence
// is module-internal so we test it indirectly through the public behavior
// of synthesizeGuide. For unit-testable chunking, expose a small helper.

import { synthesizeGuide } from './tts-pipeline.js';

describe('concatWav', () => {
  it('merges two WAVs into one with correct length', () => {
    // Build two trivial 16-bit PCM WAVs (1 sample each, value 0)
    function buildWav(samples) {
      const buf = Buffer.alloc(44 + samples.length * 2);
      buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4);
      buf.write('WAVE', 8); buf.write('fmt ', 12);
      buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
      buf.writeUInt32LE(24000, 24); buf.writeUInt32LE(48000, 28);
      buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
      buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
      for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2);
      return buf;
    }
    const a = buildWav([100, 200, 300]);
    const b = buildWav([400, 500]);
    const out = concatWav([a, b], 24000);
    assert.equal(out.length, 44 + (3 + 2) * 2, 'concatenated length matches header+pcm');
    assert.equal(out.slice(0, 4).toString(), 'RIFF');
    assert.equal(out.slice(8, 12).toString(), 'WAVE');
    // 5 samples of int16 = 10 bytes of data
    assert.equal(out.readUInt32LE(40), 10, 'data chunk size == total PCM');
  });
});

describe('synthesizeGuide', () => {
  it('rejects very short transcripts', async () => {
    await assert.rejects(
      () => synthesizeGuide({ transcript: 'hi' }),
      /too short/i,
    );
  });
});
