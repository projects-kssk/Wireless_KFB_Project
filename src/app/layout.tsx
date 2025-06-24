// layout.tsx
import './globals.css'
import { ThemeProvider } from './theme-provider'
import { Poppins } from 'next/font/google'

const poppins = Poppins({
  weight: [
    '100','200','300','400','500','600','700','800','900'
  ],
  subsets: ['latin'],
  display: 'swap',
})

export const metadata = {
  title: "Home - Coming soon Template",
  description:
    'This is a simple coming soon template built with NextJS and TailwindCSS. ' +
    'It is a lightweight and responsive template that can be used for various ' +
    'projects that require a "coming soon" page.',
  icons: {
    icon: "/favicon.ico",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* 
        1) We add `overflow-hidden` here so that the body never scrolls.
        2) Keep `min-h-screen` so that the body still fills the viewport height.
      */}
      <body className={`${poppins.className} bg-gray-100 min-h-screen`}>
        <ThemeProvider attribute="class" defaultTheme="light">
          {/*
            3) Make the <main> fill the full height and also hide any overflow
               in case its children try to expand beyond the viewport.
          */}
          <main className="main h-full">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  )
}
