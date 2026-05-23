// Reusable transcript renderer with word-level highlighting and click-to-seek.
// Used in both the main transcript panel and the split-view hero.

export default function TranscriptView({
  paras,
  activeWord,
  onWordClick,
  activeRef,
  className = '',
}) {
  if (!paras?.length) return null;

  return paras.map((p, pi) => (
    <p key={pi} className={`transcript-para ${className}`}>
      {p.words.map((w, wi) => {
        const isActive = w.index === activeWord;
        const isPast = w.index < activeWord;
        return (
          <span
            key={wi}
            ref={isActive ? activeRef : null}
            className={`tw${isActive ? ' active' : ''}${isPast ? ' past' : ''}`}
            onClick={() => onWordClick?.(w.index)}
          >
            {w.text}{wi < p.words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </p>
  ));
}
