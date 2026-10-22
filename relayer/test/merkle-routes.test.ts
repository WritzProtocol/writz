/**
 * PoC-first regression tests for GHSA-ffx5-7x4m-939g (unauthenticated
 * /update-leaf corrupts the relayer leaf store).
 *
 * Uses a standalone Express app built from merkleRouter, same pattern as
 * routes.test.ts. `commitment-tree`'s Client and `../config.js` are mocked
 * so the on-chain root and `COMMITMENT_TREE_ID` are fully controlled per
 * test; the leaf store is the real leaf-store.ts module (backed by the
 * extended jest bun:sqlite mock), pointed at one temp file for the file.
 *
 * merkle.ts imports @stellar/stellar-sdk directly (for Keypair/Transaction,
 * used only by /insert-commitment's signing path, untouched here) - its
 * real CJS build require()s an ESM-only @noble/hashes file that ts-jest's
 * CommonJS loader can't parse (same constraint documented in
 * repay-watcher/poller.ts). Stub it out so merkle.ts loads under Jest.
 */

jest.mock("@stellar/stellar-sdk", () => ({
  Keypair: { fromSecret: jest.fn() },
  Transaction: class {},
}));

jest.mock("commitment-tree", () => ({
  Client: jest.fn(),
}));

const mockConfig: { commitmentTreeId: string; networkPassphrase: string; stellarRpcUrl: string; adminSecret: string | undefined } = {
  commitmentTreeId: "CTESTTESTTESTTESTTESTTESTTESTTESTTESTTESTTESTTESTTES",
  networkPassphrase: "Test SDF Network ; September 2015",
  stellarRpcUrl: "http://localhost:0",
  adminSecret: undefined,
};
jest.mock("../src/config.js", () => ({ config: mockConfig }));

import express from "express";
import request from "supertest";
import path from "path";
import os from "os";
import fs from "fs";
import { poseidon2 } from "poseidon-lite";
import { Client } from "commitment-tree";
import { merkleRouter } from "../src/routes/merkle.js";
import { writeLeaves, readLeaves } from "../src/leaf-store.js";

const MockClient = Client as unknown as jest.Mock;

const TREE_DEPTH = 20;
function zeros(depth = TREE_DEPTH): bigint[] {
  const z: bigint[] = [0n];
  for (let i = 1; i <= depth; i++) z[i] = poseidon2([z[i - 1], z[i - 1]]);
  return z;
}
function computeRoot(leaves: bigint[], depth = TREE_DEPTH): bigint {
  const z = zeros(depth);
  let level = [...leaves];
  for (let d = 0; d < depth; d++) {
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(poseidon2([level[i], i + 1 < level.length ? level[i + 1] : z[d]]));
    }
    level = next;
  }
  return level[0] ?? z[depth];
}

function setOnChainRoot(root: bigint) {
  const rootBytes = Buffer.from(root.toString(16).padStart(64, "0"), "hex");
  MockClient.mockImplementation(() => ({
    get_merkle_root: async () => ({ result: rootBytes }),
  }));
}

let app: express.Express;
let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "writz-merkle-test-"));
  process.env["SQLITE_PATH"] = path.join(tmpDir, "merkle.db");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  mockConfig.commitmentTreeId = "CTESTTESTTESTTESTTESTTESTTESTTESTTESTTESTTESTTESTTES";
  MockClient.mockReset();
  writeLeaves([]);

  app = express();
  app.use(express.json());
  app.use("/", merkleRouter);
});

const LEAF_0 = 111n;
const LEAF_1 = 222n;

describe("POST /update-leaf", () => {
  test("GHSA-ffx5-7x4m-939g PoC: an update that does not match the real on-chain root is rejected, not persisted", async () => {
    writeLeaves([LEAF_0, LEAF_1]);
    // On-chain root reflects the CURRENT honest leaves - no real borrow/repay
    // has happened, so no update should be accepted.
    setOnChainRoot(computeRoot([LEAF_0, LEAF_1]));

    const res = await request(app)
      .post("/update-leaf")
      .send({ leafIndex: 0, newCommitment: "de".repeat(32) });

    expect(res.status).toBe(409);
    expect(readLeaves()).toEqual([LEAF_0, LEAF_1]);
  });

  test("an update that reproduces the real post-borrow/repay root is accepted", async () => {
    writeLeaves([LEAF_0, LEAF_1]);
    const newLeaf = 999n;
    const newLeaves = [newLeaf, LEAF_1];
    // Simulates the real sequence: a borrow/repay already advanced the
    // on-chain root to exactly what this leaf replacement would produce.
    setOnChainRoot(computeRoot(newLeaves));

    const res = await request(app).post("/update-leaf").send({
      leafIndex: 0,
      newCommitment: newLeaf.toString(16).padStart(64, "0"),
    });

    expect(res.status).toBe(200);
    expect(readLeaves()).toEqual(newLeaves);
  });

  test("rejects without ever calling the chain when COMMITMENT_TREE_ID is unset", async () => {
    mockConfig.commitmentTreeId = "";
    writeLeaves([LEAF_0]);

    const res = await request(app)
      .post("/update-leaf")
      .send({ leafIndex: 0, newCommitment: "ab".repeat(32) });

    expect(res.status).toBe(500);
    expect(MockClient).not.toHaveBeenCalled();
    expect(readLeaves()).toEqual([LEAF_0]);
  });

  test("rejects a malformed newCommitment before touching the store or the chain", async () => {
    writeLeaves([LEAF_0]);

    const res = await request(app)
      .post("/update-leaf")
      .send({ leafIndex: 0, newCommitment: "not-hex" });

    expect(res.status).toBe(400);
    expect(MockClient).not.toHaveBeenCalled();
    expect(readLeaves()).toEqual([LEAF_0]);
  });
});
