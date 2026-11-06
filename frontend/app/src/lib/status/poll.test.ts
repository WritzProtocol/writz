import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { pollWhileVisible } from "./provider";

const listeners = new Set<() => void>();
const doc = { hidden: false, addEventListener: (_: string, f: () => void) => listeners.add(f), removeEventListener: (_: string, f: () => void) => listeners.delete(f) };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  Object.assign(globalThis, { document: doc });
});

afterEach(() => {
  doc.hidden = false;
  listeners.clear();
  delete (globalThis as { document?: unknown }).document;
});

describe("pollWhileVisible", () => {
  test("ticks now and on the interval while visible", async () => {
    let n = 0;
    const stop = pollWhileVisible(() => n++, 10);
    await wait(35);
    stop();
    expect(n).toBeGreaterThanOrEqual(3);
  });

  test("a hidden tab stops polling and catches up when it is shown again", async () => {
    let n = 0;
    const stop = pollWhileVisible(() => n++, 10);
    doc.hidden = true;
    await wait(40);
    expect(n).toBe(1);
    doc.hidden = false;
    listeners.forEach((f) => f());
    expect(n).toBe(2);
    stop();
    expect(listeners.size).toBe(0);
  });
});
