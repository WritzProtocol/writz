import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist_Mono } from "next/font/google";
import { env } from "@/config/env";
import { OG_IMAGE, SITE_NAME } from "@/config/site";
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

const TITLE = "Writz Protocol - Bitcoin Lending on Stellar, No Bridge";

const DESCRIPTION =
  "Writz Protocol lets you lock native BTC on Bitcoin and borrow USDC on Stellar. No bridge, no custodian, no wrapped token. Open source, live on testnet.";

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#0C0E12",
  colorScheme: "dark",
};

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  icons: {
    icon: [
      { url: "/brand/writz-icon.svg?v=5", type: "image/svg+xml", sizes: "any" },
      { url: "/favicon.ico?v=4", sizes: "32x32" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    site: "@WritzProtocol",
    title: TITLE,
    description: DESCRIPTION,
    images: [OG_IMAGE.url],
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
