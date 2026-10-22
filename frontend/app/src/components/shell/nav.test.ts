import { describe, expect, test } from "bun:test";
import { currentNav, navFor } from "./nav";

describe("currentNav", () => {
  test("home and every loan mark Home", () => {
    expect(currentNav("/")).toBe("home");
    expect(currentNav("/loans/1")).toBe("home");
    expect(currentNav("/loans/12")).toBe("home");
  });

  test("the borrow journey marks Borrow", () => {
    expect(currentNav("/borrow/new")).toBe("borrow");
    expect(currentNav("/borrow")).toBe("borrow");
  });

  test("Earn, Lend and Protocol mark themselves", () => {
    expect(currentNav("/earn")).toBe("earn");
    expect(currentNav("/lend")).toBe("lend");
    expect(currentNav("/protocol")).toBe("protocol");
  });

  test("the reclaim help and unknown routes mark nothing", () => {
    expect(currentNav("/help/reclaim")).toBeNull();
    expect(currentNav("/lending")).toBeNull();
    expect(currentNav("/loansx")).toBeNull();
  });
});

describe("navFor", () => {
  test("shows the full nav where lending is enabled", () => {
    expect(navFor(true).map((n) => n.id)).toEqual(["home", "borrow", "earn", "lend"]);
  });

  test("shows Earn alone on an Earn-only deploy", () => {
    expect(navFor(false).map((n) => n.id)).toEqual(["earn"]);
  });
});
