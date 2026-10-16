import { describe, expect, test } from "bun:test";
import { createEntranceClock } from "./entranceClock";

describe("entrance clock", () => {
  test("an element plays its entrance the first time it appears on a route", () => {
    const claim = createEntranceClock();
    expect(claim("/", "head", 1000)).toBe(0);
    expect(claim("/", "loan-a", 1500)).toBe(0);
  });

  test("a remount on the same visit continues from where the entrance is, so it never replays", () => {
    const claim = createEntranceClock();
    claim("/loans/1", "risk", 1000);
    expect(claim("/loans/1", "risk", 1400)).toBe(400);
    expect(claim("/loans/1", "risk", 9000)).toBe(8000);
  });

  test("leaving the route and coming back plays it again", () => {
    const claim = createEntranceClock();
    claim("/", "head", 1000);
    claim("/lend", "head", 2000);
    expect(claim("/", "head", 3000)).toBe(0);
  });
});
