import React, { useEffect, useMemo, useState } from 'react';
import cn from 'classnames';
import { useSearchParams } from 'react-router-dom';
import Input from '../../components/Input/Input';
import Button from '../../components/Button/Button';
import ErrorMessage from '../../components/ErrorMessage/ErrorMessage';
import { useAddressBook } from '../../context/AddressBookContext';
import {
  AddressBookDraft,
  AddressBookEntry,
  LABEL_MAX_LEN,
  NOTES_MAX_LEN,
} from '../../utils/addressBook';
import { normalizeAddress } from '../../utils/address';

/**
 * Manage saved address labels. Wallet-install-scoped (not per account) — the
 * book is a thin layer over the set of public addresses the user interacts
 * with, and scoping by account adds UX friction without fixing any real
 * threat (see the design discussion in the session memory).
 */
function Addresses(): React.JSX.Element {
  const { entries, loading, addEntry, updateEntry, removeEntry, validate } =
    useAddressBook();
  const [editor, setEditor] = useState<
    | { mode: 'closed' }
    | { mode: 'add'; draft: AddressBookDraft }
    | { mode: 'edit'; id: string; draft: AddressBookDraft }
  >({ mode: 'closed' });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Track which fields the user has engaged with so validation messages
  // don't nag a user who's just opened the form.
  const [touched, setTouched] = useState<{
    label: boolean;
    address: boolean;
    notes: boolean;
  }>({ label: false, address: false, notes: false });
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link entry from the post-send "save this address?" toast. If the
  // address is already labeled, jump to the edit form for that entry
  // instead of opening a duplicate-blocked add form.
  useEffect(() => {
    const prefill = searchParams.get('prefill');
    if (!prefill) return;
    const normalized = normalizeAddress(prefill);
    const existing = entries.find(
      (e) => normalizeAddress(e.address) === normalized,
    );
    if (existing) {
      setEditor({
        mode: 'edit',
        id: existing.id,
        draft: {
          label: existing.label,
          address: existing.address,
          notes: existing.notes ?? '',
        },
      });
    } else {
      setEditor({
        mode: 'add',
        draft: { label: '', address: prefill, notes: '' },
      });
    }
    // Clear the query param so a page refresh doesn't re-open the editor.
    const next = new URLSearchParams(searchParams);
    next.delete('prefill');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, entries]);

  const editingId = editor.mode === 'edit' ? editor.id : undefined;
  const liveValidation =
    editor.mode === 'closed' ? null : validate(editor.draft, editingId);
  const canSubmit =
    editor.mode !== 'closed' &&
    liveValidation === null &&
    editor.draft.label.trim() !== '' &&
    editor.draft.address.trim() !== '';

  // Simple filter — most wallets have <50 labels so a linear scan on every
  // keystroke is fine. Matches label or address substring, case-insensitive.
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.address.toLowerCase().includes(q) ||
        (e.notes ?? '').toLowerCase().includes(q),
    );
  }, [query, entries]);

  function openAdd() {
    setSaveError(null);
    setConfirmDeleteId(null);
    setTouched({ label: false, address: false, notes: false });
    setEditor({
      mode: 'add',
      draft: { label: '', address: '', notes: '' },
    });
  }

  function openEdit(entry: AddressBookEntry) {
    setSaveError(null);
    setConfirmDeleteId(null);
    // Existing entries are already valid — treat all fields as "touched"
    // so any edits surface validation immediately.
    setTouched({ label: true, address: true, notes: true });
    setEditor({
      mode: 'edit',
      id: entry.id,
      draft: {
        label: entry.label,
        address: entry.address,
        notes: entry.notes ?? '',
      },
    });
  }

  function closeEditor() {
    setEditor({ mode: 'closed' });
    setSaveError(null);
  }

  function patchDraft(
    field: keyof AddressBookDraft,
    value: string,
  ) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setEditor((prev) =>
      prev.mode === 'closed'
        ? prev
        : { ...prev, draft: { ...prev.draft, [field]: value } },
    );
  }

  async function handleSubmit() {
    if (editor.mode === 'closed') return;
    // Reveal any remaining field errors on submit attempt.
    setTouched({ label: true, address: true, notes: true });
    try {
      if (editor.mode === 'add') {
        await addEntry(editor.draft);
      } else {
        await updateEntry(editor.id, editor.draft);
      }
      closeEditor();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(id: string) {
    await removeEntry(id);
    setConfirmDeleteId(null);
  }

  const fieldError = (field: 'label' | 'address' | 'notes') => {
    if (!liveValidation || liveValidation.field !== field) return undefined;
    if (!touched[field]) return undefined;
    return liveValidation.reason;
  };

  return (
    <div className="w-full pb-16 flex flex-col gap-6">
      <div className="card-surface p-6 md:p-8 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold text-text">Address book</h2>
            <p className="text-sm text-text-muted">
              Labels for addresses you send to. Stored locally in this browser;
              never synced.
            </p>
          </div>
          {editor.mode === 'closed' && (
            <Button onClick={openAdd} label="Add address" />
          )}
        </div>

        {editor.mode !== 'closed' && (
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
                {editor.mode === 'add' ? 'New entry' : 'Edit entry'}
              </span>
              <button
                type="button"
                onClick={closeEditor}
                className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim hover:text-text transition-colors"
              >
                Cancel
              </button>
            </div>
            <Input
              id="ab-label"
              label="Label"
              placeholder="e.g. Alice — personal"
              value={editor.draft.label}
              error={fieldError('label')}
              maxLength={LABEL_MAX_LEN}
              onChange={(e) => patchDraft('label', e.target.value)}
            />
            <Input
              id="ab-address"
              label="Address"
              placeholder="ys1… or s1…"
              value={editor.draft.address}
              error={fieldError('address')}
              mono
              onChange={(e) => patchDraft('address', e.target.value)}
            />
            <NotesField
              value={editor.draft.notes ?? ''}
              error={fieldError('notes')}
              onChange={(v) => patchDraft('notes', v)}
            />
            {saveError && <ErrorMessage text={saveError} />}
            <div className="flex justify-end">
              <Button
                onClick={handleSubmit}
                label={editor.mode === 'add' ? 'Save address' : 'Save changes'}
                disabled={!canSubmit}
              />
            </div>
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <div className="card-surface p-6 md:p-8 flex flex-col gap-4">
          <Input
            id="ab-search"
            label="Search"
            placeholder="Filter by label, address, or notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="text-sm text-text-muted py-6 text-center">
              No entries match "{query}".
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border -mx-6 md:-mx-8">
              {filtered.map((entry) => (
                <li key={entry.id} className="px-6 md:px-8 py-4">
                  <EntryRow
                    entry={entry}
                    onEdit={() => openEdit(entry)}
                    confirmDelete={confirmDeleteId === entry.id}
                    onAskDelete={() => setConfirmDeleteId(entry.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    onConfirmDelete={() => handleDelete(entry.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {entries.length === 0 && !loading && editor.mode === 'closed' && (
        <div className="card-surface p-10 text-center flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            No saved addresses yet. Add one to reuse it in Send and recognize
            it in your transaction history.
          </p>
        </div>
      )}
    </div>
  );
}

interface EntryRowProps {
  entry: AddressBookEntry;
  onEdit: () => void;
  confirmDelete: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}

function EntryRow({
  entry,
  onEdit,
  confirmDelete,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: EntryRowProps): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col min-w-0 gap-1 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text truncate">
            {entry.label}
          </span>
          <KindBadge kind={entry.kind} />
        </div>
        <span
          className="font-mono text-xs text-text-muted break-all"
          title={entry.address}
        >
          {entry.address}
        </span>
        {entry.notes && (
          <span className="text-xs text-text-dim">{entry.notes}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {confirmDelete ? (
          <>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
              Delete?
            </span>
            <button
              type="button"
              onClick={onConfirmDelete}
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-danger hover:opacity-80 transition-opacity"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim hover:text-text transition-colors"
            >
              No
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onEdit}
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim hover:text-text transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onAskDelete}
              className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim hover:text-danger transition-colors"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function KindBadge({
  kind,
}: {
  kind: 'shielded' | 'transparent';
}): React.JSX.Element {
  const isShielded = kind === 'shielded';
  return (
    <span
      className={cn(
        'font-mono text-[9px] uppercase tracking-[0.18em] px-1.5 py-0.5 rounded border',
        isShielded
          ? 'text-ycash border-ycash/40 bg-ycash/5'
          : 'text-text-muted border-border',
      )}
    >
      {isShielded ? 'Shielded' : 'Transparent'}
    </span>
  );
}

interface NotesFieldProps {
  value: string;
  error?: string;
  onChange: (v: string) => void;
}

function NotesField({ value, error, onChange }: NotesFieldProps) {
  const remaining = NOTES_MAX_LEN - value.length;
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between">
        <label
          htmlFor="ab-notes"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim"
        >
          Notes · optional
        </label>
        {value.length > 0 && (
          <span
            className={cn(
              'font-mono text-[10px] uppercase tracking-[0.15em]',
              remaining < 0 ? 'text-danger' : 'text-text-dim',
            )}
          >
            {remaining} left
          </span>
        )}
      </div>
      <div
        className={cn(
          'bg-card border rounded-md px-4 py-3 transition-colors',
          'border-border focus-within:border-accent',
          error && 'border-danger/60',
        )}
      >
        <textarea
          id="ab-notes"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          maxLength={NOTES_MAX_LEN + 50}
          placeholder="Anything you want to remember about this address"
          className="w-full bg-transparent text-text placeholder:text-text-dim text-sm leading-relaxed focus:outline-none resize-y"
        />
      </div>
      <ErrorMessage text={error} />
    </div>
  );
}

export default Addresses;
