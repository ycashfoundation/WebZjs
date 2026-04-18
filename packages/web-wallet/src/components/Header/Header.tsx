import React from 'react';
import { Link } from 'react-router-dom';
import { LogoYellowPNG } from '../../assets';

/**
 * Top-of-page brand bar. The wordmark pairs a weight-600 "Ycash" with a
 * monospaced "// wallet" comment tag, borrowing the dev-tool cue from the
 * Inzyght explorer. The right-side live pill confirms mainnet at a glance.
 */
const Header = (): React.JSX.Element => {
  return (
    <header className="h-[60px] w-full flex items-center justify-between px-6 md:px-10 bg-bg/80 backdrop-blur-md border-b border-border">
      <Link
        to={'/'}
        className="group flex items-center gap-3 transition-opacity hover:opacity-90"
      >
        <img
          src={LogoYellowPNG}
          className="w-7 h-7 drop-shadow-[0_0_8px_rgba(244,183,40,0.25)]"
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

      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-ping"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
          mainnet
        </span>
      </div>
    </header>
  );
};

export default Header;
