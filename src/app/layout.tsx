// app/layout.tsx
import "@/app/globals.css";
import { cookies } from "next/headers";
import { THEME_STORAGE_KEY } from "@/lib/themeStorage";
import ClientProviders from "./client-providers";

const normalizeTheme = (value?: string | null): "light" | "dark" =>
  value && value.toLowerCase() === "dark" ? "dark" : "light";

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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const storedTheme = cookieStore.get(THEME_STORAGE_KEY)?.value ?? null;
  const initialTheme = normalizeTheme(storedTheme);
  const htmlThemeClass = initialTheme === "dark" ? "dark" : "light";

  return (
    <html lang="en" className={htmlThemeClass} suppressHydrationWarning>
      <body
        className={[
          "font-sans min-h-screen transition-colors",
          "bg-white bg-[radial-gradient(160%_160%_at_0%_-35%,#eef3ff_0%,#f6f9ff_55%,#ffffff_100%)]",
          "text-slate-900",
          "dark:bg-none dark:bg-[#222222] dark:text-slate-100",
        ].join(" ")}
      >
        <ClientProviders initialTheme={initialTheme}>
          <main className="h-full">{children}</main>
        </ClientProviders>
      </body>
    </html>
  );
}
