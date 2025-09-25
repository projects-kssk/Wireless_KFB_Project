// app/layout.tsx
import "@/app/globals.css";
import ClientProviders from "./client-providers";

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
} as const;

export const metadata = {
  title: "Wireless KFB",
  description:
    "This is a simple coming soon template built with NextJS and TailwindCSS. " +
    "It is a lightweight and responsive template that can be used for various " +
    'projects that require a "coming soon" page.',
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={[
          "font-sans min-h-screen transition-colors",
          "bg-white bg-[radial-gradient(160%_160%_at_0%_-35%,#eef3ff_0%,#f6f9ff_55%,#ffffff_100%)]",
          "text-slate-900",
          "dark:bg-none dark:bg-[#222222] dark:text-slate-100",
        ].join(" ")}
      >
        <ClientProviders>
          <main className="h-full">{children}</main>
        </ClientProviders>
      </body>
    </html>
  );
}
