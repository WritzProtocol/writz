import { config } from "@/config";

/**
 * Earn's wording per deploy. Testnet runs on Blend's test USDC, a different
 * asset from the lending pool's; mainnet runs on Circle's USDC with real
 * funds, so none of the testnet caveats apply and the risk notes must not
 * read as a test.
 */
export interface EarnCopy {
  title: string;
  unit: string;
  lede: string;
  risk: [string, string];
  noFunds: string;
  /** Shown when the connected account cannot pay fees yet. */
  unfunded: string;
}

const TESTNET: EarnCopy = {
  title: "DeFindex vault",
  unit: "USDC (Blend)",
  lede: "Earns from Blend lending through DeFindex, separate from the Writz lending pool. Deposit Blend test USDC; the vault shares sit in your own wallet.",
  risk: ["Blend test USDC is a different asset from the USDC you borrow.", "The vault carries Blend's lending risk."],
  noFunds: "You have no Blend test USDC.",
  unfunded: "This account has no test XLM yet, so it can't pay network fees. Fund it from the Wallets menu.",
};

const MAINNET: EarnCopy = {
  title: "Earn on USDC",
  unit: "USDC",
  lede: "Deposit USDC into the Writz vault on DeFindex. It earns from Blend lending. Shares sit in your own wallet, and you can withdraw at any time.",
  risk: [
    "Your USDC is lent out through Blend. That carries smart-contract and lending risk, and deposits are not insured.",
    "The yield changes with Blend's borrowing demand and is not guaranteed.",
  ],
  noFunds: "You have no USDC in this wallet.",
  unfunded: "This account has no XLM yet, so it can't pay network fees. Send XLM to it from an exchange or another wallet first.",
};

export const EARN_COPY: EarnCopy = config.target === "mainnet" ? MAINNET : TESTNET;
