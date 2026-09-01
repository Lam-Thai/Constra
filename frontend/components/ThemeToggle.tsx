"use client";

import { useLayoutEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import styles from "./ThemeToggle.module.css";

type Theme = "light" | "dark";

const STORAGE_KEY = "constra-theme";

// useLayoutEffect (not useEffect) so the DOM state is corrected
// synchronously before the browser paints — the inline script in
// app/layout.tsx already sets the real theme on <html> before hydration,
// this just brings this component's own state in sync with it before
// anything is drawn, so there's no visible flash of the default icon.
// Guarded to a no-op on the server to avoid React's "useLayoutEffect does
// nothing on the server" console warning.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : () => {};

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Ignore write failures (e.g. storage disabled) — theme still applies
    // for this session via the DOM attribute.
  }
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2.5v2.5M12 19v2.5M4.5 12H2M22 12h-2.5M6.3 6.3 4.5 4.5M19.5 19.5l-1.8-1.8M6.3 17.7l-1.8 1.8M19.5 4.5l-1.8 1.8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20.5 14.5a8.5 8.5 0 1 1-9-11 6.8 6.8 0 0 0 9 11Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function ThemeToggle() {
  // Default matches the server-rendered markup (light) so hydration's
  // first commit is consistent; the layout effect below corrects it to the
  // real value before paint.
  const [theme, setTheme] = useState<Theme>("light");

  useIsomorphicLayoutEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "dark" || current === "light") setTheme(current);
  }, []);

  function toggle() {
    setTheme((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      return next;
    });
  }

  const isDark = theme === "dark";

  return (
    <motion.button
      type="button"
      className={styles.toggle}
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.12 }}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? "moon" : "sun"}
          className={styles.icon}
          initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {isDark ? <MoonIcon /> : <SunIcon />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
