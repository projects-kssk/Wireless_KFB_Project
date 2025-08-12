import './globals.css'
import { ThemeProvider } from './theme-provider'
import { Poppins } from 'next/font/google'
import ViewportScaler from './viewport-scaler'

const poppins = Poppins({
  weight: ['100','200','300','400','500','600','700','800','900'],
  subsets: ['latin'],
  display: 'swap',
})

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
          {/* Scales entire app in TV mode; exposes data-display / data-tv on <html> */}
          <ViewportScaler>
            <main className="h-full overflow-hidden">{children}</main>
          </ViewportScaler>
        </ThemeProvider>
      </body>
    </html>
  )
}
