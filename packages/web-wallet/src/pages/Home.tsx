import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogoYellowPNG, FormTransferSvg } from '../assets';
import { useSession } from '../context/SessionContext';
import Loader from '../components/Loader/Loader';

const Home: React.FC = () => {
  const navigate = useNavigate();
  const { status } = useSession();

  // Once the session probe resolves, route users into the right flow. We keep
  // the Home page itself as a "no-vault" landing — first-run visitors see the
  // Create/Import choice here rather than being immediately redirected.
  useEffect(() => {
    if (status === 'locked') navigate('/unlock', { replace: true });
    if (status === 'unlocked') navigate('/dashboard/account-summary', { replace: true });
  }, [status, navigate]);

  if (status === 'unknown' || status === 'locked' || status === 'unlocked') {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader />
      </div>
    );
  }

  return (
    <div className="home-page flex items-start md:items-center justify-center px-4 overflow-y-hidden">
      <div className="max-w-6xl w-full grid grid-cols-1 md:grid-cols-2 gap-14">
        <div className="hidden md:flex items-end justify-end">
          <FormTransferSvg />
        </div>
        <div className="flex flex-col items-start space-y-8">
          <img src={LogoYellowPNG} className="w-10 h-10" alt="Ycash Logo" />
          <h1 className="font-inter font-semibold text-[5rem] leading-[5rem]">
            Ycash <br />
            Web Wallet
          </h1>
          <p className="font-inter">
            A browser-native Ycash wallet. Keep the seed in this browser
            (passphrase-encrypted in IndexedDB) or delegate signing to the
            Ycash MetaMask Snap — whichever fits your threat model.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => navigate('/create')}
              className="flex items-center justify-center bg-button-black-gradient hover:bg-button-black-gradient-hover text-white px-6 py-3 rounded-[2rem]"
            >
              Create New Wallet
            </button>
            <button
              onClick={() => navigate('/import')}
              className="flex items-center justify-center bg-transparent text-black border border-black px-6 py-3 rounded-[2rem] hover:bg-neutral-50"
            >
              Import Seed Phrase
            </button>
          </div>
          <button
            onClick={() => navigate('/connect-snap')}
            className="text-sm underline text-neutral-600 hover:text-neutral-900"
          >
            Use MetaMask Snap instead →
          </button>
        </div>
      </div>
    </div>
  );
};

export default Home;
