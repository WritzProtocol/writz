export type ProtocolRole = "borrower" | "lender";

export interface ProductPlan {
  name: string;
  description: string;
  stat: string;
  statLabel: string;
  features: string[];
  cta: string;
  /** When set, the CTA navigates here instead of rendering an inert button. */
  ctaHref?: string;
  highlighted: boolean;
  badge?: string;
  /** Roles this plan is shown for. Listing both keeps it visible on either side of the toggle. */
  roles: ProtocolRole[];
}
