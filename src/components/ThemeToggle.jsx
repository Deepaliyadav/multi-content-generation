import { useEffect, useState } from 'react';

/**
 * Light / dark switch.
 *
 * Three states, not two: an explicit choice stamps `data-theme` on the root and
 * wins over everything; with no choice stored the OS setting decides, which is
 * why the buttons reflect what is actually on screen rather than what was
 * clicked. The preference is per browser — it is about the room you are sitting
 * in, not about the story.
 */
const KEY = 'lss.theme';

const read = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null; // private window or blocked storage — the OS setting still works
  }
};

export default function ThemeToggle() {
  const [choice, setChoice] = useState(read);
  const [systemLight, setSystemLight] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
  );

  useEffect(() => {
    const root = document.documentElement;
    if (choice) root.setAttribute('data-theme', choice);
    else root.removeAttribute('data-theme');
    try {
      choice ? localStorage.setItem(KEY, choice) : localStorage.removeItem(KEY);
    } catch {
      /* the session still honours the choice */
    }
  }, [choice]);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const q = matchMedia('(prefers-color-scheme: light)');
    const on = (e) => setSystemLight(e.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);

  const isLight = choice === 'light' || (choice !== 'dark' && systemLight);

  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      <button
        type="button"
        aria-pressed={isLight}
        title="Light theme"
        aria-label="Light theme"
        onClick={() => setChoice('light')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </button>
      <button
        type="button"
        aria-pressed={!isLight}
        title="Dark theme"
        aria-label="Dark theme"
        onClick={() => setChoice('dark')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </button>
    </div>
  );
}
