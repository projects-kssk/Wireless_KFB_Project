"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useInitialTheme } from "@/app/theme-provider";
import { THEME_COOKIE_MAX_AGE, THEME_STORAGE_KEY } from "@/lib/themeStorage";

const THEMES = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
] as const;

type ThemeKey = (typeof THEMES)[number]["key"];

const resolveTheme = (
  theme: string | undefined,
  resolvedTheme: string | undefined,
  fallback: ThemeKey
): ThemeKey => {
  const value = (resolvedTheme || theme || fallback || "light").toLowerCase();
  return value === "dark" ? "dark" : "light";
};

type ThemeToggleProps = {
  tone?: "default" | "card";
};

const updateRootThemeClass = (next: ThemeKey) => {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  if (next === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.remove("dark");
    root.classList.add("light");
  }
};

const persistThemeCookie = (next: ThemeKey) => {
  if (typeof document === "undefined") return;
  document.cookie = `${THEME_STORAGE_KEY}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
};

export default function ThemeToggle({ tone = "default" }: ThemeToggleProps = {}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const initialTheme = useInitialTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const active = resolveTheme(theme, resolvedTheme, initialTheme);

  useEffect(() => {
    if (!mounted) return;
    updateRootThemeClass(active);
    persistThemeCookie(active);
  }, [active, mounted]);

  const applyTheme = useCallback(
    (next: ThemeKey) => {
      setTheme(next);
      updateRootThemeClass(next);
      persistThemeCookie(next);
    },
    [setTheme]
  );

  const containerClass =
    tone === "card"
      ? "flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/90 px-1 py-1 text-xs font-semibold text-slate-700 shadow-[0_14px_28px_-20px_rgba(15,23,42,0.35)] backdrop-blur-sm dark:border-white/15 dark:bg-white/5 dark:text-slate-200"
      : "flex items-center gap-1 rounded-full border border-slate-200/80 bg-white/90 px-1 py-1 text-xs font-semibold text-slate-700 shadow-[0_14px_28px_-18px_rgba(15,23,42,0.45)] backdrop-blur-sm dark:border-white/10 dark:bg-slate-800/60 dark:text-slate-200";

  const activeClass =
    tone === "card"
      ? "bg-slate-900 text-white shadow-[0_6px_12px_rgba(15,23,42,0.3)] dark:bg-white/25 dark:text-white"
      : "bg-slate-900 text-white shadow-[0_6px_12px_rgba(15,23,42,0.25)] dark:bg-slate-100 dark:text-slate-900";

  const inactiveClass =
    tone === "card"
      ? "text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-white/10"
      : "text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700/70";

  return (
    <div className={containerClass} role="group" aria-label="Theme toggle">
      {THEMES.map(({ key, label }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            onClick={() => applyTheme(key)}
            className={[
              "px-3 py-1.5 rounded-full transition-all",
              isActive ? activeClass : inactiveClass,
            ].join(" ")}
            aria-pressed={isActive}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
