import React, { useEffect, useState } from 'react';
import cn from 'classnames';
import {
  TransferBalanceFormData,
  TransferBalanceFormHandleChange,
} from '../../pages/TransferBalance/useTransferBalanceForm';
import Input from '../Input/Input';
import Button from '../Button/Button';
import ErrorMessage from '../ErrorMessage/ErrorMessage';
import useBalance from '../../hooks/useBalance';
import { yecToZats, zatsToYec } from '../../utils/balance';
import { classifyAddress } from '../../utils/address';
import { AddressPicker } from '../AddressPicker/AddressPicker';
import { useAddressBook } from '../../context/AddressBookContext';

interface TransferInputProps {
  formData: TransferBalanceFormData;
  handleChange: TransferBalanceFormHandleChange;
  nextStep: () => void;
}

/**
 * Byte length of a UTF-8 string. Memos are capped at 512 bytes (ZIP-302),
 * which is not the same as 512 characters once you have emoji or non-ASCII
 * text in the memo. `TextEncoder` is the cheapest way to count.
 */
function memoByteLength(memo: string): number {
  return new TextEncoder().encode(memo).length;
}

const MEMO_MAX_BYTES = 512;

/**
 * Reserve exactly the ZIP-317 minimum fee (10_000 zats) when computing the
 * send-max amount. The real fee is computed by the wallet at signing time
 * and may be higher for complex spends, but 10_000 matches the buffer used
 * in `validateFields` below and keeps the two code paths consistent — if
 * Max fills a value, the validator should accept it.
 */
const FEE_BUFFER_ZATS = 10_000;

