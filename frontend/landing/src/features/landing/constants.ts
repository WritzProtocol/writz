import { env } from "@/config/env";

/** Route to the actual Writz dApp (wallet connect, on-chain stats, borrow/lend tabs). */
export const APP_ROUTE = env.appUrl;

/** Public Mintlify docs. Lives on its own subdomain, so always link it absolutely. */
export const DOCS_URL = "https://docs.writz.xyz";

/** Public source repository. */
export const GITHUB_URL = "https://github.com/WritzProtocol/writz";
