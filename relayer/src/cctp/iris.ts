/**
 * Circle's Iris API, read the same way the app reads it
 * (frontend/app/src/lib/receive/cctp.ts `fetchAttestation`): one GET by the
 * Stellar transaction hash under the Stellar domain.
 */
import { STELLAR_DOMAIN } from "./message.js";

export type IrisLookup =
  /** Iris has no message for this hash (404): not indexed yet, or not a CCTP burn. */
  | { state: "unknown" }
  /** Iris knows the burn and is waiting for Stellar finality. */
  | { state: "pending" }
  | { state: "complete"; message: string; attestation: string };

export class IrisError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "IrisError";
  }
}

export async function fetchIrisMessage(
  irisUrl: string,
  burnHash: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<IrisLookup> {
  const url = `${irisUrl.replace(/\/+$/, "")}/v2/messages/${STELLAR_DOMAIN}?transactionHash=${burnHash.toLowerCase()}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new IrisError(`Iris request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 404) return { state: "unknown" };
  if (!res.ok) throw new IrisError(`Iris answered ${res.status}`, res.status);
  const body = (await res.json()) as { messages?: { status?: string; message?: string; attestation?: string }[] };
  const m = body.messages?.[0];
  if (!m) return { state: "unknown" };
  if (m.status !== "complete" || !m.message || !m.attestation || m.attestation === "PENDING") {
    return { state: "pending" };
  }
  return { state: "complete", message: m.message, attestation: m.attestation };
}