export function TransferInput({
  formData: { recipient, amount, memo },
  nextStep,
  handleChange,
}: TransferInputProps): React.JSX.Element {
  const { spendableBalance, shieldedBalance } = useBalance();
  const { lookup } = useAddressBook();
  const recipientMatch = recipient ? lookup(recipient) : undefined;

  const [errors, setErrors] = useState({
    recipient: '',
    transactionType: '',
    amount: '',
    memo: '',
  });

  const classification = classifyAddress(recipient);
  const memoAllowed = classification.kind === 'shielded';

  // Wipe the memo when the recipient stops being a shielded address so a
  // previously-typed memo doesn't quietly ride along if the user switches
  // recipients. The field itself is also hidden below, so leaving stale
  // state around would be invisible to the user.
  useEffect(() => {
    if (!memoAllowed && memo) {
      handleChange('memo')('');
    }
  }, [memoAllowed, memo, handleChange]);

  const validateFields = () => {
    const newErrors = {
      recipient: '',
      transactionType: '',
      amount: '',
      memo: '',
    };

    if (!recipient) {
      newErrors.recipient = 'Please enter a valid address';
    } else if (classification.kind === 'invalid') {
      newErrors.recipient = classification.reason;
    }

    if (!amount) {
      newErrors.amount = 'Amount is required';
    } else if (isNaN(Number(amount))) {
      newErrors.amount = 'Please enter a valid number';
    } else if (Number(amount) <= 0) {
      newErrors.amount = 'Amount must be greater than 0';
    } else {
      try {
        const amountInZats = yecToZats(amount);
        const totalRequired = Number(amountInZats) + FEE_BUFFER_ZATS;

        if (totalRequired > spendableBalance) {
          const availableYec = zatsToYec(
            Math.max(0, spendableBalance - FEE_BUFFER_ZATS),
          );
          newErrors.amount = `Insufficient balance. Available (after fees): ${availableYec.toFixed(8)} YEC`;
        }
      } catch (error) {
        // Edge cases like invalid decimals; propagate downstream.
      }
    }

    if (memo) {
      if (memoByteLength(memo) > MEMO_MAX_BYTES) {
        newErrors.memo = `Memo is too long (${memoByteLength(memo)} / ${MEMO_MAX_BYTES} bytes)`;
      } else if (classification.kind === 'transparent') {
        newErrors.memo =
          'Memos can only be sent to shielded (ys1…) addresses. Clear the memo or change the recipient.';
      }
    }

    setErrors(newErrors);
    return !Object.values(newErrors).some((error) => error !== '');
  };

  /**
   * Fill the amount input with "the most you can send right now" — the
   * spendable Sapling balance minus the fee buffer, in YEC, at 8-decimal
   * precision (stringified via `toFixed(8)` so the input parses cleanly
   * as `yecToZats`). Returns a no-op when the balance is too low to
   * produce a positive amount.
   */
  const fillMax = () => {
    const maxZats = spendableBalance - FEE_BUFFER_ZATS;
    if (maxZats <= 0) return;
    const maxYec = zatsToYec(maxZats).toFixed(8);
    handleChange('amount')(maxYec);
  };
  const maxDisabled = spendableBalance <= FEE_BUFFER_ZATS;

  const handleContinue = () => {
    if (validateFields()) nextStep();
  };

  return (
    <div className="card-surface p-6 md:p-8 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-border">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
          Shielded balance
        </span>
        <span className="mono text-sm text-ycash">
          {zatsToYec(shieldedBalance)} YEC
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <Input
          label="Recipient address"
          id="recipient"
          placeholder="ys1… or s1…"
          error={errors.recipient}
          value={recipient}
          mono
          onChange={(event) => handleChange('recipient')(event)}
          labelActions={
            <AddressPicker
              onSelect={(entry) => handleChange('recipient')(entry.address)}
            />
          }
        />
        {recipientMatch && (
          <div className="flex items-center gap-2 text-xs">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
              →
            </span>
            <span className="text-ycash">{recipientMatch.label}</span>
            {recipientMatch.notes && (
              <span className="text-text-dim">· {recipientMatch.notes}</span>
            )}
          </div>
        )}
      </div>
      <Input
        label="Amount"
        id="amount"
        suffix="YEC"
        error={errors.amount}
        placeholder="0.00000000"
        value={amount}
        mono
        inputMode="decimal"
        onChange={(event) => handleChange('amount')(event)}
        labelActions={
          <button
            type="button"
            onClick={fillMax}
            disabled={maxDisabled}
            title={
              maxDisabled
                ? 'No spendable balance after fee reserve'
                : `Fill in the maximum you can send (spendable − ${zatsToYec(FEE_BUFFER_ZATS).toFixed(8)} YEC fee reserve)`
            }
            className="font-mono text-[10px] uppercase tracking-[0.2em] text-ycash hover:text-ycash-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Max
          </button>
        }
      />
      {memoAllowed && (
        <MemoField
          value={memo}
          error={errors.memo}
          onChange={(event) => handleChange('memo')(event)}
        />
      )}
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-border">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
          ZIP-317 fee is estimated by the wallet
        </span>
        <Button onClick={handleContinue} label="Review transfer" />
      </div>
    </div>
  );
}

interface MemoFieldProps {
  value: string;
  error?: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

/**
 * Optional ZIP-302 text memo up to 512 bytes. Only rendered for shielded
 * recipients — memos require a shielded Sapling output, so showing the field
 * for a transparent recipient would only promise functionality the protocol
 * can't deliver. Visually styled to match the `Input` component so the form
 * keeps a consistent rhythm when the field appears/disappears.
 */
function MemoField({ value, error, onChange }: MemoFieldProps) {
  const bytes = memoByteLength(value);
  const remaining = MEMO_MAX_BYTES - bytes;
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between">
        <label
          htmlFor="memo"
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim"
        >
          Memo · optional
        </label>
        {value.length > 0 && (
          <span
            className={cn(
              'font-mono text-[10px] uppercase tracking-[0.15em]',
              remaining < 0 ? 'text-danger' : 'text-text-dim',
            )}
          >
            {remaining} bytes left
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
          id="memo"
          value={value}
          onChange={onChange}
          rows={2}
          placeholder="Optional message — visible only to the recipient"
          className="w-full bg-transparent text-text placeholder:text-text-dim text-sm leading-relaxed focus:outline-none resize-y"
        />
      </div>
      <ErrorMessage text={error} />
    </div>
  );
}
