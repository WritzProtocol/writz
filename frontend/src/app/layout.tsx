import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, Geist_Mono } from "next/font/google";
import { WalletProvider } from "@/lib/wallet/WalletProvider";
import "./globals.css";

// Display — luxury editorial serif (used with restraint for wordmark + headings).
const display = Fraunces({
  variable: "--ff-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

// UI / body — precise grotesque.
const body = Hanken_Grotesk({
  variable: "--ff-body",
  subsets: ["latin"],
});

// Data — monospace with tabular figures for on-chain values, hashes, amounts.
const mono = Geist_Mono({
  variable: "--ff-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Writz — Testnet",
  description:
    "Trustless, ZK-private Bitcoin lending on Stellar (Soroban testnet).",
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
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
