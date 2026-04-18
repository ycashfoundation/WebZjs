import React from 'react';
import {
  TransferBalanceFormData,
  TransferBalanceFormType,
} from '../../pages/TransferBalance/useTransferBalanceForm';
import Button from '../Button/Button';

interface TransferConfirmProps {
  formData: TransferBalanceFormData;
  nextStep: TransferBalanceFormType['nextStep'];
  submitForm: () => void;
}

export function TransferConfirm({
  formData: { recipient, amount },
  nextStep,
  submitForm,
}: TransferConfirmProps): React.JSX.Element {
  const handleNextStep = () => {
    try {
      submitForm();
      nextStep();
    } catch (error) {
      nextStep();
      console.error(error);
    }
  };

  const Row = ({
    label,
    value,
    mono = false,
  }: {
    label: string;
    value: string;
    mono?: boolean;
  }) => (
    <div className="flex flex-col gap-1.5 py-4 border-b border-border last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
        {label}
      </span>
      <span
        className={
          mono
            ? 'mono text-sm text-text break-all leading-relaxed'
            : 'text-text text-sm'
        }
      >
        {value}
      </span>
    </div>
  );

  return (
    <div className="card-surface p-6 md:p-8 flex flex-col gap-4">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-dim">
          Review · step 2 of 2
        </span>
        <span className="pill pill-accent">ready to sign</span>
      </div>
      <div className="flex flex-col">
        <Row label="Recipient" value={recipient} mono />
        <Row label="Amount" value={`${amount} YEC`} />
        <Row
          label="Network fee"
          value="ZIP-317 (calculated at signing time)"
        />
      </div>
      <div className="flex items-center gap-3 pt-2">
        <Button onClick={handleNextStep} label="Sign and send" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
          Irreversible once broadcast
        </span>
      </div>
    </div>
  );
}
