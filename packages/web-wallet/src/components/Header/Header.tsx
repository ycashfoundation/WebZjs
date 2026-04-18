import React from 'react';
import { Link } from 'react-router-dom';
import { LogoYellowPNG } from '../../assets';
import { useTheme } from '../../context/ThemeContext';

/**
 * Top-of-page brand bar. The wordmark pairs a weight-600 "Ycash" with a
 * monospaced "// wallet" comment tag, borrowing the dev-tool cue from the
 * Inzyght explorer. Right side stacks the theme toggle next to a pulsing
 * `MAINNET` indicator.
 */
const Header = (): React.JSX.Element => {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';

  return (
    <header className="h-[60px] w-full flex items-center justify-between px-6 md:px-10 bg-bg/80 backdrop-blur-md border-b border-border">
      <Link
        to={'/'}
        className="group flex items-center gap-3 transition-opacity hover:opacity-90"
      >
        <img
          src={LogoYellowPNG}
          className="w-8 h-8 drop-shadow-[0_0_10px_rgba(245,103,51,0.3)]"
          alt="Ycash"
        />
        <span className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-tight text-text">
            Ycash
          </span>
          <span className="font-mono text-xs text-text-muted hidden sm:inline">
            // wallet
          </span>
        </span>
      </Link>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggle}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-card transition-colors"
        >
          {isDark ? (
            /* Sun icon — shown when in dark mode (indicates the mode you'd switch to). */
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            /* Moon icon — shown when in light mode. */
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-ping"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
            mainnet
          </span>
        </div>
      </div>
    </header>
  );
};

export default Header;
