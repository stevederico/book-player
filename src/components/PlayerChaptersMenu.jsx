import React, { forwardRef, memo, useCallback } from 'react';
import { fmt } from '../utils/playerUtils';
import { useIsMobile } from '../hooks/useIsMobile.js';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@stevederico/skateboard-ui/shadcn/ui/sheet';

const CHAPTER_ROW_CLS =
  "group/chapter flex items-baseline gap-3.5 w-full bg-transparent border-none text-inherit text-left py-2.5 px-[18px] text-[0.92rem] font-medium cursor-pointer transition-colors hover:bg-foreground/5 data-[active]:bg-foreground/5";

const CHAPTER_ROW_CLS_MOBILE = `${CHAPTER_ROW_CLS} min-h-[44px]`;

const CHAPTER_TIME_CLS =
  "text-muted-foreground text-[0.8rem] tabular-nums shrink-0 min-w-[48px] group-data-[active]/chapter:text-[var(--accent-hot)]";

const CHAPTER_TITLE_CLS = "flex-1 min-w-0 whitespace-normal leading-[1.35]";

const ChapterRow = memo(function ChapterRow({
  chapter,
  index,
  isActive,
  isMobile,
  activeRef,
  onSelect,
}) {
  const handleClick = () => onSelect(chapter, index);
  return (
    <button
      role="menuitemradio"
      aria-checked={isActive}
      ref={isActive ? activeRef : null}
      data-active={isActive || undefined}
      onClick={handleClick}
      className={isMobile ? CHAPTER_ROW_CLS_MOBILE : CHAPTER_ROW_CLS}
    >
      <span className={CHAPTER_TIME_CLS}>{fmt(chapter.time)}</span>
      <span className={CHAPTER_TITLE_CLS}>{chapter.title}</span>
    </button>
  );
});

const PlayerChaptersMenu = memo(forwardRef(function PlayerChaptersMenu({
  chapters,
  activeIdx,
  chaptersMenuOpen,
  setChaptersMenuOpen,
  jumpToChapter,
  activeChapterItemRef,
}, ref) {
  const isMobile = useIsMobile();

  // Stable per-row click handler so memoized rows don't re-render
  // when only their own active state flips.
  const handleSelect = useCallback((chapter, index) => {
    jumpToChapter(chapter, index);
    setChaptersMenuOpen(false);
  }, [jumpToChapter, setChaptersMenuOpen]);

  if (!chapters?.length) return null;

  const rows = chapters.map((c, i) => (
    <ChapterRow
      key={i}
      chapter={c}
      index={i}
      isActive={i === activeIdx}
      isMobile={isMobile}
      activeRef={activeChapterItemRef}
      onSelect={handleSelect}
    />
  ));

  const trigger = (
    <button
      type="button"
      title="Jump to chapter"
      aria-haspopup="menu"
      aria-expanded={chaptersMenuOpen}
      onClick={() => setChaptersMenuOpen(o => !o)}
      className="inline-flex items-center gap-1.5 max-w-full bg-transparent border-none text-white font-['Manrope',system-ui,sans-serif] text-[0.9rem] font-semibold py-1.5 px-2.5 mx-1 rounded-md cursor-pointer [text-shadow:0_1px_4px_rgba(0,0,0,0.6)] transition-colors hover:bg-white/10"
    >
      <span className="overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
        {chapters[activeIdx]?.title || ''}
      </span>
    </button>
  );

  if (isMobile) {
    return (
      <div ref={ref} className="relative flex-1 min-w-0 flex items-center justify-start">
        {trigger}
        <Sheet open={chaptersMenuOpen} onOpenChange={setChaptersMenuOpen}>
          <SheetContent
            side="bottom"
            showCloseButton={false}
            className="max-h-[80dvh] bg-card border-border p-0 gap-0 rounded-t-2xl overflow-hidden flex flex-col"
          >
            <SheetHeader className="p-0 border-b border-[var(--glass-border)]">
              <SheetTitle className="py-3 px-[18px] text-[0.78rem] font-bold uppercase tracking-[0.08em] text-foreground/70">
                Chapters
              </SheetTitle>
            </SheetHeader>
            <div className="overflow-y-auto py-1.5 scrollbar-thin">
              {rows}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex-1 min-w-0 flex items-center justify-start">
      {trigger}
      {chaptersMenuOpen && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+10px)] left-0 w-[min(420px,calc(100vw-24px))] max-h-[min(60vh,480px)] bg-[var(--glass-bg)] backdrop-blur-[22px] backdrop-saturate-[1.6] border border-[var(--glass-border)] rounded-2xl z-20 shadow-[0_16px_48px_rgba(0,0,0,0.55)] text-foreground font-['Manrope',system-ui,sans-serif] flex flex-col overflow-hidden"
        >
          <div className="py-3 px-[18px] text-[0.78rem] font-bold uppercase tracking-[0.08em] text-foreground/70 border-b border-[var(--glass-border)] shrink-0">
            Chapters
          </div>
          <div className="overflow-y-auto py-1.5 scrollbar-thin">
            {rows}
          </div>
        </div>
      )}
    </div>
  );
}));

export default PlayerChaptersMenu;
