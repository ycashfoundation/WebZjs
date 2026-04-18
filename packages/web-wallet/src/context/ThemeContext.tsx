import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'yw:theme';
const DEFAULT: Theme = 'dark';

interface ThemeContextShape {
  theme: Theme;
  toggle: () => void;
  setTheme: (next: Theme) => void;
}

const ThemeContext = createContext<ThemeContextShape | undefined>(undefined);

function readStoredTheme(): Theme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    // SSR / private mode / disabled storage — fall through to default.
  }
  return DEFAULT;
}

function applyTheme(next: Theme) {
  document.documentElement.setAttribute('data-theme', next);
}

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  // Read synchronously on mount to stay in sync with the pre-hydration
  // inline script in index.html (which sets data-theme before React runs).
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggle = useCallback(
    () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')),
    [],
  );

  const value = useMemo(
    () => ({ theme, toggle, setTheme }),
    [theme, toggle, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextShape {
  const ctx = useContext(ThemeContext);
  if (!ctx)
    throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
