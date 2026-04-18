import { useNavigate } from 'react-router-dom';
import { TransferBalanceFormType } from '../../pages/TransferBalance/useTransferBalanceForm';
import React from 'react';
import { CheckSVG, WarningSVG } from '../../assets';
import Button from '../Button/Button';
import TransactionStatusCard from '../TransactionStatusCard/TransactionStatusCard';
import { PcztTransferStatus } from 'src/hooks/usePCZT';
import Loader from 'src/components/Loader/Loader';

interface TransferResultProps {
  pcztTransferStatus: PcztTransferStatus;
  resetForm: TransferBalanceFormType['resetForm'];
  isShieldTransaction?: boolean;
  errorMessage?: string | null;
}

export function TransferResult({
  pcztTransferStatus,
  resetForm,
  isShieldTransaction,
  errorMessage,
}: TransferResultProps): React.JSX.Element {
  const navigate = useNavigate();

  const actionWord = isShieldTransaction ? 'Shielding' : 'Transfer';

  switch (pcztTransferStatus) {
    case PcztTransferStatus.SEND_SUCCESSFUL:
      return (
        <TransactionStatusCard
          tone="accent"
          headText={`${actionWord} sent`}
          statusMessage="The transaction has been broadcast. It will appear in your history once a miner confirms it."
          icon={<CheckSVG />}
        >
          <Button
            onClick={() =>
              navigate('/dashboard/account-summary', { replace: true })
            }
            label="Back to summary"
          />
          {!isShieldTransaction && (
            <Button
              variant="secondary"
              onClick={() => resetForm()}
              label="New transfer"
            />
          )}
        </TransactionStatusCard>
      );

    case PcztTransferStatus.SEND_ERROR:
      return (
        <TransactionStatusCard
          tone="danger"
          headText={`${actionWord} didn't go through`}
          statusMessage={
            errorMessage || 'The transaction was not broadcast. Try again.'
          }
          icon={<WarningSVG />}
        >
          {!isShieldTransaction && (
            <Button onClick={() => resetForm()} label="Try again" />
          )}
          <Button
            variant="ghost"
            onClick={() => navigate('/dashboard/account-summary')}
            label="Back to summary"
          />
        </TransactionStatusCard>
      );

    default:
      return (
        <TransactionStatusCard
          tone="info"
          headText={`${actionWord} in progress`}
          statusMessage={pcztTransferStatus}
          icon={<Loader />}
        />
      );
  }
}
