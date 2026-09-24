import type { Metadata } from "next";
import Script from "next/script";
import { Fraunces, Hanken_Grotesk, Geist_Mono } from "next/font/google";
import { config } from "@/config";
import { Providers } from "@/app/Providers";
import { WalletProvider } from "@/lib/wallet/WalletProvider";
import { BitcoinWalletProvider } from "@/lib/bitcoin/useBitcoinWallet";
import { env } from "@/config/env";
import "./globals.css";

// Display - luxury editorial serif (used with restraint for wordmark + headings).
const display = Fraunces({
  variable: "--ff-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

// UI / body - precise grotesque.
const body = Hanken_Grotesk({
  variable: "--ff-body",
  subsets: ["latin"],
});

// Data - monospace with tabular figures for on-chain values, hashes, amounts.
const mono = Geist_Mono({
  variable: "--ff-mono",
  subsets: ["latin"],
});

const TITLE = "Writz - Bitcoin was built to be yours";

// The published social bio, plus the network status any description of the
// product has to carry.
const DESCRIPTION =
  "Lock real BTC. Borrow USDC on Stellar. No bridge, no custodian, no wrapped token. Live on testnet.";

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Writz",
  alternates: { canonical: "/" },
  icons: {
    // SVG first; the PNGs are the fallback for anything that will not take it.
    icon: [
      { url: "/brand/writz-icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: "Writz",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Writz. Lock real BTC. Borrow USDC on Stellar. No bridge, no custodian, no wrapped token.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@WritzProtocol",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {config.umamiWebsiteId && (
          <Script
            src="https://cloud.umami.is/script.js"
            data-website-id={config.umamiWebsiteId}
            strategy="afterInteractive"
          />
        )}
        <Providers>
          <WalletProvider>
            <BitcoinWalletProvider>{children}</BitcoinWalletProvider>
          </WalletProvider>
        </Providers>
      </body>
    </html>
  );
}
