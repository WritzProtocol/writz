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

const TITLE = "Writz - Lock Bitcoin. Borrow dollars.";

// The published social bio, plus the network status any description of the
// product has to carry.
const DESCRIPTION =
  "Lock real BTC. Borrow USDC on Stellar. No bridge, no custodian, no wrapped token. Live on Stellar testnet.";

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Writz",
  alternates: { canonical: "/" },
  icons: {
    // Chrome takes the ICO over the SVG when the ICO declares more sizes; the
    // SVG switches colour with the browser theme, the ICO is Safari's fallback.
    icon: [
      { url: "/brand/writz-icon.svg?v=3", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon.ico?v=3", sizes: "32x32" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  robots: config.target === "mainnet" ? undefined : { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: "Writz",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    images: [
      {
        url: "/og.png?v=2",
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
    images: ["/og.png?v=2"],
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
