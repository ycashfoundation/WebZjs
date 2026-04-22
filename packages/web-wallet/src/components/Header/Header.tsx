import React, { useCallback, useEffect, useRef, useState } from 'react';
import cn from 'classnames';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LogoYellowPNG } from '../../assets';
import { useTheme } from '../../context/ThemeContext';
import { useSession } from '../../context/SessionContext';

/**
 * Top-of-page brand bar *and* primary navigation for the dashboard. Renders
 * as one row at >=900px ("logo · tabs · controls · lock") and collapses to
 * a hamburger drawer below that — the tabs live inside a dropdown so the
 * Ycash wordmark + MAINNET indicator still fit on narrow viewports.
 *
 * Nav entries are only shown while a dashboard route is active; the marketing
 * / onboarding / unlock pages render the header with just the brand and
 * theme/network cluster.
 */
interface NavItem {
  to: string;
  label: string;
}

const DASHBOARD_NAV_ITEMS: NavItem[] = [
  { to: '/dashboard/account-summary', label: 'Balance' },
  { to: '/dashboard/transactions', label: 'Transactions' },
  { to: '/dashboard/transfer-balance', label: 'Send' },
  { to: '/dashboard/receive', label: 'Receive' },
  { to: '/dashboard/addresses', label: 'Addresses' },
];

const Header = (): React.JSX.Element => {
  const { theme, toggle } = useTheme();
  const { backend, lock, wipeVault, status: sessionStatus } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuListRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Pull focusable children inside the menu in visual order. NavLinks
  // render as <a>, the Lock/Disconnect trigger is a <button>. `tabindex` is
  // reset to -1 so the only way to reach them is via the arrow-key handler
  // below (otherwise Tab could leapfrog out of the menu mid-list).
  const getMenuItems = useCallback((): HTMLElement[] => {
    if (!menuListRef.current) return [];
    return Array.from(
      menuListRef.current.querySelectorAll<HTMLElement>('a, button'),
    );
  }, []);

  const focusMenuItem = useCallback(
    (idx: number) => {
      const items = getMenuItems();
      if (items.length === 0) return;
      const clamped = ((idx % items.length) + items.length) % items.length;
      items[clamped].focus();
    },
    [getMenuItems],
  );

  // When the menu opens, move focus into it so arrow keys target the list
  // instead of the hamburger button that just opened it.
  useEffect(() => {
    if (!menuOpen) return;
    // Defer a tick so the menu DOM is actually mounted before we call focus.
    const raf = requestAnimationFrame(() => focusMenuItem(0));
    return () => cancelAnimationFrame(raf);
  }, [menuOpen, focusMenuItem]);

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const items = getMenuItems();
      if (items.length === 0) return;
      const currentIdx = items.indexOf(document.activeElement as HTMLElement);
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          focusMenuItem(currentIdx + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          focusMenuItem(currentIdx - 1);
          break;
        case 'Home':
          e.preventDefault();
          focusMenuItem(0);
          break;
        case 'End':
          e.preventDefault();
          focusMenuItem(items.length - 1);
          break;
        case 'Tab':
          // Let Tab close the menu and move on — keeps keyboard flow
          // consistent with the rest of the page instead of trapping focus.
          setMenuOpen(false);
          break;
      }
    },
    [getMenuItems, focusMenuItem],
  );

  const isDark = theme === 'dark';
  const isDashboardRoute = location.pathname.startsWith('/dashboard');
  const showNav = isDashboardRoute && sessionStatus === 'unlocked';
  const isSnap = backend === 'snap';

  // Close the mobile menu on route change so tapping a link doesn't leave
  // the dropdown open.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Outside-click and Escape close the mobile menu. Escape additionally
  // returns focus to the hamburger button so keyboard users don't land on
  // <body> after dismissing.
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleLockOrDisconnect = useCallback(async () => {
    if (isSnap) {
      await wipeVault();
      navigate('/', { replace: true });
    } else {
      lock();
      navigate('/unlock', { replace: true });
    }
  }, [isSnap, wipeVault, navigate, lock]);

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap',
      isActive
        ? 'text-text bg-card'
        : 'text-text-muted hover:text-text hover:bg-surface',
    );

  return (
    <header className="sticky top-[42px] z-30 h-[60px] w-full flex items-center justify-between gap-4 px-6 md:px-10 bg-bg/90 backdrop-blur-md border-b border-border">
      <Link
        to={'/'}
        className="group flex items-center gap-3 shrink-0 transition-opacity hover:opacity-90"
      >
        <img
          src={LogoYellowPNG}
          className="w-8 h-8 drop-shadow-[0_0_10px_rgba(245,103,51,0.3)]"
          alt="Ycash"
        />
        <span className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-tight text-text">
            Ycash
          </span>
          <span className="font-mono text-xs text-text-muted hidden sm:inline">
            // wallet
          </span>
        </span>
      </Link>

      {/* Inline nav (desktop). Shown only on dashboard routes and only when
          the viewport has room — otherwise the hamburger takes over. */}
      {showNav && (
        <nav className="hidden min-[900px]:flex items-center gap-1 min-w-0">
          {DASHBOARD_NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={tabClass}>
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
        </nav>
      )}

      <div className="flex items-center gap-3 md:gap-4 shrink-0">
        <button
          type="button"
          onClick={toggle}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-card transition-colors"
        >
          {isDark ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
            </svg>
          ) : (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <div className="hidden sm:flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-accent opacity-60 animate-ping"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-dim">
            mainnet
          </span>
        </div>

        {/* Lock/Disconnect (desktop). On mobile it moves into the hamburger
            dropdown so the header row stays calm. */}
        {showNav && (
          <button
            type="button"
            onClick={handleLockOrDisconnect}
            className="hidden min-[900px]:inline-flex font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim hover:text-ycash transition-colors px-2 py-2"
          >
            {isSnap ? 'Disconnect' : 'Lock'}
          </button>
        )}

        {/* Hamburger (mobile). Only visible when there's a nav to collapse. */}
        {showNav && (
          <div
            ref={menuRef}
            className="relative min-[900px]:hidden"
            onKeyDown={handleMenuKeyDown}
          >
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="w-9 h-9 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-card transition-colors"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                {menuOpen ? (
                  <>
                    <path d="M6 6l12 12" />
                    <path d="M18 6L6 18" />
                  </>
                ) : (
                  <>
                    <path d="M3 6h18" />
                    <path d="M3 12h18" />
                    <path d="M3 18h18" />
                  </>
                )}
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 min-w-[200px] card-surface py-2 shadow-lg z-50">
                <nav
                  ref={menuListRef}
                  role="menu"
                  aria-label="Wallet navigation"
                  className="flex flex-col"
                >
                  {DASHBOARD_NAV_ITEMS.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      role="menuitem"
                      tabIndex={-1}
                      className={({ isActive }) =>
                        cn(
                          'px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:bg-surface focus:text-text',
                          isActive
                            ? 'text-text bg-card'
                            : 'text-text-muted hover:text-text hover:bg-surface',
                        )
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                  <div className="my-1 mx-3 h-px bg-border" />
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={handleLockOrDisconnect}
                    className="px-4 py-2.5 text-left font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim hover:text-ycash hover:bg-surface focus:outline-none focus:bg-surface focus:text-ycash transition-colors"
                  >
                    {isSnap ? 'Disconnect' : 'Lock'}
                  </button>
                </nav>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
