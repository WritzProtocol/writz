import { APP_ROUTE, DOCS_URL } from "../constants";
import type { ProductPlan, ProtocolRole } from "../types/products.types";

export const productPlans: ProductPlan[] = [
  {
    name: "PrivateLend",
    description: "Deposit BTC, borrow USDC privately",
    stat: "150%",
    statLabel: "min collateral ratio",
    features: [
      "Real BTC collateral",
      "ZK-private positions",
      "Borrow USDC on Stellar",
      "Emergency timelock exit",
      "Live on testnet",
    ],
    cta: "Launch App",
    ctaHref: APP_ROUTE,
    highlighted: true,
    badge: "Live Now",
    roles: ["borrower"],
  },
  {
    name: "Lender Vault",
    description: "Supply USDC, earn yield from real loans",
    stat: "APY",
    statLabel: "from borrower interest",
    features: ["Supply USDC", "Withdraw anytime", "Pool transparency on-chain", "Yield from real loans"],
    cta: "Supply USDC",
    ctaHref: APP_ROUTE,
    highlighted: true,
    roles: ["lender"],
  },
  {
    name: "Coming Next",
    description: "The Writz roadmap",
    stat: "2027",
    statLabel: "roadmap",
    features: [
      "Dark Swap - private BTC → USDC",
      "BTC Savings - auto-routed yield",
      "ZK Proof of Reserve (B2B)",
    ],
    cta: "Read the Roadmap",
    ctaHref: `${DOCS_URL}/docs/roadmap/vision`,
    highlighted: false,
    roles: ["borrower", "lender"],
  },
];

export function plansForRole(role: ProtocolRole): ProductPlan[] {
  return productPlans.filter((plan) => plan.roles.includes(role));
}

export const roleTaglines: Record<ProtocolRole, string> = {
  borrower: "Lock real BTC, borrow USDC, keep the position private. More products as the protocol scales.",
  lender: "Supply USDC to the pool and earn from over-collateralized BTC borrow demand.",
};
