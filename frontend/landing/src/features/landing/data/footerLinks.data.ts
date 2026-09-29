import type { FooterLinkGroup } from "../types/footer.types";
import { APP_ROUTE, DOCS_URL, GITHUB_URL } from "../constants";

export const X_URL = "https://x.com/WritzProtocol";

export const footerLinkGroups: FooterLinkGroup[] = [
  {
    title: "Product",
    links: [
      { label: "Open app", href: APP_ROUTE },
      { label: "Borrow", href: `${DOCS_URL}/products/privatelend` },
      { label: "Earn", href: `${DOCS_URL}/products/earn` },
      { label: "Metrics", href: `${APP_ROUTE}/metrics` },
    ],
  },
  {
    title: "Learn",
    links: [
      { label: "Docs", href: DOCS_URL },
      { label: "How it works", href: `${DOCS_URL}/introduction/how-writz-works` },
      { label: "Security model", href: `${DOCS_URL}/security/security-model` },
      { label: "Brand assets", href: "/brand" },
    ],
  },
  {
    title: "Community",
    links: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "X", href: X_URL },
    ],
  },
];
