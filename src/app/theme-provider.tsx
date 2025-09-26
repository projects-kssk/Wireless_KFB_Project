'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes'
import { THEME_STORAGE_KEY } from '@/lib/themeStorage'

type BaseTheme = 'light' | 'dark'

const normalizeTheme = (value?: string | null): BaseTheme =>
  value && value.toLowerCase() === 'dark' ? 'dark' : 'light'

const InitialThemeContext = React.createContext<BaseTheme>('light')

export const useInitialTheme = () => React.useContext(InitialThemeContext)

type AppThemeProviderProps = ThemeProviderProps & {
  initialTheme?: BaseTheme
}

export function ThemeProvider({
  children,
  attribute,
  defaultTheme,
  enableSystem,
  storageKey,
  initialTheme,
  ...rest
}: AppThemeProviderProps) {
  const fallbackTheme = normalizeTheme(initialTheme ?? defaultTheme)
  const resolvedDefaultTheme = defaultTheme ?? fallbackTheme

  return (
    <InitialThemeContext.Provider value={fallbackTheme}>
      <NextThemesProvider
        attribute={attribute ?? 'class'}
        defaultTheme={resolvedDefaultTheme}
        enableSystem={enableSystem ?? false}
        storageKey={storageKey ?? THEME_STORAGE_KEY}
        {...rest}
      >
        {children}
      </NextThemesProvider>
    </InitialThemeContext.Provider>
  )
}
