import { useEffect, useRef } from 'react';
import type { Ref } from 'react';
import type { TranscriptParagraph } from '../utils/playerUtils';

/** A word range to re-highlight (used when previewing a saved note). */
export interface NoteHighlightRange {
  /** First highlighted word index. */
  start: number;
  /** Last highlighted word index. */
  end: number;
}

/** Props for {@link TranscriptView}. */
export interface TranscriptViewProps {
  /** Parsed paragraphs from parseTranscript/useTranscript. */
  paras: TranscriptParagraph[] | null;
  /** Current playing word index for .active / .past styling. */
  activeWord: number;
  /** Seek to that word's time. */
  onWordClick?: (wordIdx: number) => void;
  /** Ref attached to the currently active word span for auto-scroll. */
  activeRef?: Ref<HTMLSpanElement>;
  /** Extra classes applied to the wrapper. */
  className?: string;
  /**
   * Called after a meaningful drag selection. Parent shows the "create note"
   * popup and can store the range to re-highlight the exact text later.
   */
  onTextSelected?: (selectedText: string, startWordIdx: number, endWordIdx: number) => void;
  /** Word range to re-highlight as a saved note. */
  highlightedNoteRange?: NoteHighlightRange | null;
}

/**
 * Reusable transcript renderer with word-level highlighting, click-to-seek, and drag-to-select support.
 * Used in both the main transcript panel and the split-view hero pane.
 */
export default function TranscriptView({
  paras,
  activeWord,
  onWordClick,
  activeRef,
  className = '',
  onTextSelected,
  highlightedNoteRange,
}: TranscriptViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect drag selections inside *this* transcript instance only.
  // Listens for both `mouseup` (desktop) and `touchend` (iOS/iPadOS) since iOS Safari
  // often doesn't emit a synthetic mouseup after a touch text-selection. Uses the
  // Selection API + containsNode so it works for partial-span selections too.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onTextSelected) return;

    let pending: number | null = null;

    const handler = () => {
      // On touch devices the selection may need a tick to settle after the callout appears.
      // Clear any previously scheduled run and queue a fresh one.
      if (pending) cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        pending = null;
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
        const txt = sel.toString().trim();
        if (txt.length < 4) return;

        const range = sel.getRangeAt(0);
        if (!el.contains(range.commonAncestorContainer)) return;

        // Collect word indices that overlap the current selection
        const indices: number[] = [];
        const spans = el.querySelectorAll<HTMLSpanElement>('span.tw[data-idx]');
        for (const span of spans) {
          if (sel.containsNode(span, true)) {
            const i = parseInt(span.dataset.idx || span.getAttribute('data-idx') || '', 10);
            if (!isNaN(i)) indices.push(i);
          }
        }
        if (!indices.length) return;

        const startIdx = Math.min(...indices);
        const endIdx = Math.max(...indices);

        // Require multiple words or a decent-length phrase so normal word clicks still seek
        if (endIdx - startIdx < 1 && txt.length < 15) return;

        onTextSelected(txt, startIdx, endIdx);
      });
    };

    document.addEventListener('mouseup', handler, { passive: true });
    document.addEventListener('touchend', handler, { passive: true });
    return () => {
      document.removeEventListener('mouseup', handler);
      document.removeEventListener('touchend', handler);
      if (pending) cancelAnimationFrame(pending);
    };
  }, [onTextSelected]);

  if (!paras?.length) return null;

  return (
    <div ref={containerRef} className={className || undefined}>
      {paras.map((p, pi) => (
        <p
          key={pi}
          className="font-['Literata',Charter,Georgia,serif] text-[length:inherit] leading-[1.55] text-foreground mx-auto mb-[0.85em] max-w-[65ch] text-pretty first:mt-0 [content-visibility:auto] [contain-intrinsic-size:0_120px]"
        >
          {p.words.map((w, wi) => {
            const isActive = w.index === activeWord;
            const isPast = w.index < activeWord;
            const isNoteHighlighted =
              highlightedNoteRange &&
              w.index >= highlightedNoteRange.start &&
              w.index <= highlightedNoteRange.end;

            return (
              <span
                key={wi}
                ref={isActive ? activeRef : null}
                data-idx={w.index}
                data-active={isActive || undefined}
                data-past={isPast || undefined}
                data-note={isNoteHighlighted || undefined}
                onClick={() => onWordClick?.(w.index)}
                className="tw cursor-pointer rounded-[2px] transition-colors duration-[120ms] hover:bg-foreground/5 data-[active]:bg-[rgba(120,200,255,0.22)] data-[note]:bg-[rgba(250,204,21,0.55)] data-[note]:shadow-[0_0_0_1px_rgba(234,179,8,0.6)] data-[active]:data-[note]:shadow-[0_0_0_1px_rgba(120,200,255,0.9),inset_0_0_0_9999px_rgba(120,200,255,0.18)]"
              >
                {w.text}{wi < p.words.length - 1 ? ' ' : ''}
              </span>
            );
          })}
        </p>
      ))}
    </div>
  );
}
