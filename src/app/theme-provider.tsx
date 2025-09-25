'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes'

export function ThemeProvider({
  children,
  attribute,
  defaultTheme,
  enableSystem,
  storageKey,
  ...rest
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute={attribute ?? 'class'}
      defaultTheme={defaultTheme ?? 'light'}
      enableSystem={enableSystem ?? false}
      storageKey={storageKey ?? 'krosy-theme'}
      {...rest}
    >
      {children}
    </NextThemesProvider>
  )
}
