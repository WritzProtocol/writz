/**
 * Client for the relayer's DeFindex routes.
 *
 * This file is the contract between the Earn frontend (#109, #110, #111) and
 * the relayer endpoints (#103, #104, #105). The frontend never talks to
 * `api.defindex.io` directly: the DeFindex API key is server-side only, so
 * every read and every transaction build goes through our relayer.
 *
 * Custody model (epic #101): the relayer builds unsigned transactions and
 * never signs or submits. The connected wallet signs, and the browser submits
 * to Soroban RPC. The user holds their own dfTokens.
 *
 * Wire conventions, so both sides agree:
 *   - Amounts are USDC stroops (7 decimals) as decimal STRINGS, never JSON
 *     numbers. A stroop amount above 2^53 silently loses precision as a
 *     double, and USDC totals get there. Parsed to `bigint` here.
 *   - APY is a JSON number, a fraction (0.0731 = 7.31%), matching DeFindex's
 *     own `{ apy }` shape.
 *   - Errors are `{ error: string }` with a non-2xx status. When the failure
 *     comes from the vault contract, `error` carries the DeFindex
 *     `ContractError` variant NAME (not its numeric code) so `humanizeError`
 *     can match on it.
 *
 * Until #103 to #105 land, `NEXT_PUBLIC_EARN_MOCK=1` swaps in an in-memory
 * mock so this UI is buildable and reviewable. The mock never produces a real
 * transaction and is never valid as Instaward evidence.
 */

import { config } from "@/config";

/** A vault deposit/withdraw transaction, built but not signed. */
export interface UnsignedTx {
  /** Base64 transaction envelope XDR, source account = `caller`. */
  xdr: string;
}

/** The signed-in user's position in the vault. */
export interface VaultPosition {
  /** Vault share tokens held by the user. */
  dfTokens: bigint;
  /** What those shares are currently worth, in USDC stroops. */
  underlyingStroops: bigint;
}

export interface EarnApi {
  /** Current vault APY as a fraction (0.0731 = 7.31%). */
  getApy(): Promise<number>;
  /** The user's dfToken shares and their USDC value. */
  getPosition(address: string): Promise<VaultPosition>;
  /** Build an unsigned deposit of `amountStroops` USDC by `caller`. */
  buildDeposit(params: { caller: string; amountStroops: bigint }): Promise<UnsignedTx>;
  /** Build an unsigned withdrawal of `amountStroops` USDC to `caller`. */
  buildWithdraw(params: { caller: string; amountStroops: bigint }): Promise<UnsignedTx>;
}

function relayerBase(): string {
  const url = config.services.relayerUrl;
  if (!url) throw new Error("NEXT_PUBLIC_RELAYER_URL is not configured");
  return url.replace(/\/$/, "");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${relayerBase()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error("Relayer unreachable");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Relayer error ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * The real client. Route shapes, for #103 to #105:
 *
 *   GET  /defindex/apy                        -> { apy: number }
 *   GET  /defindex/position?address=<G...>    -> { dfTokens: string, underlyingStroops: string }
 *   POST /defindex/deposit                    { caller, amountStroops } -> { xdr: string }
 *   POST /defindex/withdraw                   { caller, amountStroops } -> { xdr: string }
 *
 * The vault address is relayer-side config (one Writz vault per network), not
 * a parameter. The frontend has no business choosing which vault it deposits
 * into, and leaving it out means a vault redeploy never needs a frontend ship.
 */
const relayerApi: EarnApi = {
  async getApy() {
    const { apy } = await request<{ apy: number }>("/defindex/apy");
    return apy;
  },

  async getPosition(address) {
    const raw = await request<{ dfTokens: string; underlyingStroops: string }>(
      `/defindex/position?address=${encodeURIComponent(address)}`,
    );
    return {
      dfTokens: BigInt(raw.dfTokens),
      underlyingStroops: BigInt(raw.underlyingStroops),
    };
  },

  async buildDeposit({ caller, amountStroops }) {
    return request<UnsignedTx>("/defindex/deposit", {
      method: "POST",
      body: JSON.stringify({ caller, amountStroops: amountStroops.toString() }),
    });
  },

  async buildWithdraw({ caller, amountStroops }) {
    return request<UnsignedTx>("/defindex/withdraw", {
      method: "POST",
      body: JSON.stringify({ caller, amountStroops: amountStroops.toString() }),
    });
  },
};

// ── Mock ───────────────────────────────────────────────────────────────────
// In-memory, per-tab, wiped on reload. Exists only so the Earn UI can be built
// and reviewed before the relayer routes exist. `MOCK_XDR_SENTINEL` is what
// tells the flow layer to skip signing and submission entirely - the string is
// not a valid envelope and must never reach a wallet or Soroban RPC.

export const MOCK_XDR_SENTINEL = "mock:unsigned-tx";

const mockPositions = new Map<string, VaultPosition>();
const mockPending = new Map<string, bigint>();

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const mockApi: EarnApi = {
  async getApy() {
    await delay(200);
    return 0.0731;
  },

  async getPosition(address) {
    await delay(200);
    return mockPositions.get(address) ?? { dfTokens: 0n, underlyingStroops: 0n };
  },

  async buildDeposit({ caller, amountStroops }) {
    await delay(400);
    mockPending.set(caller, amountStroops);
    return { xdr: MOCK_XDR_SENTINEL };
  },

  async buildWithdraw({ caller, amountStroops }) {
    await delay(400);
    mockPending.set(caller, -amountStroops);
    return { xdr: MOCK_XDR_SENTINEL };
  },
};

/**
 * Apply a mock transaction that the flow layer "submitted". Shares are minted
 * 1:1 with the underlying, which is wrong for a real vault and deliberately
 * so: nothing about the mock should look like a plausible source of numbers.
 */
export function settleMockTx(caller: string): void {
  const delta = mockPending.get(caller) ?? 0n;
  mockPending.delete(caller);
  const current = mockPositions.get(caller) ?? { dfTokens: 0n, underlyingStroops: 0n };
  const next = current.underlyingStroops + delta;
  mockPositions.set(caller, {
    dfTokens: next < 0n ? 0n : next,
    underlyingStroops: next < 0n ? 0n : next,
  });
}

/** The active client: the relayer, or the mock when NEXT_PUBLIC_EARN_MOCK=1. */
export function earnApi(): EarnApi {
  return config.earn.mock ? mockApi : relayerApi;
}
