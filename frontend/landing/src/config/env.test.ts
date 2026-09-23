import { describe, expect, test } from "bun:test";

describe("env", () => {
  test("readSiteUrl defaults to writz.xyz when unset", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { env } = await import("./env");
    expect(env.siteUrl).toBe("https://writz.xyz");
  });
});
