// app/layout.tsx
import './globals.css'
import ClientProviders from './client-providers'

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
} as const

export const metadata = {
  title: 'Wireless KFB',
  description:
    'This is a simple coming soon template built with NextJS and TailwindCSS. ' +
    'It is a lightweight and responsive template that can be used for various ' +
    'projects that require a "coming soon" page.',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans bg-gray-100 min-h-screen">
        <ClientProviders>
          <main className="h-full">{children}</main>
        </ClientProviders>
      </body>
    </html>
  )
}
