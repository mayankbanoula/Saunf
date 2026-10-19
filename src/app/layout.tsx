import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/overlays";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Saunf", template: "%s · Saunf" },
  description: "Saunf — your team's private task workspace.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#002f70",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
