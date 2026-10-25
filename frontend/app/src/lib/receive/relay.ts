import { config } from "@/config";

/** Where a Base Sepolia transfer stands at the Writz CCTP relay that completes the mint. */
export type Delivery =
  | { kind: "pending" }
  | { kind: "arrived"; mintHash: string | null }
  | { kind: "failed"; reason: string };

const HASH = /^0x[0-9a-fA-F]{64}$/;

/** The relay's view of a transfer (`sent`, `confirming`, `confirmed`, `arrived`, `failed`), or null when it is not one. */
export function parseRelayView(body: unknown): Delivery | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { kind?: unknown; mintHash?: unknown; reason?: unknown };
  switch (b.kind) {
    case "sent":
    case "confirming":
    case "confirmed":
      return { kind: "pending" };
    case "arrived":
      return { kind: "arrived", mintHash: typeof b.mintHash === "string" && HASH.test(b.mintHash) ? b.mintHash : null };
    case "failed":
      return { kind: "failed", reason: typeof b.reason === "string" ? b.reason : "the relay stopped" };
    default:
      return null;
  }
}

const relayUrl = (path: string) => {
  const base = config.receive.cctp.relayUrl;
  if (!base) throw new Error("No relay is configured for Base Sepolia transfers.");
  return `${base}/cctp/relay${path}`;
};

async function read(res: Response): Promise<Delivery> {
  const body = await res.json().catch(() => null);
  if (!res.ok && res.status !== 202) throw new Error((body as { message?: string } | null)?.message ?? `The relay answered ${res.status}.`);
  const d = parseRelayView(body);
  if (!d) throw new Error("The relay answered something unexpected.");
  return d;
}

/** Asks the relay to complete a Stellar burn on Base Sepolia; it keeps working on it on its own. */
export async function startDelivery(burnHash: string, get: typeof fetch = fetch): Promise<Delivery> {
  return read(
    await get(relayUrl(""), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ burnHash }) }),
  );
}

/** Where a transfer the relay was asked about stands. */
export async function deliveryOf(burnHash: string, get: typeof fetch = fetch): Promise<Delivery> {
  return read(await get(relayUrl(`/${burnHash}`)));
}
