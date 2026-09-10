import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The relayer sits behind a CDN in production. Express sends an ETag but no
 * cache directives, which leaves caching to whatever is in front, and both
 * failure modes here are silent:
 *
 *   - a cached read serves a balance or APY that is no longer true, with no
 *     error anywhere, which defeats the point of reading them live
 *   - a cached transaction build replays a source account's sequence number,
 *     producing a network rejection that points nowhere near the cache
 *
 * Asserted against the source rather than by booting the app, because the
 * point being protected is *where* the header is declared: globally, ahead of
 * every route, so a route added later inherits it instead of having to
 * remember. A response-level assertion would pass just as happily with the
 * header copied into each handler, which is the arrangement that rots.
 */
describe("cache policy", () => {
  const source = readFileSync(path.join(__dirname, "../src/index.ts"), "utf8");

  it("declares no-store", () => {
    expect(source).toContain('res.setHeader("Cache-Control", "no-store")');
  });

  it("declares it before any route is registered", () => {
    const middleware = source.indexOf('res.setHeader("Cache-Control", "no-store")');
    expect(middleware).toBeGreaterThan(-1);

    const routes = source.match(/^app\.(get|post|use)\(["']\//gm) ?? [];
    expect(routes.length).toBeGreaterThan(0);

    for (const route of routes) {
      expect(source.indexOf(route)).toBeGreaterThan(middleware);
    }
  });
});
