import React, { useEffect, useMemo, useState } from 'react';
import PageHeading from '../../components/PageHeading/PageHeading';
import useBalance from '../../hooks/useBalance';
import { zatsToYec } from '../../utils';
import Button from 'src/components/Button/Button';
import { useWebZjsActions } from 'src/hooks';
import { usePczt } from 'src/hooks/usePCZT';
import { TransferResult } from 'src/components/TransferCards/TransferResult';

export enum ShieldStatus {
  DEFAULT = 'default',
  SHIELDING = 'shielding',
}

export function ShieldBalance(): React.JSX.Element {
  const { unshieldedBalance } = useBalance();
  const [addresses, setAddresses] = useState<{
    saplingAddress: string;
    transparentAddress: string;
  }>({
    saplingAddress: '',
    transparentAddress: '',
  });

  const { getAccountData } = useWebZjsActions();
  const { handlePcztShieldTransaction, pcztTransferStatus } = usePczt();
  const [shieldStatus, setShieldStatus] = useState(ShieldStatus.DEFAULT);

  useEffect(() => {
    const fetchData = async () => {
      const data = await getAccountData();
      if (data)
        setAddresses({
          saplingAddress: data.saplingAddress,
          transparentAddress: data.transparentAddress,
        });
    };
    fetchData();
  }, [getAccountData]);

  const handleShieldBalance = () => {
    setShieldStatus(ShieldStatus.SHIELDING);
    handlePcztShieldTransaction(
      1,
      addresses.saplingAddress,
      unshieldedBalance.toString(),
    );
  };

  const isMinimalShieldAmount = useMemo(() => {
    // Need at least 0.001 YEC + fee buffer (0.0015 YEC total minimum)
    const MINIMUM_SHIELD_AMOUNT = 100000;
    const FEE_BUFFER = 50000;
    return unshieldedBalance > MINIMUM_SHIELD_AMOUNT + FEE_BUFFER;
  }, [unshieldedBalance]);

  return (
    <div className="w-full pb-16">
      <PageHeading title="Shield balance" eyebrow="Move transparent → private">
        <div className="card-surface px-4 py-2 flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-dim">
            Transparent balance
          </span>
          <span className="mono text-sm text-text">
            {zatsToYec(unshieldedBalance)} YEC
          </span>
        </div>
      </PageHeading>

      {shieldStatus === ShieldStatus.DEFAULT && (
        <div className="card-surface p-6 md:p-8 flex flex-col gap-4">
          <div className="pb-4 border-b border-border flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-text-dim">
              Shield all
            </span>
            <span className="pill pill-accent">sapling</span>
          </div>

          <div className="flex flex-col gap-1.5 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
              Destination (your Sapling address)
            </span>
            <span className="mono text-sm text-text break-all leading-relaxed">
              {addresses.saplingAddress || '—'}
            </span>
          </div>
          <div className="flex items-baseline justify-between py-2 border-t border-border">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-dim">
              Amount
            </span>
            <span className="mono text-lg text-ycash">
              {zatsToYec(unshieldedBalance)} YEC
            </span>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              onClick={handleShieldBalance}
              label="Shield balance"
              disabled={!isMinimalShieldAmount}
            />
            {!isMinimalShieldAmount && (
              <span className="font-mono text-[11px] text-danger leading-relaxed">
                Need ≥ 0.0015 YEC transparent balance (covers the fee). You
                have {zatsToYec(unshieldedBalance)} YEC.
              </span>
            )}
          </div>
        </div>
      )}

      {shieldStatus === ShieldStatus.SHIELDING && (
        <TransferResult
          pcztTransferStatus={pcztTransferStatus}
          resetForm={() => {
            setShieldStatus(ShieldStatus.DEFAULT);
          }}
          isShieldTransaction
        />
      )}
    </div>
  );
}
