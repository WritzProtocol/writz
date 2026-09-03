/** DeFindex vault ContractError codes -> variant names, from the issue's
 * published table (authoritative source: the ContractError enum in
 * DeFindex's own contract source/docs). frontend/src/lib/errors.ts's
 * humanizeError matches on these exact names, not the numeric codes. */
export const CONTRACT_ERROR_NAMES: Record<number, string> = {
  100: "NotInitialized",
  102: "StrategyDoesNotSupportAsset",
  110: "AmountNotAllowed",
  117: "InsufficientAmount",
  122: "WrongAssetAddress",
  124: "AmountOverTotalSupply",
  130: "Unauthorized",
  141: "StrategyPausedOrNotFound",
  142: "StrategyWithdrawError",
  143: "StrategyInvestError",
  144: "StrategyPaused",
  160: "InsufficientOutputAmount",
};

interface DefindexApiErrorBody {
  error?: string;
  message?: string;
  networkDetails?: { stellarErrorCode?: string; resultXdr?: string; context?: string };
}

function isDefindexApiErrorBody(err: unknown): err is DefindexApiErrorBody {
  return typeof err === "object" && err !== null && "error" in err;
}

function extractContractErrorCode(body: DefindexApiErrorBody): number | undefined {
  const haystack = [body.networkDetails?.stellarErrorCode, body.networkDetails?.context, body.message]
    .filter((s): s is string => typeof s === "string")
    .join(" ");
  const match = haystack.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

/** Maps a rejected @defindex/sdk call (raw DeFindex API error body, or a
 * network-level throw with no `.response`) to an HTTP status + the exact
 * `{ error }` shape the relayer's routes send the frontend. */
export function mapDefindexError(err: unknown): { status: number; error: string } {
  if (!isDefindexApiErrorBody(err)) {
    return { status: 502, error: "DeFindex API unavailable" };
  }
  switch (err.error) {
    case "ContractError": {
      const code = extractContractErrorCode(err);
      const name = code !== undefined ? CONTRACT_ERROR_NAMES[code] : undefined;
      return { status: 502, error: name ?? err.message ?? "ContractError" };
    }
    case "NotFound":
      return { status: 404, error: err.message ?? "vault not found" };
    case "BadRequest":
    case "ValidationFailed":
      return { status: 400, error: err.message ?? "invalid request to DeFindex" };
    case "Unauthorized":
    case "Forbidden":
    case "TokenExpired":
    case "InvalidCredentials":
      // Our own DEFINDEX_API_KEY, not the caller's fault - never surface
      // this as if it were the contract's own Unauthorized (code 130).
      return { status: 500, error: "DeFindex API authentication failed - check DEFINDEX_API_KEY" };
    case "TooManyRequests":
      return { status: 502, error: "DeFindex API rate limit exceeded" };
    default:
      return { status: 502, error: err.message ?? "DeFindex API unavailable" };
  }
}
