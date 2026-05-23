import React from 'react';
import TranscriptView from './TranscriptView.jsx';

export default function PlayerInfoPanel({
  panel,
  setPanel,
  chapters,
  transcriptParas,
  guide,
  notes,
  updateNotes,
  activeIdx,
  jumpToChapter,
  activeWord,
  onWordClick,
  activeWordRef,
  fmt,
}) {
  return (
    <>
      <div className="chapters-header">
        <div className="panel-toggle" role="tablist" aria-label="Panel">
          <button
            role="tab"
            aria-selected={panel === 'chapters'}
            className={`panel-tab${panel === 'chapters' ? ' active' : ''}`}
            onClick={() => setPanel('chapters')}
          >
            Chapters
          </button>
          {guide?.transcript && (
            <button
              role="tab"
              aria-selected={panel === 'transcript'}
              className={`panel-tab${panel === 'transcript' ? ' active' : ''}`}
              onClick={() => setPanel('transcript')}
            >
              Transcript
            </button>
          )}
          <button
            role="tab"
            aria-selected={panel === 'summary'}
            className={`panel-tab${panel === 'summary' ? ' active' : ''}`}
            onClick={() => setPanel('summary')}
          >
            Summary
          </button>
          <button
            role="tab"
            aria-selected={panel === 'notes'}
            className={`panel-tab${panel === 'notes' ? ' active' : ''}`}
            onClick={() => setPanel('notes')}
          >
            Notes
          </button>
        </div>
      </div>

      {panel === 'chapters' && (
        <div className="chapters">
          {chapters.map((c, i) => (
            <div
              key={i}
              className={`chapter${i === activeIdx ? ' active' : ''}`}
              onClick={() => jumpToChapter(c, i)}
            >
              <div className="time">{fmt(c.time)}</div>
              <div className="label">{c.title}</div>
            </div>
          ))}
        </div>
      )}

      {panel === 'summary' && (
        <div className="summary-panel">
          {guide?.summary ? (
            <p className="summary-body">{guide.summary}</p>
          ) : (
            <div className="summary-empty">No summary available for this guide yet.</div>
          )}
        </div>
      )}

      {panel === 'notes' && (
        <div className="notes-panel">
          <textarea
            className="notes-textarea"
            placeholder="Write your notes here…"
            value={notes}
            onChange={e => updateNotes(e.target.value)}
            aria-label="Notes for this guide"
          />
        </div>
      )}

      {panel === 'transcript' && (
        <div className="transcript" ref={null}>
          {!guide ? (
            <div className="transcript-empty">Loading transcript…</div>
          ) : !transcriptParas ? (
            <div className="transcript-empty">Transcript unavailable.</div>
          ) : (
            <TranscriptView
              paras={transcriptParas}
              activeWord={activeWord}
              onWordClick={onWordClick}
              activeRef={activeWordRef}
            />
          )}
        </div>
      )}
    </>
  );
}
