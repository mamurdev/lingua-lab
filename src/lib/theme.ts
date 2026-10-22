export type Theme = 'light' | 'dark';

const THEME_KEY = 'lingua_theme';

export function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    if (document.documentElement.classList.contains('dark')) return 'dark';
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof window === 'undefined') return;
  try {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }
    localStorage.setItem(THEME_KEY, theme);
    window.dispatchEvent(new CustomEvent('lingua-theme-change', { detail: { theme } }));
  } catch {
    /* ignore storage access error */
  }
}

export function toggleTheme(): Theme {
  const current = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}
