import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { THEME_SCRIPT, ThemedToaster } from "@/components/theme";
import { TooltipProvider } from "@/components/ui/overlays";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Saunf", template: "%s · Saunf" },
  description: "Saunf — your team's private task workspace.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#002f70" },
    { media: "(prefers-color-scheme: dark)", color: "#141a33" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The theme script adds the `dark` class before React hydrates.
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <ThemedToaster />
      </body>
    </html>
  );
}
