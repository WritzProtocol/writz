import { entryId, type InsertCommitmentPayload, type OutboxEntry, type OutboxStore, type UpdateLeafPayload } from "./outboxStore";

/**
 * The relayer outbox (#267): every `/insert-commitment` and `/update-leaf` call
 * the app owes the relayer is written down before the on-chain transaction is
 * submitted, sent once that transaction is confirmed, and retried until the
 * relayer accepts it or the chain shows it applied. A closed tab, a network
 * error or a relayer restart delays the call; it never loses it.
 */

/** First retry delay; each failure doubles it, up to `MAX_BACKOFF_MS`. */
export const RETRY_BASE_MS = 30_000;
export const MAX_BACKOFF_MS = 5 * 60_000;
/** Failures after which the app shows a persistent notice with a manual retry. */
export const NOTICE_AFTER_FAILURES = 10;

export type SendOutcome =
  | { kind: "accepted" }
  /** 409: the relayer's store is behind the chain. Retried once its watcher catches up. */
  | { kind: "behind"; error: string }
  | { kind: "failed"; error: string };

export interface OutboxDeps {
  store: OutboxStore;
  /** Posts the entry to the relayer. */
  send(entry: OutboxEntry): Promise<SendOutcome>;
  /** True when the chain already shows the call applied, so there is nothing left to send. */
  isApplied(entry: OutboxEntry): Promise<boolean>;
  now?: () => number;
}

export type OutboxInput =
  | { kind: "insert-commitment"; payload: InsertCommitmentPayload }
  | { kind: "update-leaf"; payload: UpdateLeafPayload };

export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

export function isStuck(entry: OutboxEntry): boolean {
  return entry.attempts >= NOTICE_AFTER_FAILURES;
}

function commitmentOf(input: OutboxInput): string {
  return input.kind === "insert-commitment" ? input.payload.commitment : input.payload.newCommitment;
}

/** Writes the entry, not yet sendable, before the on-chain transaction is submitted. */
export async function enqueue(store: OutboxStore, owner: string, input: OutboxInput, now = Date.now()): Promise<OutboxEntry> {
  const commitment = commitmentOf(input);
  const entry = {
    ...input,
    id: entryId(input.kind, commitment),
    commitment,
    createdAt: now,
    attempts: 0,
    nextAttemptAt: now,
    state: "pending",
  } as OutboxEntry;
  await store.put(owner, entry);
  return entry;
}

/** The transaction is confirmed: the entry may be sent from now on. */
export async function markReady(store: OutboxStore, owner: string, id: string, now = Date.now()): Promise<void> {
  const entry = (await store.list(owner)).find((e) => e.id === id);
  if (!entry) return;
  await store.put(owner, { ...entry, state: "ready", nextAttemptAt: now });
}

/** The transaction did not land: there is nothing to tell the relayer. */
export async function discard(store: OutboxStore, owner: string, id: string): Promise<void> {
  await store.remove(owner, id);
}

export interface OutboxRun {
  /** Entries removed because the relayer accepted them or the chain showed them applied. */
  done: string[];
  /** Entries still owed after this run. */
  remaining: OutboxEntry[];
}

/**
 * Sends every ready entry that is due. `force` ignores the backoff, for a
 * manual retry. Pending entries are never sent.
 */
export async function processOutbox(owner: string, deps: OutboxDeps, opts: { force?: boolean } = {}): Promise<OutboxRun> {
  const now = (deps.now ?? Date.now)();
  const done: string[] = [];
  const remaining: OutboxEntry[] = [];

  for (const entry of await deps.store.list(owner)) {
    if (entry.state !== "ready" || (!opts.force && entry.nextAttemptAt > now)) {
      remaining.push(entry);
      continue;
    }

    // A call the chain already shows applied (the relayer handled it, or its
    // watcher applied the event) has nothing left to send.
    const applied = await deps.isApplied(entry).catch(() => false);
    const outcome: SendOutcome = applied
      ? { kind: "accepted" }
      : await deps.send(entry).catch((e: unknown) => ({ kind: "failed" as const, error: String(e) }));

    if (outcome.kind === "accepted") {
      await deps.store.remove(owner, entry.id);
      done.push(entry.id);
      continue;
    }

    const attempts = entry.attempts + 1;
    const next: OutboxEntry = { ...entry, attempts, lastError: outcome.error, nextAttemptAt: now + backoffMs(attempts) };
    await deps.store.put(owner, next);
    remaining.push(next);
  }

  return { done, remaining };
}

/**
 * Records the relayer call before `submit` runs the on-chain transaction,
 * marks it ready once `submit` resolves (the transaction is confirmed), and
 * sends it. If `submit` throws, the transaction did not land and the entry is
 * dropped. Returns `submit`'s result; the relayer call never fails the flow.
 */
export async function trackRelayerCall<T>(params: {
  owner: string;
  input: OutboxInput;
  submit: () => Promise<T>;
  deps: OutboxDeps;
}): Promise<T> {
  const { owner, input, submit, deps } = params;
  const now = deps.now ?? Date.now;
  const entry = await enqueue(deps.store, owner, input, now());
  let result: T;
  try {
    result = await submit();
  } catch (e) {
    await discard(deps.store, owner, entry.id);
    throw e;
  }
  await markReady(deps.store, owner, entry.id, now());
  // A failure here leaves the entry queued for the next run.
  await processOutbox(owner, deps).catch(() => undefined);
  return result;
}
