import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Work_Sans, Geist_Mono } from "next/font/google";
import { config } from "@/config";
import { Providers } from "@/app/Providers";
import { WalletProvider } from "@/lib/wallet/WalletProvider";
import { BitcoinWalletProvider } from "@/lib/bitcoin/useBitcoinWallet";
import { env } from "@/config/env";
import "../../../../packages/brand/tokens.css";
import "./globals.css";

const sans = Work_Sans({
  variable: "--ff-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// The generated fallback is Arial, whose digits run wider than Geist Mono's, so
// big figures wrapped until the font arrived; tokens.css defines a monospace one.
const mono = Geist_Mono({
  variable: "--ff-mono",
  subsets: ["latin"],
  adjustFontFallback: false,
  fallback: ["Geist Mono Fallback", "ui-monospace", "monospace"],
});

const TITLE = "Writz - Lock Bitcoin. Borrow dollars.";

// The published social bio, plus the network status any description of the
// product has to carry.
const DESCRIPTION =
  "Lock real BTC. Borrow USDC on Stellar. No bridge, no custodian, no wrapped token. Live on Stellar testnet.";

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#0C0E12",
  colorScheme: "dark",
};

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
      { url: "/brand/writz-icon.svg?v=5", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon.ico?v=4", sizes: "32x32" },
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
        url: "/og.png?v=3",
        width: 2400,
        height: 1260,
        alt: "Writz. Lock Bitcoin. Borrow dollars. Tell no one. No bridge, no custodian, no wrapped token.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@WritzProtocol",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png?v=3"],
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
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
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
