import { APP_ROUTE } from "../constants";
import type { ProductPlan } from "../types/products.types";

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
  },
  {
    name: "Lender Vault",
    description: "Supply USDC, earn yield from real loans",
    stat: "APY",
    statLabel: "from borrower interest",
    features: ["Supply USDC", "Withdraw anytime", "Pool transparency on-chain", "Yield from real loans"],
    cta: "Supply USDC",
    highlighted: false,
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
    highlighted: false,
  },
];
