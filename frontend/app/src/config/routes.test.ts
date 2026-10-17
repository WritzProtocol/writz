import { describe, expect, it } from "bun:test";
import { LENDING_PATHS, routeFor } from "./routes";

describe("routeFor", () => {
  it("serves everything when lending is enabled", () => {
    for (const p of ["/", "/borrow/new", "/loans/3", "/lend", "/api/cosign", "/earn"]) {
      expect(routeFor(p, true)).toEqual({ kind: "next" });
    }
  });

  it("sends home to Earn on an Earn-only deploy", () => {
    expect(routeFor("/", false)).toEqual({ kind: "redirect", to: "/earn" });
  });

  it("closes every lending path and anything under it", () => {
    for (const base of LENDING_PATHS) {
      expect(routeFor(base, false)).toEqual({ kind: "not-found" });
      expect(routeFor(`${base}/x`, false)).toEqual({ kind: "not-found" });
    }
    expect(routeFor("/loans/12", false)).toEqual({ kind: "not-found" });
    expect(routeFor("/api/cosign", false)).toEqual({ kind: "not-found" });
  });

  it("leaves Earn, Protocol and lookalike paths alone", () => {
    for (const p of ["/earn", "/protocol", "/lending", "/loansx", "/borrowed", "/help"]) {
      expect(routeFor(p, false)).toEqual({ kind: "next" });
    }
  });
});
