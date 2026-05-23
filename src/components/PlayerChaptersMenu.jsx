import React, { forwardRef } from 'react';
import { fmt } from '../lib/playerUtils';

const PlayerChaptersMenu = forwardRef(function PlayerChaptersMenu({
  chapters,
  activeIdx,
  chaptersMenuOpen,
  setChaptersMenuOpen,
  jumpToChapter,
  activeChapterItemRef,
}, ref) {
  if (!chapters?.length) return null;

  return (
    <div className="chapters-menu" ref={ref}>
      <button
        type="button"
        className="chapter-title-btn"
        title="Jump to chapter"
        aria-haspopup="menu"
        aria-expanded={chaptersMenuOpen}
        onClick={() => setChaptersMenuOpen(o => !o)}
      >
        <span className="chapter-title-text">{chapters[activeIdx]?.title || ''}</span>
      </button>

      {chaptersMenuOpen && (
        <div className="chapters-popup" role="menu">
          <div className="chapters-popup-header">Chapters</div>
          <div className="chapters-popup-list">
            {chapters.map((c, i) => (
              <button
                key={i}
                role="menuitemradio"
                aria-checked={i === activeIdx}
                ref={i === activeIdx ? activeChapterItemRef : null}
                className={`chapters-popup-item${i === activeIdx ? ' active' : ''}`}
                onClick={() => {
                  jumpToChapter(c, i);
                  setChaptersMenuOpen(false);
                }}
              >
                <span className="chapters-popup-time">{fmt(c.time)}</span>
                <span className="chapters-popup-title">{c.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export default PlayerChaptersMenu;
