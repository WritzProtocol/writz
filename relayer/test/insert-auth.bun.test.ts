/**
 * PoC-first regression tests for GHSA-wqp4-3573-552v / GHSA-prw2-j3jx-43qh:
 * POST /insert-commitment used to sign the admin-only insertion for any
 * unauthenticated caller. `verifyInsertAuth` now requires a transaction
 * genuinely signed by the commitment's real on-chain depositor.
 *
 * Uses the real @stellar/stellar-sdk (not mocked) to build and sign
 * transactions exactly as the frontend will. Runs under Bun (`bun test
 * test/insert-auth.bun.test.ts`), not Jest - see jest.config.js's
 * testPathIgnorePatterns for why.
 */
import { describe, expect, test } from "bun:test";
import { Keypair, Account, TransactionBuilder, Operation, Networks } from "@stellar/stellar-sdk";
import {
  verifyInsertAuth,
  InsertAuthError,
  INSERT_COMMITMENT_DATA_NAME,
  lookupDepositorOnChain,
  type DepositEventsServer,
} from "../src/insert-auth.js";

const PASSPHRASE = Networks.TESTNET;
const COMMITMENT_HEX = "ab".repeat(32);
const OTHER_COMMITMENT_HEX = "cd".repeat(32);

function buildAuthTx(signer: Keypair, commitmentHex: string, opts?: { dataName?: string; opCount?: number }) {
  const account = new Account(signer.publicKey(), "0");
  const builder = new TransactionBuilder(account, { fee: "100", networkPassphrase: PASSPHRASE }).addOperation(
    Operation.manageData({
      name: opts?.dataName ?? INSERT_COMMITMENT_DATA_NAME,
      value: Buffer.from(commitmentHex, "hex"),
    }),
  );
  for (let i = 1; i < (opts?.opCount ?? 1); i++) {
    builder.addOperation(Operation.manageData({ name: "extra", value: null }));
  }
  const tx = builder.setTimeout(30).build();
  tx.sign(signer);
  return tx.toXDR();
}

describe("verifyInsertAuth", () => {
  test("GHSA-wqp4/GHSA-prw2 PoC: an attacker's own valid signature over the victim's commitment is rejected", async () => {
    const victim = Keypair.random();
    const attacker = Keypair.random();

    // Attacker signs a perfectly well-formed auth tx for THEIR OWN key, but
    // naming the victim's commitment - exactly what an attacker can freely
    // produce without ever touching the victim's wallet.
    const forgedAuthTx = buildAuthTx(attacker, COMMITMENT_HEX);

    await expect(
      verifyInsertAuth(forgedAuthTx, COMMITMENT_HEX, {
        networkPassphrase: PASSPHRASE,
        // The real on-chain DepositEvent says the victim deposited this commitment.
        lookupDepositor: async () => victim.publicKey(),
      }),
    ).rejects.toThrow(InsertAuthError);
  });

  test("a genuine auth tx signed by the commitment's real depositor is accepted", async () => {
    const depositor = Keypair.random();
    const authTx = buildAuthTx(depositor, COMMITMENT_HEX);

    await expect(
      verifyInsertAuth(authTx, COMMITMENT_HEX, {
        networkPassphrase: PASSPHRASE,
        lookupDepositor: async () => depositor.publicKey(),
      }),
    ).resolves.toBeUndefined();
  });

  test("rejects when no on-chain DepositEvent exists for this commitment", async () => {
    const depositor = Keypair.random();
    const authTx = buildAuthTx(depositor, COMMITMENT_HEX);

    await expect(
      verifyInsertAuth(authTx, COMMITMENT_HEX, {
        networkPassphrase: PASSPHRASE,
        lookupDepositor: async () => undefined,
      }),
    ).rejects.toThrow(/no on-chain DepositEvent/);
  });

  test("rejects a tx authorizing a different commitment than the one being inserted", async () => {
    const depositor = Keypair.random();
    const authTx = buildAuthTx(depositor, OTHER_COMMITMENT_HEX);

    await expect(
      verifyInsertAuth(authTx, COMMITMENT_HEX, {
        networkPassphrase: PASSPHRASE,
        lookupDepositor: async () => depositor.publicKey(),
      }),
    ).rejects.toThrow(/does not authorize this exact commitment/);
  });

  test("rejects a tx with the wrong manageData name", async () => {
    const depositor = Keypair.random();
    const authTx = buildAuthTx(depositor, COMMITMENT_HEX, { dataName: "not-the-right-name" });

    await expect(
      verifyInsertAuth(authTx, COMMITMENT_HEX, {
        networkPassphrase: PASSPHRASE,
        lookupDepositor: async () => depositor.publicKey(),
      }),
    ).rejects.toThrow(/manageData/);
  });

  test("rejects a tx with more than one operation", async () => {
    const depositor = Keypair.random();
    const authTx = buildAuthTx(depositor, COMMITMENT_HEX, { opCount: 2 });

    await expect(
      verifyInsertAuth(authTx, COMMITMENT_HEX, {
        networkPassphrase: PASSPHRASE,
        lookupDepositor: async () => depositor.publicKey(),
      }),
    ).rejects.toThrow(/exactly one operation/);
  });

  test("rejects a garbage XDR string", async () => {
    await expect(
      verifyInsertAuth("not-a-real-xdr", COMMITMENT_HEX, {
        networkPassphrase: PASSPHRASE,
        lookupDepositor: async () => "irrelevant",
      }),
    ).rejects.toThrow(/not a valid signed transaction/);
  });

  test("rejects a tx signed by a DIFFERENT key than its own source account (unsigned/mis-signed)", async () => {
    const claimedSource = Keypair.random();
    const actualSigner = Keypair.random();
    const account = new Account(claimedSource.publicKey(), "0");
    const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: PASSPHRASE })
      .addOperation(
        Operation.manageData({ name: INSERT_COMMITMENT_DATA_NAME, value: Buffer.from(COMMITMENT_HEX, "hex") }),
      )
      .setTimeout(30)
      .build();
    tx.sign(actualSigner); // signed by someone who does NOT own claimedSource

    await expect(
      verifyInsertAuth(tx.toXDR(), COMMITMENT_HEX, {
        networkPassphrase: PASSPHRASE,
        lookupDepositor: async () => claimedSource.publicKey(),
      }),
    ).rejects.toThrow(/not validly signed/);
  });
});

describe("lookupDepositorOnChain", () => {
  function fakeServer(events: { topic: unknown[]; value: unknown }[]): DepositEventsServer {
    return {
      getLatestLedger: async () => ({ sequence: 1_000_000 }),
      getEvents: async () => ({ events }),
    };
  }

  test("finds the depositor for a matching deposit event topic", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require("@stellar/stellar-sdk") as typeof import("@stellar/stellar-sdk");
    const commitmentBytes = Buffer.from(COMMITMENT_HEX, "hex");
    const server = fakeServer([
      {
        topic: [sdk.nativeToScVal("deposit", { type: "symbol" }), sdk.nativeToScVal(commitmentBytes, { type: "bytes" })],
        value: sdk.nativeToScVal({ depositor: "GDEPOSITORADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" }, { type: "instance" }),
      },
    ]);

    const result = await lookupDepositorOnChain(server, "CCONTRACT", COMMITMENT_HEX);
    expect(result).toBe("GDEPOSITORADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  });

  test("returns undefined when no event matches the commitment", async () => {
    const server = fakeServer([]);
    const result = await lookupDepositorOnChain(server, "CCONTRACT", COMMITMENT_HEX);
    expect(result).toBeUndefined();
  });
});
