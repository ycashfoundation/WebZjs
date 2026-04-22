import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AddressBookDraft,
  AddressBookEntry,
  AddressBookValidationError,
  buildLookup,
  clearAddressBook,
  entryFromDraft,
  loadAddressBook,
  saveAddressBook,
  validateDraft,
} from '../utils/addressBook';
import { normalizeAddress } from '../utils/address';

/**
 * Exposes the wallet-install-scoped address book to the React tree. Loaded
 * once from IndexedDB on mount and kept in memory; mutations write-through
 * to the same key so a page reload surfaces the latest state.
 *
 * Scope decision: a single book per install, not per account. Within a
 * single-seed wallet multiple accounts are bookkeeping, not separate
 * identities — and per-account scoping wouldn't solve the shared-browser
 * threat model anyway (the seed itself is already shared).
 */

interface AddressBookContextShape {
  entries: AddressBookEntry[];
  /** True while the initial load from IndexedDB is in flight. */
  loading: boolean;
  lookup: (address: string) => AddressBookEntry | undefined;
  validate: (
    draft: AddressBookDraft,
    ignoreId?: string,
  ) => AddressBookValidationError | null;
  addEntry: (draft: AddressBookDraft) => Promise<AddressBookEntry>;
  updateEntry: (id: string, draft: AddressBookDraft) => Promise<AddressBookEntry>;
  removeEntry: (id: string) => Promise<void>;
  /** Called from the factory-reset flow to drop all labels. */
  clearAll: () => Promise<void>;
}

const AddressBookContext = createContext<AddressBookContextShape | undefined>(
  undefined,
);

export function AddressBookProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [entries, setEntries] = useState<AddressBookEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadAddressBook()
      .then((loaded) => {
        if (cancelled) return;
        // Stable sort: most recently updated first, since the addresses
        // page is primarily used to re-find recently-added entries.
        loaded.sort((a, b) => b.updatedAt - a.updatedAt);
        setEntries(loaded);
      })
      .catch((err) => {
        console.warn('Address book load failed (starting empty):', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Factory reset happens in SessionContext, which lives above this provider
  // in the tree and can't reach into our state directly. Listen for its
  // signal and drop our in-memory entries so labels don't survive the wipe.
  useEffect(() => {
    const onCleared = () => setEntries([]);
    window.addEventListener('yw:addressbook-cleared', onCleared);
    return () => window.removeEventListener('yw:addressbook-cleared', onCleared);
  }, []);

  const lookupMap = useMemo(() => buildLookup(entries), [entries]);

  const lookup = useCallback(
    (address: string) => lookupMap.get(normalizeAddress(address)),
    [lookupMap],
  );

  const validate = useCallback(
    (draft: AddressBookDraft, ignoreId?: string) =>
      validateDraft(draft, entries, ignoreId),
    [entries],
  );

  const addEntry = useCallback(
    async (draft: AddressBookDraft) => {
      const err = validateDraft(draft, entries);
      if (err) throw new Error(err.reason);
      const entry = entryFromDraft(draft);
      const next = [entry, ...entries];
      await saveAddressBook(next);
      setEntries(next);
      return entry;
    },
    [entries],
  );

  const updateEntry = useCallback(
    async (id: string, draft: AddressBookDraft) => {
      const err = validateDraft(draft, entries, id);
      if (err) throw new Error(err.reason);
      const existing = entries.find((e) => e.id === id);
      if (!existing) throw new Error('Entry not found');
      const now = Date.now();
      const kind = entryFromDraft(draft, now).kind;
      const updated: AddressBookEntry = {
        ...existing,
        label: draft.label.trim(),
        address: draft.address.trim(),
        notes: draft.notes?.trim() || undefined,
        kind,
        updatedAt: now,
      };
      const next = entries.map((e) => (e.id === id ? updated : e));
      next.sort((a, b) => b.updatedAt - a.updatedAt);
      await saveAddressBook(next);
      setEntries(next);
      return updated;
    },
    [entries],
  );

  const removeEntry = useCallback(
    async (id: string) => {
      const next = entries.filter((e) => e.id !== id);
      await saveAddressBook(next);
      setEntries(next);
    },
    [entries],
  );

  const clearAll = useCallback(async () => {
    await clearAddressBook();
    setEntries([]);
  }, []);

  const value = useMemo<AddressBookContextShape>(
    () => ({
      entries,
      loading,
      lookup,
      validate,
      addEntry,
      updateEntry,
      removeEntry,
      clearAll,
    }),
    [
      entries,
      loading,
      lookup,
      validate,
      addEntry,
      updateEntry,
      removeEntry,
      clearAll,
    ],
  );

  return (
    <AddressBookContext.Provider value={value}>
      {children}
    </AddressBookContext.Provider>
  );
}

export function useAddressBook(): AddressBookContextShape {
  const ctx = useContext(AddressBookContext);
  if (!ctx) {
    throw new Error('useAddressBook must be used within AddressBookProvider');
  }
  return ctx;
}
