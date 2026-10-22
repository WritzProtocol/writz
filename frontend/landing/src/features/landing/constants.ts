import { env } from "@/config/env";

/** The Writz dApp. It is a separate deployment, so this is an absolute URL. */
export const APP_ROUTE = env.appUrl;

/** Public Mintlify docs. Lives on its own subdomain, so always link it absolutely. */
export const DOCS_URL = "https://docs.writz.xyz";

/** Public source repository. */
export const GITHUB_URL = "https://github.com/WritzProtocol/writz";
