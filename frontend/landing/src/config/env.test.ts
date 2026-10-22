import { describe, expect, test } from "bun:test";
import { readUrl } from "./env";

describe("readUrl", () => {
  test("falls back when unset or empty", () => {
    expect(readUrl("X", undefined, "https://writz.xyz")).toBe("https://writz.xyz");
    expect(readUrl("X", "", "https://testnet.writz.xyz")).toBe("https://testnet.writz.xyz");
  });

  test("strips the trailing slash", () => {
    expect(readUrl("X", "https://app.writz.xyz/", "https://writz.xyz")).toBe("https://app.writz.xyz");
  });

  test("names the variable when the value is not a URL", () => {
    expect(() => readUrl("NEXT_PUBLIC_APP_URL", "not a url", "https://writz.xyz")).toThrow(
      /NEXT_PUBLIC_APP_URL/,
    );
  });
});
