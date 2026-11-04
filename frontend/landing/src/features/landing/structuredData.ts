import { env } from "@/config/env";
import { ORGANIZATION_ID, SITE_ALTERNATE_NAME, SITE_NAME, WEBSITE_ID } from "@/config/site";
import { GITHUB_URL } from "./constants";
import { X_URL } from "./data/footerLinks.data";

export const homeJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORGANIZATION_ID,
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAME,
      url: `${env.siteUrl}/`,
      logo: {
        "@type": "ImageObject",
        url: `${env.siteUrl}/icon-512.png`,
        width: 512,
        height: 512,
      },
      description:
        "Writz Protocol is a Bitcoin lending protocol on Stellar. Lock native BTC and borrow USDC, with no bridge, no custodian and no wrapped token.",
      sameAs: ["https://github.com/WritzProtocol", GITHUB_URL, X_URL],
    },
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: `${env.siteUrl}/`,
      name: SITE_NAME,
      alternateName: SITE_ALTERNATE_NAME,
      inLanguage: "en",
      publisher: { "@id": ORGANIZATION_ID },
    },
  ],
};
