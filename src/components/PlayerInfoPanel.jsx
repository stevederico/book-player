import React from 'react';
import TranscriptView from './TranscriptView.jsx';

const TAB_CLS =
  "font-['Bricolage_Grotesque',system-ui,sans-serif] text-[0.92rem] font-bold tracking-[-0.01em] text-muted-foreground bg-transparent border-none py-1.5 px-3.5 rounded-full cursor-pointer transition-colors hover:text-foreground data-[active]:bg-muted data-[active]:text-foreground";

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
  transcriptScrollRef,
  fmt,
  onTextSelected,
  highlightedNoteRange,
}) {
  return (
    <>
      <div className="font-['Bricolage_Grotesque',system-ui,sans-serif] text-[1.1rem] font-bold tracking-[-0.02em] text-foreground py-2 pb-3.5 flex items-center justify-between gap-3 border-b border-border mb-1.5">
        <div className="inline-flex gap-1 bg-card rounded-full p-[3px]" role="tablist" aria-label="Panel">
          {[
            { key: 'summary',    label: 'Summary',    show: true },
            { key: 'chapters',   label: 'Chapters',   show: true },
            { key: 'transcript', label: 'Transcript', show: !!guide?.transcript },
            { key: 'notes',      label: 'Notes',      show: true },
          ].filter(t => t.show).map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={panel === t.key}
              data-active={panel === t.key || undefined}
              onClick={() => setPanel(t.key)}
              className={TAB_CLS}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {panel === 'chapters' && (
        <div>
          {chapters.map((c, i) => {
            const isActive = i === activeIdx;
            return (
              <div
                key={i}
                data-active={isActive || undefined}
                onClick={() => jumpToChapter(c, i)}
                className="group/chapter flex items-center gap-3.5 py-3 px-3 bg-transparent border-none border-l-2 border-l-transparent cursor-pointer transition-[background-color,border-color,padding-left] duration-150 text-[0.92rem] font-medium w-full text-left text-foreground rounded hover:bg-card hover:pl-4 data-[active]:bg-muted data-[active]:border-l-[var(--accent)]"
              >
                <div className="font-['Manrope',system-ui,sans-serif] tabular-nums font-semibold text-muted-foreground w-[46px] shrink-0 text-[0.78rem] tracking-[0.02em] group-data-[active]/chapter:text-[var(--accent)]">
                  {fmt(c.time)}
                </div>
                <div className="flex-1 tracking-[-0.005em] group-data-[active]/chapter:font-bold">{c.title}</div>
              </div>
            );
          })}
        </div>
      )}

      {panel === 'summary' && (
        <div className="py-3.5 px-1.5 pb-6 font-['Manrope',system-ui,sans-serif]">
          {guide?.summary ? (
            <p className="text-[1.02rem] leading-[1.7] text-foreground m-0 tracking-[-0.005em] text-pretty">{guide.summary}</p>
          ) : (
            <div className="text-muted-foreground text-[0.95rem] py-2">No summary available for this guide yet.</div>
          )}
        </div>
      )}

      {panel === 'notes' && (
        <div className="py-3.5 px-1.5 pb-6">
          <textarea
            placeholder="Write your notes here…"
            value={notes}
            onChange={e => updateNotes(e.target.value)}
            aria-label="Notes for this guide"
            className="w-full min-h-[320px] resize-y bg-card text-foreground border border-border rounded-xl py-3.5 px-4 font-['Manrope',system-ui,sans-serif] text-base leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus:border-[var(--accent)] focus:bg-muted"
          />
        </div>
      )}

      {panel === 'transcript' && (
        <div
          ref={transcriptScrollRef}
          className="h-[70vh] overflow-y-auto pt-2 px-1.5 pb-[60vh] font-['Literata',Charter,Georgia,serif] scrollbar-thin"
        >
          {!guide ? (
            <div className="text-muted-foreground text-[0.95rem] py-3.5 px-1.5">Loading transcript…</div>
          ) : !transcriptParas ? (
            <div className="text-muted-foreground text-[0.95rem] py-3.5 px-1.5">Transcript unavailable.</div>
          ) : (
            <TranscriptView
              paras={transcriptParas}
              activeWord={activeWord}
              onWordClick={onWordClick}
              activeRef={activeWordRef}
              onTextSelected={onTextSelected}
              highlightedNoteRange={highlightedNoteRange}
            />
          )}
        </div>
      )}
    </>
  );
}
