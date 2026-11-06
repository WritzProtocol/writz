import { describe, expect, test } from "bun:test";
import { scriptLiteral, skeletonScript } from "./hint";

describe("skeletonScript", () => {
  test("a value cannot close the inline script or break the line", () => {
    const literal = scriptLiteral({ x: "</script><script>alert(1)</script> &" });
    expect(literal).not.toContain("<");
    expect(literal).not.toContain(">");
    expect(literal).not.toContain(" ");
    expect(JSON.parse(literal)).toEqual({ x: "</script><script>alert(1)</script> &" });
  });

  test("hints embedded in the script never contain a closing tag", () => {
    expect(skeletonScript({ s: "</script>" })).not.toContain("</script>");
  });
});
