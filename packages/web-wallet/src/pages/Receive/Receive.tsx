import React, { useEffect, useState } from 'react';
import { useWebZjsActions } from '../../hooks';
import { useWebZjsContext } from '../../context/WebzjsContext';
import QrCode from './QrCode';
import PageHeading from '../../components/PageHeading/PageHeading';
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

  // Fetch addresses when account becomes available
  useEffect(() => {
    // Don't try to fetch if no account yet
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

  // Show loader if no account yet OR no addresses loaded yet
  const loading =
    state.activeAccount === null ||
    state.activeAccount === undefined ||
    !addresses.saplingAddress;

  const tabs = {
    [AddressType.SAPLING]: {
      label: 'Shielded (Sapling)',
    },
    [AddressType.TRANSPARENT]: {
      label: 'Transparent',
    },
  };

  return (
    <>
      <PageHeading title="Receive" />
      <div className="max-w-[1000px] p-9 bg-white rounded-3xl border border-[#afafaf] flex-col justify-start items-center gap-9 inline-flex">
        {loading ? (
          <Loader />
        ) : (
          <>
            <div className="self-stretch px-[75px] justify-center items-start gap-3 inline-flex">
              {Object.keys(tabs).map((tab) => (
                <Tab
                  key={tab}
                  tabName={tab}
                  label={tabs[tab as AddressType].label}
                  isActive={activeTab === tab}
                  onClick={() => setActiveTab(tab as AddressType)}
                />
              ))}
            </div>
            {activeTab === AddressType.SAPLING && (
              <QrCode address={addresses.saplingAddress} />
            )}
            {activeTab === AddressType.TRANSPARENT && (
              <QrCode address={addresses.transparentAddress} />
            )}
          </>
        )}
      </div>
    </>
  );
}

export default Receive;
