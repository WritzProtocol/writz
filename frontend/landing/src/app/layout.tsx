import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist_Mono } from "next/font/google";
import { env } from "@/config/env";
import { workSans } from "@/features/landing/fonts";
import "./globals.css";

// The generated fallback is Arial, whose digits run wider than Geist Mono's, so
// big figures wrapped until the font arrived; tokens.css defines a monospace one.
const mono = Geist_Mono({
  variable: "--ff-mono",
  subsets: ["latin"],
  adjustFontFallback: false,
  fallback: ["Geist Mono Fallback", "ui-monospace", "monospace"],
});

const TITLE = "Writz - Lock Bitcoin. Borrow dollars. Tell no one.";

// The published social bio, plus the network status any description of the
// product has to carry.
const DESCRIPTION =
  "Lock real BTC. Borrow USDC on Stellar. No bridge, no custodian, no wrapped token. Live on testnet.";

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
    icon: [
      { url: "/brand/writz-icon.svg?v=5", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon.ico?v=4", sizes: "32x32" },
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
      data-scroll-behavior="smooth"
      className={`${workSans.variable} ${mono.variable}`}
    >
      <body>
        {env.umamiWebsiteId && (
          <Script
            src="https://cloud.umami.is/script.js"
            data-website-id={env.umamiWebsiteId}
            strategy="afterInteractive"
          />
        )}
        {children}
      </body>
    </html>
  );
}
