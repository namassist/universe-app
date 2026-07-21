import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";

import "./globals.css";

import { Providers } from "@/components/providers/providers";

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "UNIVERSE — Fleet Automation",
    template: "%s · UNIVERSE",
  },
  description: "Unggul Network for Integrated Vehicle Resource Smart Ecosystem",
  applicationName: "UNIVERSE",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EAF3FF" },
    { media: "(prefers-color-scheme: dark)", color: "#010416" },
  ],
};

// Resolve theme before paint to avoid a flash of the wrong theme.
const themeInit = `(function(){try{var p=localStorage.getItem('universe-theme')||'system';var l=window.matchMedia('(prefers-color-scheme: light)').matches;document.documentElement.setAttribute('data-theme',p==='system'?(l?'light':'dark'):p);}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="id"
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${geistMono.variable} antialiased`}
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
