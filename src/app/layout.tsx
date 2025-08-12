import './globals.css'
import { ThemeProvider } from './theme-provider'
import { Poppins } from 'next/font/google'

const poppins = Poppins({
  weight: ['100','200','300','400','500','600','700','800','900'],
  subsets: ['latin'],
  display: 'swap',
})

// Optional (Next.js app router): explicitly allow zooming
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
      <body className={`${poppins.className} bg-gray-100 min-h-screen`}>
        <ThemeProvider attribute="class" defaultTheme="light">
            {/* no overflow-hidden here; we’ll control it via [data-tv="1"] in CSS */}
            <main className="h-full">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  )
}
