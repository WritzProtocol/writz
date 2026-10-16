/** When each element first entered on the current visit to a route; a new route starts over. */
export function createEntranceClock() {
  let route: string | null = null;
  const started = new Map<string, number>();
  /** Milliseconds since `key` first entered on this visit to `path`; 0 the first time. */
  return function claim(path: string, key: string, now: number): number {
    if (route !== path) {
      route = path;
      started.clear();
    }
    const at = started.get(key);
    if (at === undefined) {
      started.set(key, now);
      return 0;
    }
    return now - at;
  };
}
