"use client";

import { createContext, useContext } from "react";
import type { SigningReviews } from "./signingReview";

/** The signing checks of the connected wallet; provided by `WalletProvider`, kept apart so components can read it without loading the wallets. */
export const ReviewsContext = createContext<SigningReviews | null>(null);

/** The signing check waiting for the user, for `SigningCheck`; null outside a `WalletProvider`. */
export function useSigningReviews(): SigningReviews | null {
  return useContext(ReviewsContext);
}
