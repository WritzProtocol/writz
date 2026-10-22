/**
 * One writer at a time for the leaf store. `/insert-commitment`,
 * `/update-leaf` and the tree watcher all read the leaves, compute a new
 * tree and write it back; interleaving two of them would lose one update.
 */
let queue: Promise<unknown> = Promise.resolve();

export function withTreeLock<T>(task: () => Promise<T> | T): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}
