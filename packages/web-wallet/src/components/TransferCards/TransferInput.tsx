import React, { useState } from 'react';
import {
  TransferBalanceFormData,
  TransferBalanceFormHandleChange,
} from '../../pages/TransferBalance/useTransferBalanceForm';
import Input from '../Input/Input';
import Button from '../Button/Button';
import useBalance from '../../hooks/useBalance';
import { yecToZats, zatsToYec } from '../../utils/balance';

interface TransferInputProps {
  formData: TransferBalanceFormData;
  handleChange: TransferBalanceFormHandleChange;
  nextStep: () => void;
}

export function TransferInput({
  formData: { recipient, amount },
  nextStep,
  handleChange,
}: TransferInputProps): React.JSX.Element {
  const { spendableBalance, shieldedBalance } = useBalance();

  const [errors, setErrors] = useState({
    recipient: '',
    transactionType: '',
    amount: '',
  });

  const validateFields = () => {
    const newErrors = {
      recipient: '',
      transactionType: '',
      amount: '',
    };

    if (!recipient) {
      newErrors.recipient = 'Please enter a valid address';
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
        const FEE_BUFFER = 10_000;
        const totalRequired = Number(amountInZats) + FEE_BUFFER;

        if (totalRequired > spendableBalance) {
          const availableYec = zatsToYec(
            Math.max(0, spendableBalance - FEE_BUFFER),
          );
          newErrors.amount = `Insufficient balance. Available (after fees): ${availableYec.toFixed(8)} YEC`;
        }
      } catch (error) {
        // Edge cases like invalid decimals; propagate downstream.
      }
    }

    setErrors(newErrors);
    return !Object.values(newErrors).some((error) => error !== '');
  };

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
      <Input
        label="Recipient address"
        id="recipient"
        placeholder="ys1… or s1…"
        error={errors.recipient}
        value={recipient}
        mono
        onChange={(event) => handleChange('recipient')(event)}
      />
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
      />
      <div className="flex items-center justify-between gap-4 pt-2 border-t border-border">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
          ZIP-317 fee is estimated by the wallet
        </span>
        <Button onClick={handleContinue} label="Review transfer" />
      </div>
    </div>
  );
}
