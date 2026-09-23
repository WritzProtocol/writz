import type { Metadata } from "next";
import Script from "next/script";
import { Fraunces, Geist_Mono } from "next/font/google";
import { env } from "@/config/env";
import "./globals.css";

const display = Fraunces({
  variable: "--ff-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const mono = Geist_Mono({
  variable: "--ff-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: "Writz - Bitcoin was built to be yours",
  description:
    "Trustless, ZK-private Bitcoin lending on Stellar. Lock real BTC, borrow USDC, keep every position private.",
  icons: {
    icon: "/brand/writz-mark.png",
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
      className={`${display.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID && (
          <Script
            src="https://cloud.umami.is/script.js"
            data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
            strategy="afterInteractive"
          />
        )}
        {children}
      </body>
    </html>
  );
}
