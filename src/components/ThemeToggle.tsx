import { useState, useEffect } from 'react';
import { getInitialTheme, toggleTheme, type Theme } from '../lib/theme';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export default function ThemeToggle({ className = '', showLabel = true }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ theme: Theme }>;
      if (customEvent.detail?.theme) {
        setTheme(customEvent.detail.theme);
      } else {
        setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
      }
    };

    window.addEventListener('lingua-theme-change', handleThemeChange);
    return () => {
      window.removeEventListener('lingua-theme-change', handleThemeChange);
    };
  }, []);

  const handleToggle = () => {
    const next = toggleTheme();
    setTheme(next);
  };

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={handleToggle}
      aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      className={`group relative inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 border cursor-pointer select-none active:scale-95 ${
        isDark
          ? 'bg-[#101726] hover:bg-[#151f33] border-white/[0.1] text-slate-200 shadow-sm shadow-black/40 hover:border-white/[0.16]'
          : 'bg-white hover:bg-slate-50 border-slate-200/90 text-slate-700 shadow-xs hover:border-slate-300'
      } ${className}`}
    >
      <div className="relative w-4 h-4 flex items-center justify-center shrink-0">
        {/* Sun Icon */}
        <svg
          className={`w-4 h-4 text-amber-400 absolute transition-all duration-300 transform ${
            isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-50 pointer-events-none'
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
        {/* Moon Icon */}
        <svg
          className={`w-4 h-4 text-slate-600 dark:text-slate-400 absolute transition-all duration-300 transform ${
            !isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 rotate-90 scale-50 pointer-events-none'
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      </div>

      {showLabel && (
        <span className="text-[11px] font-medium hidden sm:inline">
          {isDark ? 'Light' : 'Dark'}
        </span>
      )}
    </button>
  );
}
