import React from 'react';
import cn from 'classnames';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSession } from '../../context/SessionContext';

import {
  ArrowReceiveSvg,
  ArrowTransferSvg,
  SummarySvg,
  ShieldSvg,
  ClockSvg
} from '../../assets';

interface NavItem {
  to: string;
  label: string;
  icon: React.JSX.Element;
}

const navItems: NavItem[] = [
  {
    to: 'account-summary',
    label: 'Account Summary',
    icon: <SummarySvg />,
  },
  {
    to: 'transactions',
    label: 'Transactions',
    icon: <ClockSvg />,
  },
  {
    to: 'transfer-balance',
    label: 'Transfer Balance',
    icon: <ArrowTransferSvg />,
  },
    {
    to: 'shield-balance',
    label: 'Shield Balance',
    icon: <ShieldSvg />,
  },
  {
    to: 'receive',
    label: 'Receive',
    icon: <ArrowReceiveSvg />,
  }
];

function NavBar() {
  const { backend, lock, wipeVault } = useSession();
  const navigate = useNavigate();

  // Browser backend has a passphrase to re-enter, so "Lock" drops the
  // mnemonic and sends the user to the unlock prompt. Snap backend has no
  // per-session credential — there's nothing to lock behind — so the same
  // button instead disconnects: clears the persisted backend choice and
  // returns to Home where they can pick again.
  const isSnap = backend === 'snap';
  const handleClick = async () => {
    if (isSnap) {
      await wipeVault();
      navigate('/', { replace: true });
    } else {
      lock();
      navigate('/unlock', { replace: true });
    }
  };

  return (
    <nav className="flex space-x-9 mb-3 justify-center self-center items-center align-middle">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            cn('text-sm text-[#0e0e0e] font-semibold leading-tight pb-3', {
              'text-black border-b border-orange-500': isActive,
            })
          }
        >
          {({ isActive }) => (
            <span
              className={cn(
                'inline-flex items-center hover:text-brand-orange navbar-link',
                { 'navbar-link-active': isActive },
              )}
            >
              <span className="text-brand-grey10 text-sm  mr-2">
                {item.icon}
              </span>
              {item.label}
            </span>
          )}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={handleClick}
        className="text-sm text-[#0e0e0e] font-semibold leading-tight pb-3 hover:text-brand-orange ml-auto"
      >
        {isSnap ? 'Disconnect' : 'Lock'}
      </button>
    </nav>
  );
}

export default NavBar;
