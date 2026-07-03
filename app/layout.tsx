import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./halcyon.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mahjong Calculator",
  description: "Singaporean & Riichi mahjong payout calculator",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

// Set the Halcyon theme (light/dark follows Telegram, else the OS) + accent on
// <html> BEFORE first paint so there's no flash. Kept tiny and dependency-free;
// live theme changes are handled at runtime in lib/telegram.ts.
// NOTE: telegram-web-app.js creates window.Telegram.WebApp even in a plain
// browser, with colorScheme defaulting to 'light'. So trust tg.colorScheme only
// when there's real initData (an actual Telegram launch); otherwise follow the OS.
const THEME_BOOT = `(function(){try{
  var r=document.documentElement;
  var tg=window.Telegram&&window.Telegram.WebApp;
  var real=tg&&tg.initData;
  var dark=real?tg.colorScheme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
  r.dataset.theme=dark?'dark':'light';
  r.dataset.accent='slate';
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400;1,500&family=JetBrains+Mono:ital,wght@0,400;0,500;0,600&display=swap"
          rel="stylesheet"
        />
        {/* Telegram Mini App SDK - must load before the app reads window.Telegram */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <Script id="halcyon-theme" strategy="beforeInteractive">{THEME_BOOT}</Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
