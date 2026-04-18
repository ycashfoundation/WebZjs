import cn from 'classnames';
import { NavLink, useNavigate } from 'react-router-dom';
import { useSession } from '../../context/SessionContext';

interface NavItem {
  to: string;
  label: string;
}

const navItems: NavItem[] = [
  { to: 'account-summary', label: 'Summary' },
  { to: 'transactions', label: 'Transactions' },
  { to: 'transfer-balance', label: 'Send' },
  { to: 'shield-balance', label: 'Shield' },
  { to: 'receive', label: 'Receive' },
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
    <nav className="flex items-center gap-1 px-2 md:px-4 py-2 mb-8 border-b border-border">
      <div className="flex items-center gap-1 overflow-x-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'relative px-4 py-2.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap',
                isActive
                  ? 'text-text bg-card'
                  : 'text-text-muted hover:text-text hover:bg-surface',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span>{item.label}</span>
                {isActive && (
                  <span className="absolute -bottom-[9px] left-3 right-3 h-[2px] bg-accent rounded-full" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
      <button
        type="button"
        onClick={handleClick}
        className="ml-auto font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim hover:text-ycash transition-colors px-3 py-2"
      >
        {isSnap ? 'Disconnect' : 'Lock'}
      </button>
    </nav>
  );
}

export default NavBar;
