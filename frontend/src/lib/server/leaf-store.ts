/**
 * Server-only persistence for the ordered Merkle leaf list.
 *
 * Phase 1 (trusted relay): the admin is the sole writer. Phase 2 will derive
 * the leaf list from on-chain events instead, removing this trusted component.
 *
 * Import ONLY from API routes — never from client components or lib/flows/*.
 */
import fs from "fs";
import path from "path";

const LEAVES_FILE = path.join(process.cwd(), "data", "merkle-leaves.json");

export function readLeaves(): bigint[] {
  try {
    const raw = fs.readFileSync(LEAVES_FILE, "utf-8");
    return (JSON.parse(raw) as string[]).map((s) => BigInt(s));
  } catch {
    return [];
  }
}

export function writeLeaves(leaves: bigint[]): void {
  const dir = path.dirname(LEAVES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LEAVES_FILE, JSON.stringify(leaves.map((l) => l.toString()), null, 2));
}
