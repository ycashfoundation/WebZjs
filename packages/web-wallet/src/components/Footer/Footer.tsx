import React from 'react';
import { ChainsafePNG } from '../../assets';

const Footer = (): React.JSX.Element => {
  return (
    <footer className="w-full py-8 mt-16 border-t border-border">
      <div className="flex items-center justify-center gap-4 md:gap-6 font-mono text-[10px] uppercase tracking-[0.18em] text-text-dim">
        <span className="text-text-muted">Ycash Foundation</span>
        <span className="text-border-strong">·</span>
        <a
          className="inline-flex items-center gap-2 hover:text-text-muted transition-colors"
          href="https://chainsafe.io/"
          target="_blank"
          rel="noreferrer"
        >
          <img
            src={ChainsafePNG}
            className="w-3.5 h-3.5 opacity-50"
            alt=""
          />
          Forked from WebZjs by ChainSafe
        </a>
      </div>
    </footer>
  );
};

export default Footer;
