import React, { useEffect, useState } from 'react';
import { useWebZjsActions } from '../../hooks';
import { useWebZjsContext } from '../../context/WebzjsContext';
import QrCode from './QrCode';
import Loader from '../../components/Loader/Loader';
import Tab from './Tab';

enum AddressType {
  SAPLING = 'sapling',
  TRANSPARENT = 'transparent',
}

function Receive(): React.JSX.Element {
  const { state } = useWebZjsContext();
  const { getAccountData } = useWebZjsActions();
  const [activeTab, setActiveTab] = useState<AddressType>(AddressType.SAPLING);
  const [addresses, setAddresses] = useState<{
    saplingAddress: string;
    transparentAddress: string;
  }>({
    saplingAddress: '',
    transparentAddress: '',
  });

  useEffect(() => {
    if (state.activeAccount === null || state.activeAccount === undefined) {
      return;
    }
    const fetchData = async () => {
      const data = await getAccountData();
      if (data) {
        setAddresses({
          saplingAddress: data.saplingAddress,
          transparentAddress: data.transparentAddress,
        });
      }
    };
    fetchData();
  }, [state.activeAccount, getAccountData]);

  const loading =
    state.activeAccount === null ||
    state.activeAccount === undefined ||
    !addresses.saplingAddress;

  const tabs: { key: AddressType; label: string; hint: string }[] = [
    {
      key: AddressType.SAPLING,
      label: 'Private (Sapling)',
      hint: 'ys1… · default',
    },
    {
      key: AddressType.TRANSPARENT,
      label: 'Public (Transparent)',
      hint: 's1… · for shield-in flows',
    },
  ];

  const activeHint = tabs.find((t) => t.key === activeTab)?.hint;
  const activeAddress =
    activeTab === AddressType.SAPLING
      ? addresses.saplingAddress
      : addresses.transparentAddress;

  return (
    <div className="w-full pb-16">
      <div className="card-surface p-6 md:p-8">
        {loading ? (
          <div className="py-20 flex justify-center">
            <Loader />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-border">
              {tabs.map((tab) => (
                <Tab
                  key={tab.key}
                  tabName={tab.key}
                  label={tab.label}
                  isActive={activeTab === tab.key}
                  onClick={() => setActiveTab(tab.key)}
                />
              ))}
              <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
                {activeHint}
              </span>
            </div>
            <div className="flex justify-center">
              <QrCode address={activeAddress} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Receive;
