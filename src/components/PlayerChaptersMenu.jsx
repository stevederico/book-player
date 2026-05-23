import React, { forwardRef } from 'react';
import { fmt } from '../lib/playerUtils';
import { useIsMobile } from '../hooks/useIsMobile.js';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@stevederico/skateboard-ui/shadcn/ui/sheet';

const CHAPTER_ROW_CLS =
  "group/chapter flex items-baseline gap-3.5 w-full bg-transparent border-none text-inherit text-left py-2.5 px-[18px] text-[0.92rem] font-medium cursor-pointer transition-colors hover:bg-foreground/5 data-[active]:bg-foreground/5";

const CHAPTER_TIME_CLS =
  "text-muted-foreground text-[0.8rem] tabular-nums shrink-0 min-w-[48px] group-data-[active]/chapter:text-[var(--accent-hot)]";

const CHAPTER_TITLE_CLS = "flex-1 min-w-0 whitespace-normal leading-[1.35]";

const PlayerChaptersMenu = forwardRef(function PlayerChaptersMenu({
  chapters,
  activeIdx,
  chaptersMenuOpen,
  setChaptersMenuOpen,
  jumpToChapter,
  activeChapterItemRef,
}, ref) {
  const isMobile = useIsMobile();
  if (!chapters?.length) return null;

  const renderRow = (c, i) => {
    const isActive = i === activeIdx;
    const rowCls = isMobile
      ? `${CHAPTER_ROW_CLS} min-h-[44px]`
      : CHAPTER_ROW_CLS;
    return (
      <button
        key={i}
        role="menuitemradio"
        aria-checked={isActive}
        ref={isActive ? activeChapterItemRef : null}
        data-active={isActive || undefined}
        onClick={() => {
          jumpToChapter(c, i);
          setChaptersMenuOpen(false);
        }}
        className={rowCls}
      >
        <span className={CHAPTER_TIME_CLS}>{fmt(c.time)}</span>
        <span className={CHAPTER_TITLE_CLS}>{c.title}</span>
      </button>
    );
  };

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
              {chapters.map(renderRow)}
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
            {chapters.map(renderRow)}
          </div>
        </div>
      )}
    </div>
  );
});

export default PlayerChaptersMenu;
