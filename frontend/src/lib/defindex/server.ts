import {
  DefindexSDK,
  SupportedNetworks,
  type VaultApyResponse,
  type VaultBalanceResponse,
  type VaultInfoResponse,
} from "@defindex/sdk";
import type {
  DefindexBalanceSummary,
  DefindexHealth,
  DefindexSummaryResponse,
  DefindexVaultSummary,
} from "./types";

type DefindexNetwork = (typeof SupportedNetworks)[keyof typeof SupportedNetworks];

const DEFAULT_BASE_URL = "https://api.defindex.io";

function readString(
  value: unknown,
  fallback: string | null = null,
): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return fallback;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, sanitize(nested)]),
    );
  }
  return value;
}

function getNetworkName(): "TESTNET" | "MAINNET" {
  return process.env.DEFINDEX_NETWORK?.toUpperCase() === "MAINNET"
    ? "MAINNET"
    : "TESTNET";
}

export function getDefindexNetwork(): DefindexNetwork {
  return getNetworkName() === "MAINNET"
    ? SupportedNetworks.MAINNET
    : SupportedNetworks.TESTNET;
}

export function getDefindexBaseUrl(): string {
  return process.env.DEFINDEX_API_URL || DEFAULT_BASE_URL;
}

export function getDefindexVaultAddress(): string {
  return process.env.NEXT_PUBLIC_DEFINDEX_VAULT_ADDRESS ?? "";
}

export function hasDefindexApiKey(): boolean {
  return Boolean(process.env.DEFINDEX_API_KEY);
}

function readObjectMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return (
    readString(record.message) ??
    readString(record.error) ??
    (record.response && typeof record.response === "object"
      ? readObjectMessage(record.response)
      : null)
  );
}

function readStatusCode(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return (
    readNumber(record.statusCode) ??
    readNumber(record.status) ??
    (record.response && typeof record.response === "object"
      ? readStatusCode(record.response)
      : null)
  );
}

function isHttpErrorStatus(value: number): boolean {
  return Number.isInteger(value) && value >= 400 && value <= 599;
}

function readRawError(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return (
    readString(record.error) ??
    (record.response && typeof record.response === "object"
      ? readRawError(record.response)
      : null)
  );
}

function readMissingContractFunction(value: unknown): string | null {
  const raw = readRawError(value);
  if (!raw) return null;

  const match = raw.match(/trying to invoke non-existent contract function\", ([a-zA-Z0-9_]+)/);
  return match?.[1] ?? null;
}

export function extractDefindexError(
  error: unknown,
  fallback: string,
): string {
  const missingFunction = readMissingContractFunction(error);
  if (missingFunction) {
    return `The configured DeFindex vault contract is not compatible with this SDK: missing \`${missingFunction}\` method. Check that NEXT_PUBLIC_DEFINDEX_VAULT_ADDRESS points to a supported vault contract.`;
  }

  const message = readObjectMessage(error);
  const statusCode = readStatusCode(error);

  if (message && statusCode) {
    return `${message} (status ${statusCode})`;
  }
  if (message) return message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function extractDefindexStatus(
  error: unknown,
  fallback = 502,
): number {
  const statusCode = readStatusCode(error);
  if (statusCode !== null && isHttpErrorStatus(statusCode)) {
    return statusCode;
  }

  const message = extractDefindexError(error, "");
  if (/(TokenErrors\.)?MissingTrustline|op_no_trust/i.test(message)) {
    return 400;
  }

  return fallback;
}

export function readDefindexNetworkWarning(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const indexer = (payload as { indexer?: unknown }).indexer;
  if (!indexer || typeof indexer !== "object") return null;

  const key = getNetworkName().toLowerCase();
  const network = (indexer as Record<string, unknown>)[key];
  if (!network || typeof network !== "object") return null;

  const database = (network as { database?: unknown }).database;
  if (!database || typeof database !== "object") return null;

  const configured = Boolean((database as { configured?: unknown }).configured);
  const healthy = Boolean((database as { healthy?: unknown }).healthy);

  if (configured && healthy) return null;

  return `DeFindex ${getNetworkName().toLowerCase()} indexer is not fully healthy/configured right now; vault reads may fail.`;
}

export function createDefindexSdk(): DefindexSDK {
  const apiKey = process.env.DEFINDEX_API_KEY;
  if (!apiKey) {
    throw new Error("DEFINDEX_API_KEY is not configured");
  }

  return new DefindexSDK({
    apiKey,
    baseUrl: getDefindexBaseUrl(),
  });
}

function countAssets(vaultInfo: unknown): number {
  if (!vaultInfo || typeof vaultInfo !== "object") return 1;
  const assets = (vaultInfo as { assets?: unknown }).assets;
  return Array.isArray(assets) && assets.length > 0 ? assets.length : 1;
}

export function extractHealth(payload: unknown): DefindexHealth | null {
  if (!payload || typeof payload !== "object") return null;
  const status = (payload as { status?: unknown }).status;
  if (!status || typeof status !== "object") return null;
  return {
    reachable: Boolean((status as { reachable?: unknown }).reachable),
  };
}

export function extractVaultSummary(
  vaultAddress: string,
  vaultInfo: VaultInfoResponse,
  apyInfo: VaultApyResponse | null,
): DefindexVaultSummary {
  const primaryAsset = vaultInfo.totalManagedFunds[0];
  return {
    address: vaultAddress,
    name: readString(vaultInfo.name),
    symbol: readString(vaultInfo.symbol),
    totalAssets: readString(primaryAsset?.total_amount ?? null),
    apyPercent: readNumber(apyInfo?.apy ?? vaultInfo.apy),
    assetCount: countAssets(vaultInfo),
  };
}

export function extractBalanceSummary(
  balance: VaultBalanceResponse,
): DefindexBalanceSummary {
  return {
    dfTokens: readString(balance.dfTokens),
  };
}

export function extractXdr(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  return readString((payload as { xdr?: unknown }).xdr);
}

export function extractTxHash(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  return (
    readString(record.hash) ??
    readString(record.txHash) ??
    readString(record.transactionHash) ??
    (record.result && typeof record.result === "object"
      ? readString((record.result as Record<string, unknown>).hash)
      : null)
  );
}

export function parseAmountArray(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("amounts must be a non-empty array");
  }

  return value.map((entry) => {
    if (typeof entry !== "string" && typeof entry !== "number") {
      throw new Error("amounts must contain only strings or numbers");
    }
    const normalized = typeof entry === "number" ? String(entry) : entry.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new Error("amounts must be integer strings");
    }
    const amount = Number(normalized);
    if (!Number.isSafeInteger(amount)) {
      throw new Error("amounts must be safe integers");
    }
    return amount;
  });
}

export function parseShares(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("shares must be a string or number");
  }
  const normalized = typeof value === "number" ? String(value) : value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error("shares must be an integer string");
  }
  const shares = Number(normalized);
  if (!Number.isSafeInteger(shares)) {
    throw new Error("shares must be a safe integer");
  }
  return shares;
}

export function buildUnconfiguredSummary(): DefindexSummaryResponse {
  return {
    configured: false,
    network: getNetworkName(),
    baseUrl: getDefindexBaseUrl(),
    health: null,
    factoryAddress: null,
    vault: null,
    balance: null,
    warning:
      "Set DEFINDEX_API_KEY and NEXT_PUBLIC_DEFINDEX_VAULT_ADDRESS to enable DeFindex.",
    error: null,
  };
}

export function sanitizeDefindexResult(value: unknown): unknown {
  return sanitize(value);
}
