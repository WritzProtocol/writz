import { config } from "@/config";

/** Where a Base Sepolia transfer stands at the Writz CCTP relay that completes the mint. */
export type Delivery =
  /** On its way; with `retrying`, the relay is waiting out a temporary failure and keeps going on its own. */
  | { kind: "pending"; retrying: { reason: string; nextRetryAt: string | null } | null }
  /** Minted. `mintHash` null: done, the relay is still looking up which transaction minted it. */
  | { kind: "arrived"; mintHash: string | null }
  /** Final. `retryable`: a new request starts it over (Circle never reported it, or 24 hours of retrying). */
  | { kind: "failed"; reason: string; retryable: boolean }
  /** The relay is not running on this deployment, so delivery waits for it. */
  | { kind: "disabled"; reason: string };

const HASH = /^0x[0-9a-fA-F]{64}$/;

/** The relay's view of a transfer (`sent`, `confirming`, `confirmed`, `arrived`, `failed`), or null when it is not one. */
export function parseRelayView(body: unknown): Delivery | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { kind?: unknown; mintHash?: unknown; reason?: unknown; retrying?: unknown; nextRetryAt?: unknown; retryable?: unknown };
  const reason = typeof b.reason === "string" ? b.reason : null;
  switch (b.kind) {
    case "sent":
    case "confirming":
    case "confirmed":
      return {
        kind: "pending",
        retrying:
          b.retrying === true
            ? { reason: reason ?? "the relay is retrying", nextRetryAt: typeof b.nextRetryAt === "string" ? b.nextRetryAt : null }
            : null,
      };
    case "arrived":
      return { kind: "arrived", mintHash: typeof b.mintHash === "string" && HASH.test(b.mintHash) ? b.mintHash : null };
    case "failed":
      return { kind: "failed", reason: reason ?? "the relay stopped", retryable: b.retryable === true };
    default:
      return null;
  }
}

/** While on its way: often. Arrived without its link: every ~30 s until the relay names the transaction. */
export const RELAY_POLL_MS = 5_000;
export const MINT_LOOKUP_POLL_MS = 30_000;

/** How long to wait before reading the transfer again, or null when there is nothing left to wait for. */
export function nextRelayPoll(d: Delivery | null): number | null {
  if (d === null) return RELAY_POLL_MS;
  switch (d.kind) {
    case "pending":
      return RELAY_POLL_MS;
    case "arrived":
      return d.mintHash ? null : MINT_LOOKUP_POLL_MS;
    default:
      return null;
  }
}

const relayUrl = (path: string) => {
  const base = config.receive.cctp.relayUrl;
  if (!base) throw new Error("No relay is configured for Base Sepolia transfers.");
  return `${base}/cctp/relay${path}`;
};

/** A relay answer as a `Delivery`; 202 is "still working", 503 `cctp_relay_disabled` is a relay that is off. */
export async function readRelayResponse(res: Response): Promise<Delivery> {
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (res.status === 503 && body?.error === "cctp_relay_disabled") {
    return { kind: "disabled", reason: body.message ?? "the relay is not available" };
  }
  if (!res.ok) throw new Error(body?.message ?? `The relay answered ${res.status}.`);
  const d = parseRelayView(body);
  if (!d) throw new Error("The relay answered something unexpected.");
  return d;
}

/** Asks the relay to complete a Stellar burn on Base Sepolia (or to start a retryable failure over); it keeps working on its own. */
export async function startDelivery(burnHash: string, get: typeof fetch = fetch): Promise<Delivery> {
  return readRelayResponse(
    await get(relayUrl(""), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ burnHash }) }),
  );
}

/** Where a transfer the relay was asked about stands. */
export async function deliveryOf(burnHash: string, get: typeof fetch = fetch): Promise<Delivery> {
  return readRelayResponse(await get(relayUrl(`/${burnHash}`)));
}
