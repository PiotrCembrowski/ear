import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { APP_NAME } from "@/lib/config/app-config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description:
    "Play or make a sound into your microphone and SoundMatch analyses it live: identify notes, compare against reference sounds, and see honest results. Your audio never leaves your device.",
};

export const viewport: Viewport = {
  themeColor: "#090a0f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-canvas text-ink">{children}</body>
    </html>
  );
}
