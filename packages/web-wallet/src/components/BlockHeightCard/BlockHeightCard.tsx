import { FC, useState } from 'react';
import { WebZjsState } from 'src/context/WebzjsContext';
import { YCASH_FORK_HEIGHT } from '../../config/constants';
import Button from '../Button/Button';

export const BlockHeightCard: FC<{
  state: WebZjsState;
  syncedFrom?: string;
  onFullResync?: (customBirthday?: number) => Promise<void>;
}> = ({ state, syncedFrom, onFullResync }) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [customBirthday, setCustomBirthday] = useState('');

  const handleResync = () => {
    setShowConfirm(false);
    const birthday = customBirthday ? parseInt(customBirthday, 10) : undefined;
    if (birthday && birthday < YCASH_FORK_HEIGHT) {
      alert(
        `Birthday must be at least ${YCASH_FORK_HEIGHT} (Ycash fork height)`,
      );
      return;
    }
    onFullResync?.(birthday);
    setCustomBirthday('');
  };

  const chainHeight = state.chainHeight ? String(state.chainHeight) : '—';
  const syncedHeight = state.summary?.fully_scanned_height
    ? String(state.summary.fully_scanned_height)
    : '—';

  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-border last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
        {label}
      </span>
      <span className="mono text-base text-text">{value}</span>
    </div>
  );

  return (
    <div className="card-surface p-6">
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
          Sync status
        </span>
        {state.syncInProgress ? (
          <span className="pill pill-info inline-flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-info opacity-70 animate-ping"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-info"></span>
            </span>
            syncing
          </span>
        ) : (
          <span className="pill pill-accent">synced</span>
        )}
      </div>

      <div className="flex flex-col">
        <Row label="Chain height" value={chainHeight} />
        <Row label="Scanned to" value={syncedHeight} />
        {syncedFrom && <Row label="Synced from" value={syncedFrom} />}
      </div>

      {onFullResync && !state.syncInProgress && (
        <div className="mt-5 pt-4 border-t border-border">
          {!showConfirm ? (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="font-mono text-[11px] uppercase tracking-[0.15em] text-text-dim hover:text-ycash transition-colors"
            >
              Full resync →
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text-muted leading-relaxed">
                Clear the local chain cache and rescan from a birthday block.
                Leave the field blank to use the stored birthday.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
                  Birthday block · min {YCASH_FORK_HEIGHT}
                </label>
                <input
                  type="number"
                  value={customBirthday}
                  onChange={(e) => setCustomBirthday(e.target.value)}
                  placeholder="e.g. 2674500"
                  min={YCASH_FORK_HEIGHT}
                  className="bg-surface border border-border rounded-md px-3 py-2 text-text placeholder:text-text-dim font-mono text-sm focus:border-accent focus:outline-none"
                />
              </div>
              <div className="flex gap-2">
                <Button label="Confirm resync" onClick={handleResync} />
                <Button
                  label="Cancel"
                  variant="ghost"
                  onClick={() => {
                    setShowConfirm(false);
                    setCustomBirthday('');
                  }}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
