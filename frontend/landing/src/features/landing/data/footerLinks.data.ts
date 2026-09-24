import type { FooterLink, FooterLinkGroup } from "../types/footer.types";
import { APP_ROUTE, DOCS_URL, GITHUB_URL } from "../constants";

export const footerLinkGroups: FooterLinkGroup[] = [
  {
    title: "Protocol",
    links: [
      { label: "PrivateLend", href: `${DOCS_URL}/products/privatelend` },
      { label: "Earn Metrics", href: `${APP_ROUTE}/metrics` },
      { label: "Lender Vault", href: "#" },
      { label: "SPV SDK", href: `${DOCS_URL}/developers/spv-sdk` },
      { label: "Roadmap", href: `${DOCS_URL}/roadmap/vision` },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Documentation", href: DOCS_URL },
      { label: "Contract Reference", href: `${DOCS_URL}/developers/contract-reference` },
      { label: "Quick Start", href: `${DOCS_URL}/developers/quick-start` },
      { label: "Security Model", href: `${DOCS_URL}/security/security-model` },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "X (Twitter)", href: "#" },
      { label: "Stellar Community Fund", href: "https://communityfund.stellar.org" },
    ],
  },
];

export const footerBottomLinks: FooterLink[] = [
  { label: "GitHub", href: GITHUB_URL },
  { label: "X", href: "#" },
  { label: "Docs", href: DOCS_URL },
];
