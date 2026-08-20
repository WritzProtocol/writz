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

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: "Writz - Bitcoin was built to be yours",
  description:
    "Trustless, ZK-private Bitcoin lending on Stellar. Lock real BTC, borrow USDC, keep every position private.",
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
