export interface DefindexHealth {
  reachable: boolean;
}

export interface DefindexVaultSummary {
  address: string;
  name: string | null;
  symbol: string | null;
  totalAssets: string | null;
  apyPercent: number | null;
  assetCount: number;
}

export interface DefindexBalanceSummary {
  dfTokens: string | null;
}

export interface DefindexSummaryResponse {
  configured: boolean;
  network: "TESTNET" | "MAINNET";
  baseUrl: string;
  health: DefindexHealth | null;
  factoryAddress: string | null;
  vault: DefindexVaultSummary | null;
  balance: DefindexBalanceSummary | null;
  warning: string | null;
  error: string | null;
}

export interface DefindexActionResponse {
  xdr: string | null;
  hash: string | null;
  result: unknown;
}
