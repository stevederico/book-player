import { useEffect, useRef, useState } from 'react';

// Phases + steps that a "complete" guide needs.
// `has(g)` returns true when the field is already populated on the guide payload.
// `run` is the endpoint suffix POST'd to /api/guides/:slug/<run> to produce it.
// `requires` lists step keys that must be done first (for ordering UX).
// `pollWhileRunning` means the step returns 202 + a background job; poll the
// guide payload every POLL_INTERVAL_MS until guide.jobs[run].status flips to
// 'done' (then has() goes true) or 'failed'.
const POLL_INTERVAL_MS = 2500;

const PHASES = [
  {
    name: 'Text',
    steps: [
      { key: 'title',      label: 'Title',         has: g => !!g.title },
      { key: 'author',     label: 'Author',        has: g => !!g.author, run: 'analyze' },
      { key: 'date',       label: 'Date',          has: g => !!g.date, run: 'date' },
      { key: 'transcript', label: 'Transcript',    has: g => !!g.transcript },
      { key: 'summary',    label: 'Summary',       has: g => !!g.summary, run: 'analyze' },
    ],
  },
  {
    name: 'Audio',
    steps: [
      { key: 'audio',         label: 'Audio',              has: g => !!g.audio, run: 'tts', pollWhileRunning: true },
      { key: 'duration',      label: 'Duration',           has: g => !!g.duration },
      { key: 'timing',        label: 'Word timings',       has: g => (g.timing?.words?.length || 0) > 0 },
      { key: 'timingOffset',  label: 'Timing calibration', has: g => typeof g.timingOffset === 'number' },
    ],
  },
  {
    name: 'Chapters',
    steps: [
      { key: 'chapters',           label: 'Chapter outlines',     has: g => (g.chapters?.length || 0) > 0, run: 'analyze' },
      { key: 'chapter-timing',     label: 'Chapter times',        has: g => g.chapters?.length > 0 && (g.chapters.length === 1 || g.chapters.slice(1).every(c => Number(c.time) > 0)), run: 'chapter-timing' },
      { key: 'chapter-quotes',     label: 'Chapter quotes',       has: g => g.chapters?.length > 0 && g.chapters.every(c => c.quote) },
      { key: 'chapter-captions',   label: 'Chapter captions',     has: g => g.chapters?.length > 0 && g.chapters.every(c => c.caption) },
      { key: 'chapter-images',     label: 'Illustrative images',  has: g => g.chapters?.length > 0 && g.chapters.every(c => c.image?.generated), run: 'chapter-images', pollWhileRunning: true },
      { key: 'chapter-real-images',label: 'Real images',          has: g => g.chapters?.length > 0 && g.chapters.every(c => c.realImage), run: 'chapter-real-images', pollWhileRunning: true },
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

function statusFor(step, guide) {
  if (step.has(guide)) return 'done';
  const serverJob = step.run ? guide.jobs?.[step.run] : null;
  if (serverJob?.status === 'running') return 'running';
  if (serverJob?.status === 'failed') return 'failed';
  return 'missing';
}

const STATUS_LABELS = {
  done: '✓',
  running: '…',
  failed: '✕',
  missing: '·',
};

export default function GuideProgress({ slug, guide, onRefresh }) {
  const pollersRef = useRef({});

  // Stop any pollers on unmount or when slug changes.
  useEffect(() => {
    const pollers = pollersRef.current;
    return () => {
      for (const id of Object.values(pollers)) clearInterval(id);
    };
  }, [slug]);

  // If a server-side job is already running on mount (e.g. user refreshed mid-job),
  // start polling for it without an explicit button press.
  useEffect(() => {
    if (!guide?.jobs) return;
    for (const phase of PHASES) {
      for (const step of phase.steps) {
        if (!step.run || !step.pollWhileRunning) continue;
        if (guide.jobs[step.run]?.status === 'running' && !pollersRef.current[step.key]) {
          startPolling(step);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guide?.jobs]);

  if (!guide) return null;

  function startPolling(step) {
    if (pollersRef.current[step.key]) return;
    pollersRef.current[step.key] = setInterval(() => {
      onRefresh?.();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling(stepKey) {
    const id = pollersRef.current[stepKey];
    if (id) {
      clearInterval(id);
      delete pollersRef.current[stepKey];
    }
  }

  // When the guide payload says the job finished, stop polling and reflect the result.
  for (const phase of PHASES) {
    for (const step of phase.steps) {
      if (!step.pollWhileRunning) continue;
      const serverJob = step.run ? guide.jobs?.[step.run] : null;
      if (pollersRef.current[step.key] && serverJob && serverJob.status !== 'running') {
        stopPolling(step.key);
      }
    }
  }

  // Toggle the guide visibility to 'public'. Used by the Publish button when
  // the pipeline has finished.
  async function publish() {
    const r = await fetch(`/api/guides/${encodeURIComponent(slug)}`);
    if (!r.ok) return;
    const g = await r.json();
    await fetch(`/api/guides`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...g, visibility: 'public' }),
    });
    onRefresh?.();
  }

  const allDone = PHASES.every(p => p.steps.every(s => s.has(guide)));
  const anyRunning = PHASES.some(p => p.steps.some(s => {
    const sj = s.run ? guide.jobs?.[s.run] : null;
    return sj?.status === 'running';
  }));
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
          {doneSteps} / {totalSteps} {allDone ? '— complete' : anyRunning ? '— building…' : ''}
        </span>
        {allDone && guide.visibility !== 'public' && (
          <button type="button" className="gp-run-btn" onClick={publish}>
            Publish
          </button>
        )}
      </div>

      {PHASES.map(phase => (
        <div key={phase.name} className="guide-progress-phase">
          <div className="guide-progress-phase-name">{phase.name}</div>
          <ul className="guide-progress-list">
            {phase.steps.map(step => {
              const status = statusFor(step, guide);
              const serverJob = step.run ? guide.jobs?.[step.run] : null;
              const progress = status === 'running' && serverJob?.chunksTotal
                ? `${serverJob.chunksDone || 0}/${serverJob.chunksTotal}`
                : null;
              const serverError = status === 'failed' && serverJob?.error;
              return (
                <li key={step.key} className={`gp-row gp-row-${status}`}>
                  <span className={`gp-icon gp-icon-${status}`} aria-hidden="true">
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="gp-label">{step.label}</span>
                  {progress && <span className="gp-ms">{progress}</span>}
                  {status === 'running' && !progress && <span className="gp-ms">running…</span>}
                  {serverError && (
                    <div className="gp-error">{serverError}</div>
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
