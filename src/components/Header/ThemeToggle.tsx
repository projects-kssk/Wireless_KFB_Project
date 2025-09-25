"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

const THEMES = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
] as const;

type ThemeKey = (typeof THEMES)[number]["key"];

const resolveTheme = (
  theme: string | undefined,
  resolvedTheme: string | undefined,
): ThemeKey => {
  const value = (resolvedTheme || theme || "light").toLowerCase();
  return value === "dark" ? "dark" : "light";
};

export default function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const active = mounted ? resolveTheme(theme, resolvedTheme) : undefined;

  return (
    <div
      className="flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-1 py-1 text-xs font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      role="group"
      aria-label="Theme toggle"
    >
      {THEMES.map(({ key, label }) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setTheme(key)}
            className={[
              "px-2.5 py-1 rounded-lg transition-colors",
              isActive
                ? "bg-slate-900 text-white shadow-inner dark:bg-slate-100 dark:text-slate-900"
                : "text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-700/80",
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
