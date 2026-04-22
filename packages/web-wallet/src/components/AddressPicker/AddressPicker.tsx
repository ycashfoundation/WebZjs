import React, { useEffect, useMemo, useRef, useState } from 'react';
import cn from 'classnames';
import { useAddressBook } from '../../context/AddressBookContext';
import { AddressBookEntry } from '../../utils/addressBook';

interface AddressPickerProps {
  onSelect: (entry: AddressBookEntry) => void;
  /**
   * Rendered as a compact link-button that matches the `labelActions` slot
   * convention used elsewhere (the "Max" affordance on the Amount input).
   */
  buttonLabel?: string;
}

/**
 * Dropdown list of saved address-book entries that fills the recipient
 * field on select. Not an autocomplete: the user either types an address
 * free-form *or* picks from the book — mixing them into the same field
 * surfaces no helpful signal and adds keyboard/ARIA work for no gain.
 *
 * Hides itself when the book is empty so users don't get a dead button
 * on a first-run install.
 */
export function AddressPicker({
  onSelect,
  buttonLabel = 'From address book',
}: AddressPickerProps): React.JSX.Element | null {
  const { entries } = useAddressBook();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.label.localeCompare(b.label)),
    [entries],
  );

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (entries.length === 0) return null;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="font-mono text-[10px] uppercase tracking-[0.2em] text-ycash hover:text-ycash-hover transition-colors"
      >
        {buttonLabel}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 min-w-[280px] max-w-[340px] card-surface shadow-lg z-20 py-1 max-h-[320px] overflow-y-auto">
          <ul role="listbox" className="flex flex-col">
            {sorted.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(entry);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 hover:bg-surface focus:outline-none focus:bg-surface',
                    'flex flex-col gap-0.5',
                  )}
                >
                  <span className="text-sm text-text truncate">
                    {entry.label}
                  </span>
                  <span className="font-mono text-[11px] text-text-dim truncate">
                    {entry.address}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
