/**
 * One transaction at a time per Stellar source account.
 *
 * A Soroban submission reads the account's sequence number when it is built
 * and only consumes it once the transaction lands. Two submitters that build
 * from the same account in that window sign the same sequence number, and
 * only one of them can ever be applied. Stellar Core also lets the second one
 * replace the first in its queue when it bids at least ten times the
 * inclusion fee, so the loser is dropped without any error: it stays
 * NOT_FOUND until the sender gives up.
 *
 * That is what delayed a release on testnet on 2026-10-25: the repay
 * watcher's `publish_release_psbt` (100 stroop inclusion bid) was pending
 * with sequence ...961 when the header sync built `submit_headers` from the
 * same sequence with a 1,000,000 stroop bid. The header batch landed in
 * ledger 5384349, the publish was evicted, and the release was only
 * published on the watcher's next poll, about five minutes later.
 *
 * Every submitter wraps the whole build, sign, send and confirm sequence in
 * `withAccountLock(<source account>, ...)`, so a second transaction from the
 * same account is only built once the first has landed or expired. Different
 * accounts do not wait for each other. This serializes within one relayer
 * process, which is how the relayer is deployed (a single instance).
 */
const queues = new Map<string, Promise<unknown>>();

export function withAccountLock<T>(account: string, task: () => Promise<T> | T): Promise<T> {
  const previous = queues.get(account) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => undefined);
  queues.set(account, settled);
  // Forget the account once nothing else is queued behind this task.
  void settled.then(() => {
    if (queues.get(account) === settled) queues.delete(account);
  });
  return run;
}
