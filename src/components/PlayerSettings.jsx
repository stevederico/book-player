import React from 'react';

const PANEL_DESKTOP_CLS =
  "absolute bottom-[calc(100%+10px)] right-0 min-w-[300px] bg-[var(--glass-bg)] backdrop-blur-[22px] backdrop-saturate-[1.6] border border-[var(--glass-border)] rounded-2xl py-1.5 px-0 z-20 shadow-[0_16px_48px_rgba(0,0,0,0.55)] text-foreground font-['Manrope',system-ui,sans-serif] overflow-hidden";

const PANEL_MOBILE_CLS =
  "py-2 px-0 text-foreground font-['Manrope',system-ui,sans-serif]";

const ROW_CLS =
  "grid grid-cols-[28px_1fr_auto_auto] items-center gap-x-3.5 w-full bg-transparent border-none text-inherit text-left py-3 px-[18px] text-[0.95rem] font-medium cursor-pointer transition-colors duration-150 hover:bg-foreground/5 min-h-[44px]";

const SUB_HEADER_CLS =
  "flex items-center gap-2.5 w-full bg-transparent border-none text-inherit text-left py-3.5 px-[18px] text-[0.95rem] font-semibold cursor-pointer border-b border-[var(--glass-border)] mb-1 transition-colors duration-150 hover:bg-foreground/5";

const OPTION_CLS =
  "flex items-center gap-3.5 w-full bg-transparent border-none text-inherit text-left py-2.5 px-[18px] text-[0.92rem] font-medium cursor-pointer transition-colors duration-150 hover:bg-foreground/5";

const TOGGLE_TRACK_CLS =
  "w-9 h-5 bg-[var(--toggle-bg)] data-[on]:bg-[var(--toggle-bg-on)] rounded-full relative transition-colors duration-200 shrink-0 inline-block";

const TOGGLE_KNOB_CLS =
  "absolute top-0.5 left-0.5 size-4 rounded-full bg-[var(--knob)] data-[on]:bg-[var(--knob-on)] data-[on]:translate-x-4 transition-[transform,background-color] duration-200";

function Toggle({ on }) {
  return (
    <span data-on={on || undefined} className={TOGGLE_TRACK_CLS} aria-hidden="true">
      <span data-on={on || undefined} className={TOGGLE_KNOB_CLS} />
    </span>
  );
}

/**
 * YouTube-style settings panel for the audio player.
 * Supports sub-pages for View mode and Playback speed; direct toggles for transcript and captions.
 * Now includes dark/light mode switch using the app's ThemeProvider.
 */
export default function PlayerSettings({
  mode,
  setMode,
  setMenuOpen,
  splitTranscript,
  toggleSplitTranscript,
  captionsOn,
  toggleCaptions,
  isDarkMode,
  toggleTheme,
  rate,
  changeRate,
  settingsPage,
  setSettingsPage,
  transcriptParas,
  isMobile = false,
}) {
  return (
    <div className={isMobile ? PANEL_MOBILE_CLS : PANEL_DESKTOP_CLS} role="menu">
      {settingsPage === 'main' && (
        <>
          <button className={ROW_CLS} role="menuitem" onClick={() => setSettingsPage('mode')}>
            <span className="inline-flex items-center justify-center text-foreground">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="9" cy="11" r="2" />
                <path d="m21 17-4-4-6 6" />
              </svg>
            </span>
            <span className="font-medium tracking-[0.01em]">View</span>
            <span className="text-foreground/70 text-[0.9rem]">
              {mode[0].toUpperCase() + mode.slice(1)}
            </span>
            <svg className="-ml-1 text-muted-foreground" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>

          {transcriptParas && !isMobile && (
            <button
              className={ROW_CLS}
              role="menuitemcheckbox"
              aria-checked={splitTranscript}
              onClick={toggleSplitTranscript}
            >
              <span className="inline-flex items-center justify-center text-foreground">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="14" rx="2" />
                  <path d="M14 5v14" />
                  <path d="M16.5 9.5h3" />
                  <path d="M16.5 12h3" />
                  <path d="M16.5 14.5h3" />
                </svg>
              </span>
              <span className="font-medium tracking-[0.01em]">Show transcript</span>
              <span />
              <Toggle on={splitTranscript} />
            </button>
          )}

          <button
            className={ROW_CLS}
            role="menuitemcheckbox"
            aria-checked={captionsOn}
            onClick={toggleCaptions}
          >
            <span className="inline-flex items-center justify-center text-foreground">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19 4H5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zM11 11.5H9.5v-.5h-2v2h2v-.5H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v2h2v-.5H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z" />
              </svg>
            </span>
            <span className="font-medium tracking-[0.01em]">Captions</span>
            <span />
            <Toggle on={captionsOn} />
          </button>

          <button
            className={ROW_CLS}
            role="menuitemcheckbox"
            aria-checked={isDarkMode}
            onClick={toggleTheme}
          >
            <span className="inline-flex items-center justify-center text-foreground">
              {isDarkMode ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="5" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              )}
            </span>
            <span className="font-medium tracking-[0.01em]">Dark mode</span>
            <span />
            <Toggle on={isDarkMode} />
          </button>

          <button className={ROW_CLS} role="menuitem" onClick={() => setSettingsPage('speed')}>
            <span className="inline-flex items-center justify-center text-foreground">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22a10 10 0 1 0-10-10" />
                <path d="m12 12 4-4" />
              </svg>
            </span>
            <span className="font-medium tracking-[0.01em]">Playback speed</span>
            <span className="text-foreground/70 text-[0.9rem]">
              {rate === 1 ? 'Normal' : rate + '×'}
            </span>
            <svg className="-ml-1 text-muted-foreground" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </>
      )}

      {settingsPage === 'mode' && (
        <>
          <button className={SUB_HEADER_CLS} onClick={() => setSettingsPage('main')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span>View</span>
          </button>
          {['generated', 'real'].map(m => (
            <button
              key={m}
              role="menuitemradio"
              aria-checked={mode === m}
              data-selected={mode === m || undefined}
              className={OPTION_CLS}
              onClick={() => { setMode(m); setMenuOpen(false); }}
            >
              <span className="w-[18px] inline-flex items-center justify-center text-foreground" aria-hidden="true">
                {mode === m && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </>
      )}

      {settingsPage === 'speed' && (
        <>
          <button className={SUB_HEADER_CLS} onClick={() => setSettingsPage('main')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span>Playback speed</span>
          </button>
          {[0.75, 1, 1.25, 1.5, 2].map(r => (
            <button
              key={r}
              role="menuitemradio"
              aria-checked={rate === r}
              data-selected={rate === r || undefined}
              className={OPTION_CLS}
              onClick={() => { changeRate(r); setMenuOpen(false); }}
            >
              <span className="w-[18px] inline-flex items-center justify-center text-foreground" aria-hidden="true">
                {rate === r && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              {r === 1 ? 'Normal' : r + '×'}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
