/**
 * Address book storage. Labels for public payment addresses — not secrets,
 * but scoped to the wallet install so labels don't leak between users of the
 * same browser profile via the wallet UI.
 *
 * Shape: a single array persisted under `yw:addressbook:v1` in IndexedDB
 * (via idb-keyval, already a transitive dep through seedVault.ts). The
 * versioned key leaves room to migrate to a per-account layout later.
 */

import { get, set, del } from 'idb-keyval';
import { classifyAddress, normalizeAddress } from './address';

const BOOK_KEY = 'yw:addressbook:v1';

export type AddressKind = 'shielded' | 'transparent';

export interface AddressBookEntry {
  id: string;
  label: string;
  address: string;
  kind: AddressKind;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export const LABEL_MAX_LEN = 40;
export const NOTES_MAX_LEN = 200;

export interface AddressBookDraft {
  label: string;
  address: string;
  notes?: string;
}

export type AddressBookValidationError =
  | { field: 'label'; reason: string }
  | { field: 'address'; reason: string }
  | { field: 'notes'; reason: string };

/**
 * Validate a draft entry against the current list. Returns the first error
 * encountered, or `null` on success. `existing` is passed so uniqueness can
 * be checked relative to the live book; `ignoreId` lets edit-in-place skip
 * the entry currently being edited.
 */
export function validateDraft(
  draft: AddressBookDraft,
  existing: readonly AddressBookEntry[],
  ignoreId?: string,
): AddressBookValidationError | null {
  const label = draft.label.trim();
  if (!label) return { field: 'label', reason: 'Label is required' };
  if (label.length > LABEL_MAX_LEN) {
    return { field: 'label', reason: `Label must be ${LABEL_MAX_LEN} characters or fewer` };
  }
  const labelLower = label.toLowerCase();
  const labelCollides = existing.some(
    (e) => e.id !== ignoreId && e.label.toLowerCase() === labelLower,
  );
  if (labelCollides) {
    return { field: 'label', reason: 'Another entry already uses that label' };
  }

  const classification = classifyAddress(draft.address);
  if (classification.kind === 'invalid') {
    return { field: 'address', reason: classification.reason };
  }

  const normalized = normalizeAddress(draft.address);
  const addrCollides = existing.some(
    (e) => e.id !== ignoreId && normalizeAddress(e.address) === normalized,
  );
  if (addrCollides) {
    return { field: 'address', reason: 'You already have a label for that address' };
  }

  if (draft.notes && draft.notes.length > NOTES_MAX_LEN) {
    return { field: 'notes', reason: `Notes must be ${NOTES_MAX_LEN} characters or fewer` };
  }

  return null;
}

/**
 * Build the entry that would be persisted from a (validated) draft. Kept
 * separate from `validateDraft` so the UI can decide when to commit vs. just
 * render errors as the user types.
 */
export function entryFromDraft(
  draft: AddressBookDraft,
  now: number = Date.now(),
): AddressBookEntry {
  const classification = classifyAddress(draft.address);
  if (classification.kind === 'invalid') {
    throw new Error(`entryFromDraft called with invalid address: ${classification.reason}`);
  }
  const notes = draft.notes?.trim();
  return {
    id: crypto.randomUUID(),
    label: draft.label.trim(),
    address: draft.address.trim(),
    kind: classification.kind,
    notes: notes || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadAddressBook(): Promise<AddressBookEntry[]> {
  const raw = (await get(BOOK_KEY)) as AddressBookEntry[] | undefined;
  if (!raw || !Array.isArray(raw)) return [];
  // Defensive filter: discard anything missing required fields in case a
  // future version writes a different shape to the same key.
  return raw.filter(
    (e): e is AddressBookEntry =>
      typeof e?.id === 'string' &&
      typeof e?.label === 'string' &&
      typeof e?.address === 'string' &&
      (e?.kind === 'shielded' || e?.kind === 'transparent'),
  );
}

export async function saveAddressBook(entries: AddressBookEntry[]): Promise<void> {
  await set(BOOK_KEY, entries);
}

export async function clearAddressBook(): Promise<void> {
  await del(BOOK_KEY);
}

/**
 * Build a normalized-address → entry map for O(1) lookup by payment
 * destination. Caller is expected to rebuild on every mutation — the dataset
 * is small and rebuilding is cheaper than reasoning about staleness.
 */
export function buildLookup(
  entries: readonly AddressBookEntry[],
): Map<string, AddressBookEntry> {
  const map = new Map<string, AddressBookEntry>();
  for (const e of entries) {
    map.set(normalizeAddress(e.address), e);
  }
  return map;
}

/**
 * Display cap for labels rendered inline in transaction history (where a
 * truncated `ys1…` address used to live). Keeps the visual weight similar
 * to the 24-ish characters the truncation produced.
 */
export const LABEL_INLINE_DISPLAY_MAX = 24;

export function truncateLabel(label: string, max = LABEL_INLINE_DISPLAY_MAX): string {
  if (label.length <= max) return label;
  return label.slice(0, max - 1) + '…';
}
