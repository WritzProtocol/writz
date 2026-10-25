/**
 * The onboarding funnel, app side. Each step a person reaches is remembered
 * in this browser (the guide reads it to tick its checklist) and reported
 * once to the relayer's POST /metrics/onboarding/events, which stores a keyed
 * hash of the Stellar address and counts. Loan steps carry the deposit txid
 * so the relayer can check them on writz-lend. Nothing else is sent: no
 * email, no Pollar id, no Bitcoin key.
 *
 * Reporting never blocks or fails a flow: errors are swallowed, and a step
 * that could not be sent is tried again the next time it is reported.
 */

export type FunnelStep = "sign_in" | "key_created" | "deposit" | "borrow" | "repay" | "release";
export type Channel = "social" | "wallet";
const CHAIN_STEPS = new Set<FunnelStep>(["deposit", "borrow", "repay", "release"]);

export type Milestones = Partial<Record<FunnelStep, number>>;

export interface FunnelStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FunnelDeps {
  relayerUrl: string;
  storage: FunnelStorage | null;
  fetch?: typeof fetch;
  now?: () => number;
}

const MILESTONES = "writz:onboarding:";
const SENT = "writz:funnel-sent:";

function read<T>(storage: FunnelStorage | null, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(storage: FunnelStorage | null, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the funnel still reports, the checklist starts over next visit.
  }
}

const listeners = new Set<() => void>();
const cache = new Map<string, Milestones>();

/** The steps this browser saw for `address`, with when. */
export function milestones(address: string, storage: FunnelStorage | null): Milestones {
  const hit = cache.get(address);
  if (hit) return hit;
  const value = read<Milestones>(storage, MILESTONES + address, {});
  cache.set(address, value);
  return value;
}

export function subscribeMilestones(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Remembers that `address` reached `step` (the first time only). */
export function markMilestone(address: string, step: FunnelStep, storage: FunnelStorage | null, now = Date.now()): void {
  const current = milestones(address, storage);
  if (current[step]) return;
  const next = { ...current, [step]: now };
  cache.set(address, next);
  write(storage, MILESTONES + address, next);
  for (const l of listeners) l();
}

/**
 * Marks the step locally and reports it to the relayer once. Resolves to
 * true when the relayer has it (now or before), false when it is to be tried
 * again later. Never throws.
 */
export async function reportStep(
  step: FunnelStep,
  event: { stellarAddress: string; channel: Channel; txid?: string },
  deps: FunnelDeps,
): Promise<boolean> {
  const { stellarAddress, channel, txid } = event;
  markMilestone(stellarAddress, step, deps.storage, deps.now?.() ?? Date.now());
  if (!deps.relayerUrl) return false;
  if (CHAIN_STEPS.has(step) && !txid) return false;

  const sentKey = SENT + stellarAddress;
  const sent = read<string[]>(deps.storage, sentKey, []);
  if (sent.includes(step)) return true;

  try {
    const res = await (deps.fetch ?? fetch)(`${deps.relayerUrl.replace(/\/+$/, "")}/metrics/onboarding/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step, stellarAddress, channel, ...(txid ? { txid } : {}) }),
      keepalive: true,
    });
    // Most 4xx will not change on retry (a malformed event, a loan of another
    // address): stop sending them. 422 means the chain does not show the step
    // yet, and 429 and 5xx are transient: those are tried again later.
    const done = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429 && res.status !== 422);
    if (done) write(deps.storage, sentKey, [...read<string[]>(deps.storage, sentKey, []), step]);
    return res.ok;
  } catch {
    return false;
  }
}

/** Forgets the cached milestones (tests). */
export function resetFunnelCache(): void {
  cache.clear();
}
