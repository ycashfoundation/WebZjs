import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogoYellowPNG } from '../assets';
import { useSession } from '../context/SessionContext';
import Loader from '../components/Loader/Loader';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { status } = useSession();

  // Once the session probe resolves, route users into the right flow. We keep
  // the Home page itself as a "no-vault" landing — first-run visitors see the
  // Create/Import choice here rather than being immediately redirected.
  useEffect(() => {
    if (status === 'locked') navigate('/unlock', { replace: true });
    if (status === 'unlocked')
      navigate('/dashboard/account-summary', { replace: true });
  }, [status, navigate]);

  if (status === 'unknown' || status === 'locked' || status === 'unlocked') {
    return (
      <div className="flex items-center justify-center py-32 w-full">
        <Loader />
      </div>
    );
  }

  return (
    <div className="w-full px-6 md:px-12 py-10 md:py-16">
      <div className="max-w-6xl mx-auto grid grid-cols-12 gap-8 md:gap-12 items-start">
        {/* Content column */}
        <div className="col-span-12 md:col-span-8 flex flex-col gap-8">
          <div className="flex items-center gap-3 text-text-dim">
            <img src={LogoYellowPNG} className="w-5 h-5 opacity-80" alt="" />
            <span className="font-mono text-[11px] uppercase tracking-[0.25em]">
              wallet.ycash
            </span>
          </div>

          <h1 className="font-sans font-semibold text-[4.5rem] md:text-[6.5rem] leading-[0.92] tracking-[-0.035em] text-text">
            Ycash,
            <br />
            <span className="text-ycash">in your browser.</span>
          </h1>

          <p className="text-text-muted text-[17px] leading-[1.6] max-w-[46ch]">
            Sapling-native. Local signing. No custodian. Keep your seed
            encrypted on this device, or hand signing off to the Ycash
            MetaMask Snap.
          </p>

          <div className="flex flex-col sm:flex-row flex-wrap gap-3 mt-2">
            <button
              onClick={() => navigate('/create')}
              className="group bg-ycash hover:bg-ycash-hover text-bg font-semibold px-7 py-3 rounded-md transition-colors inline-flex items-center justify-center gap-2"
            >
              Create wallet
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                className="transition-transform group-hover:translate-x-0.5"
              >
                <path
                  d="M5 12h14m-7-7 7 7-7 7"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              onClick={() => navigate('/import')}
              className="bg-transparent hover:bg-card text-text border border-border-strong hover:border-text-muted font-medium px-7 py-3 rounded-md transition-colors"
            >
              Import seed phrase
            </button>
            <button
              onClick={() => navigate('/connect-snap')}
              className="text-text-muted hover:text-ycash text-sm px-3 py-3 transition-colors inline-flex items-center gap-1.5"
            >
              Or use the MetaMask Snap
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>

        {/* Spec card — Inzyght-style stat panel */}
        <aside className="hidden md:flex col-span-4 card-surface p-6 flex-col gap-5 mt-14">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
              network
            </span>
            <span className="pill pill-accent">mainnet</span>
          </div>

          <div className="border-t border-border pt-5 flex flex-col gap-5">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim mb-1.5">
                Fork height
              </div>
              <div className="stat-number text-[1.75rem] text-accent leading-none">
                570,000
              </div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim mb-1.5">
                Shielded pool
              </div>
              <div className="text-text font-medium">Sapling</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim mb-1.5">
                Signing
              </div>
              <div className="text-text font-medium">Local / Snap</div>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim mb-1.5">
                Seed storage
              </div>
              <div className="text-text font-medium">
                This browser, encrypted
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default Home;
