import { useState } from 'react';

// Phases + steps that a "complete" guide needs.
// `has(g)` returns true when the field is already populated on the guide payload.
// `run` is the endpoint suffix POST'd to /api/guides/:slug/<run> to produce it.
// `requires` lists step keys that must be done first (for ordering UX).
const PHASES = [
  {
    name: 'Text',
    steps: [
      { key: 'title',      label: 'Title',         has: g => !!g.title },
      { key: 'author',     label: 'Author',        has: g => !!g.author },
      { key: 'date',       label: 'Date',          has: g => !!g.date, run: 'date' },
      { key: 'transcript', label: 'Transcript',    has: g => !!g.transcript },
      { key: 'summary',    label: 'Summary',       has: g => !!g.summary, run: 'summary' },
    ],
  },
  {
    name: 'Audio',
    steps: [
      { key: 'audio',         label: 'Audio MP3',          has: g => !!g.audio, run: 'tts' },
      { key: 'duration',      label: 'Duration',           has: g => !!g.duration },
      { key: 'timing',        label: 'Word timings',       has: g => (g.timing?.words?.length || 0) > 0 },
      { key: 'timingOffset',  label: 'Timing calibration', has: g => typeof g.timingOffset === 'number' },
    ],
  },
  {
    name: 'Chapters',
    steps: [
      { key: 'chapters',           label: 'Chapter list',         has: g => (g.chapters?.length || 0) > 0, run: 'auto-chapters', requires: ['timing'] },
      { key: 'chapter-quotes',     label: 'Chapter quotes',       has: g => g.chapters?.length > 0 && g.chapters.every(c => c.quote) },
      { key: 'chapter-captions',   label: 'Chapter captions',     has: g => g.chapters?.length > 0 && g.chapters.every(c => c.caption) },
      { key: 'chapter-images',     label: 'Illustrative images',  has: g => g.chapters?.length > 0 && g.chapters.every(c => c.image?.generated), run: 'chapter-images' },
      { key: 'chapter-real-images',label: 'Real images',          has: g => g.chapters?.length > 0 && g.chapters.every(c => c.realImage), run: 'chapter-real-images' },
    ],
  },
  {
    name: 'Library',
    steps: [
      { key: 'thumbnail',       label: 'Cover thumbnail',  has: g => !!g.thumbnail, run: 'thumbnail' },
      { key: 'defaultViewMode', label: 'Default view',     has: g => !!g.defaultViewMode },
      { key: 'visibility',      label: 'Visibility',       has: g => !!g.visibility },
    ],
  },
];

function statusFor(step, guide, busyEntry) {
  if (busyEntry?.status === 'running') return 'running';
  if (busyEntry?.status === 'failed') return 'failed';
  if (step.has(guide)) return 'done';
  return 'missing';
}

const STATUS_LABELS = {
  done: '✓',
  running: '…',
  failed: '✕',
  missing: '·',
};

export default function GuideProgress({ slug, guide, onRefresh }) {
  const [busy, setBusy] = useState({});

  if (!guide) return null;

  async function runStep(step) {
    if (!step.run) return;
    const t0 = Date.now();
    setBusy(b => ({ ...b, [step.key]: { status: 'running' } }));
    try {
      const res = await fetch(`/api/guides/${encodeURIComponent(slug)}/${step.run}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      const ms = Date.now() - t0;
      if (!res.ok) {
        setBusy(b => ({
          ...b,
          [step.key]: { status: 'failed', error: body.error || `HTTP ${res.status}`, hint: body.hint, ms },
        }));
        return;
      }
      setBusy(b => ({ ...b, [step.key]: { status: 'done', ms } }));
      onRefresh?.();
    } catch (err) {
      setBusy(b => ({
        ...b,
        [step.key]: { status: 'failed', error: err.message || 'Network error', ms: Date.now() - t0 },
      }));
    }
  }

  const allDone = PHASES.every(p => p.steps.every(s => s.has(guide)));
  const totalSteps = PHASES.reduce((n, p) => n + p.steps.length, 0);
  const doneSteps = PHASES.reduce(
    (n, p) => n + p.steps.filter(s => s.has(guide)).length,
    0
  );

  return (
    <div className="guide-progress">
      <div className="guide-progress-head">
        <strong>Guide completeness</strong>
        <span className="guide-progress-count">
          {doneSteps} / {totalSteps} {allDone ? '— complete' : ''}
        </span>
      </div>

      {PHASES.map(phase => (
        <div key={phase.name} className="guide-progress-phase">
          <div className="guide-progress-phase-name">{phase.name}</div>
          <ul className="guide-progress-list">
            {phase.steps.map(step => {
              const entry = busy[step.key];
              const status = statusFor(step, guide, entry);
              return (
                <li key={step.key} className={`gp-row gp-row-${status}`}>
                  <span className={`gp-icon gp-icon-${status}`} aria-hidden="true">
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="gp-label">{step.label}</span>
                  {entry?.ms != null && (
                    <span className="gp-ms">{entry.ms}ms</span>
                  )}
                  {step.run && status !== 'done' && (
                    <button
                      type="button"
                      className="gp-run-btn"
                      disabled={status === 'running'}
                      onClick={() => runStep(step)}
                    >
                      {status === 'running' ? 'Running…' : 'Run'}
                    </button>
                  )}
                  {entry?.status === 'failed' && (
                    <div className="gp-error">
                      {entry.error}
                      {entry.hint && <span className="gp-hint"> — {entry.hint}</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
