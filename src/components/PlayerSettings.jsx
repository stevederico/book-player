import React from 'react';

/**
 * YouTube-style settings panel for the audio player.
 * Supports sub-pages for View mode and Playback speed; direct toggles for transcript and captions.
 * Now includes dark/light mode switch using the app's ThemeProvider.
 *
 * @param {Object} props
 * @param {string} props.mode - Current view mode ('real' | 'generated')
 * @param {Function} props.setMode
 * @param {Function} props.setMenuOpen
 * @param {boolean} [props.splitTranscript]
 * @param {Function} [props.toggleSplitTranscript]
 * @param {boolean} props.captionsOn
 * @param {Function} props.toggleCaptions
 * @param {boolean} props.isDarkMode - Resolved dark theme active
 * @param {Function} props.toggleTheme - Toggles between explicit light/dark
 * @param {number} props.rate
 * @param {Function} props.changeRate
 * @param {string} props.settingsPage - 'main' | 'mode' | 'speed'
 * @param {Function} props.setSettingsPage
 * @param {boolean} [props.transcriptParas]
 * @returns {JSX.Element}
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
}) {
  return (
    <div className="settings-panel" role="menu">
      {settingsPage === 'main' && (
        <>
          <button
            className="settings-row"
            role="menuitem"
            onClick={() => setSettingsPage('mode')}
          >
            <span className="settings-row-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="9" cy="11" r="2" />
                <path d="m21 17-4-4-6 6" />
              </svg>
            </span>
            <span className="settings-row-label">View</span>
            <span className="settings-row-value">
              {mode[0].toUpperCase() + mode.slice(1)}
            </span>
            <svg className="settings-row-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>

          {transcriptParas && (
            <button
              className="settings-row"
              role="menuitemcheckbox"
              aria-checked={splitTranscript}
              onClick={toggleSplitTranscript}
            >
            <span className="settings-row-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="M14 5v14" />
                <path d="M16.5 9.5h3" />
                <path d="M16.5 12h3" />
                <path d="M16.5 14.5h3" />
              </svg>
            </span>
            <span className="settings-row-label">Show transcript</span>
            <span className={`settings-toggle${splitTranscript ? ' on' : ''}`} aria-hidden="true">
              <span className="settings-toggle-knob" />
            </span>
          </button>
          )}

          <button
            className="settings-row"
            role="menuitemcheckbox"
            aria-checked={captionsOn}
            onClick={toggleCaptions}
          >
            <span className="settings-row-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19 4H5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zM11 11.5H9.5v-.5h-2v2h2v-.5H11v1a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zm7 0h-1.5v-.5h-2v2h2v-.5H18v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1z" />
              </svg>
            </span>
            <span className="settings-row-label">Captions</span>
            <span className={`settings-toggle${captionsOn ? ' on' : ''}`} aria-hidden="true">
              <span className="settings-toggle-knob" />
            </span>
          </button>

          <button
            className="settings-row"
            role="menuitemcheckbox"
            aria-checked={isDarkMode}
            onClick={toggleTheme}
          >
            <span className="settings-row-icon">
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
            <span className="settings-row-label">Dark mode</span>
            <span className={`settings-toggle${isDarkMode ? ' on' : ''}`} aria-hidden="true">
              <span className="settings-toggle-knob" />
            </span>
          </button>

          <button
            className="settings-row"
            role="menuitem"
            onClick={() => setSettingsPage('speed')}
          >
            <span className="settings-row-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 22a10 10 0 1 0-10-10" />
                <path d="m12 12 4-4" />
              </svg>
            </span>
            <span className="settings-row-label">Playback speed</span>
            <span className="settings-row-value">
              {rate === 1 ? 'Normal' : rate + '×'}
            </span>
            <svg className="settings-row-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </>
      )}

      {settingsPage === 'mode' && (
        <>
          <button className="settings-sub-header" onClick={() => setSettingsPage('main')}>
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
              className={`settings-option${mode === m ? ' selected' : ''}`}
              onClick={() => { setMode(m); setMenuOpen(false); }}
            >
              <span className="settings-option-check" aria-hidden="true">
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
          <button className="settings-sub-header" onClick={() => setSettingsPage('main')}>
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
              className={`settings-option${rate === r ? ' selected' : ''}`}
              onClick={() => { changeRate(r); setMenuOpen(false); }}
            >
              <span className="settings-option-check" aria-hidden="true">
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
