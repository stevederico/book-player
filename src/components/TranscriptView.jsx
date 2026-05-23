import { useEffect, useRef } from 'react';

/**
 * Reusable transcript renderer with word-level highlighting, click-to-seek, and drag-to-select support.
 * Used in both the main transcript panel and the split-view hero pane.
 *
 * @param {Array} paras - Array of {words: [{text, index}, ...]} paragraphs from parseTranscript/useTranscript
 * @param {number} activeWord - Current playing word index for .active / .past classes
 * @param {Function} [onWordClick] - (wordIdx) => void  Seek to that word's time
 * @param {object} [activeRef] - React ref to attach to the currently active word span for auto-scroll
 * @param {string} [className] - Extra classes (applied to wrapper)
 * @param {Function} [onTextSelected] - (selectedText: string, startWordIdx: number) => void
 *        Called after a meaningful drag selection (multi-word or long enough). Parent shows the "create note" popup
 *        and resolves timestamp via timeAtWordIndex(anchors, startWordIdx).
 */
export default function TranscriptView({
  paras,
  activeWord,
  onWordClick,
  activeRef,
  className = '',
  onTextSelected,
}) {
  const containerRef = useRef(null);

  // Detect drag selections inside *this* transcript instance only.
  // Uses document mouseup + Selection API + containsNode to support both hero and bottom panels.
  // Ignores tiny single-word selections so normal word clicks (seek) still work reliably.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !onTextSelected) return;

    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
      const txt = sel.toString().trim();
      if (txt.length < 4) return;

      const range = sel.getRangeAt(0);
      if (!el.contains(range.commonAncestorContainer)) return;

      // Collect word indices that overlap the current selection (works for partial spans too)
      const indices = [];
      const spans = el.querySelectorAll('span.tw[data-idx]');
      for (const span of spans) {
        if (sel.containsNode(span, true)) {
          const i = parseInt(span.dataset.idx || span.getAttribute('data-idx'), 10);
          if (!isNaN(i)) indices.push(i);
        }
      }
      if (!indices.length) return;

      const startIdx = Math.min(...indices);
      const endIdx = Math.max(...indices);

      // Require either multiple words or a decent-length phrase (prevents popup on ordinary clicks)
      if (endIdx - startIdx < 1 && txt.length < 15) return;

      onTextSelected(txt, startIdx);
    };

    document.addEventListener('mouseup', handler);
    return () => document.removeEventListener('mouseup', handler);
  }, [onTextSelected]);

  if (!paras?.length) return null;

  return (
    <div ref={containerRef} className={`transcript-content ${className}`.trim()}>
      {paras.map((p, pi) => (
        <p key={pi} className="transcript-para">
          {p.words.map((w, wi) => {
            const isActive = w.index === activeWord;
            const isPast = w.index < activeWord;
            return (
              <span
                key={wi}
                ref={isActive ? activeRef : null}
                className={`tw${isActive ? ' active' : ''}${isPast ? ' past' : ''}`}
                data-idx={w.index}
                onClick={() => onWordClick?.(w.index)}
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
