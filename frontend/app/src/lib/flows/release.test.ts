import { describe, expect, test } from "bun:test";
import * as ecc from "@bitcoinerlab/secp256k1";
import * as bitcoin from "bitcoinjs-lib";
import { config } from "@/config";
import { deriveP2WSH, getBitcoinNetwork } from "@/lib/bitcoin/address";
import {
  COSIGN_POLL_MS,
  COSIGN_WAIT_MS,
  checkReleasePsbt,
  isReleaseNotCosigned,
  releaseAddressOf,
  releaseBlocker,
  releaseBtc,
} from "./release";

const PUBKEY = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const position = { btcPubkey: PUBKEY, timelockHeight: 300_000, txid: "ab".repeat(32) };
const onNetwork = (a: string) => a.startsWith("tb1");

describe("releaseBlocker", () => {
  test("needs the deposit's Bitcoin details", () => {
    expect(releaseBlocker({ ...position, btcPubkey: undefined }, { address: "tb1q", pubkey: PUBKEY }, onNetwork)).toBe(
      "missing_details",
    );
  });

  test("needs a connected wallet", () => {
    expect(releaseBlocker(position, { address: null, pubkey: null }, onNetwork)).toBe("no_wallet");
  });

  test("the connected key must be the deposit's", () => {
    expect(releaseBlocker(position, { address: "tb1q", pubkey: "02" + "33".repeat(32) }, onNetwork)).toBe("wrong_account");
    expect(releaseBlocker(position, { address: "tb1q", pubkey: PUBKEY.toUpperCase() }, onNetwork)).toBeNull();
  });

  test("the destination must be on the configured network", () => {
    expect(releaseBlocker(position, { address: "bc1q", pubkey: PUBKEY }, onNetwork)).toBe("wrong_network");
  });
});

// ── The relayer's co-signed release, checked and finished here ──────────

function signer(seedByte: number) {
  const privateKey = Buffer.alloc(32, seedByte);
  const publicKey = Buffer.from(ecc.pointFromScalar(privateKey, true)!);
  return { publicKey, sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, privateKey)) };
}

const PROTOCOL = signer(7);
const USER = signer(9);
const DEPOSIT_TXID = "cd".repeat(32);
const TIMELOCK = 300_000;
const NET = getBitcoinNetwork();

/** What the relayer's repay watcher publishes: the Path A release, signed by the protocol key only. */
function relayerPsbt(over: { recipient?: string; protocol?: typeof PROTOCOL } = {}) {
  const lock = deriveP2WSH(PROTOCOL.publicKey.toString("hex"), USER.publicKey.toString("hex"), TIMELOCK);
  const psbt = new bitcoin.Psbt({ network: NET });
  psbt.addInput({
    hash: DEPOSIT_TXID,
    index: 1,
    witnessUtxo: { script: lock.scriptPubKey, value: 5_000_000 },
    witnessScript: lock.redeemScript,
    sequence: 0xffff_fffe,
  });
  psbt.addOutput({ address: over.recipient ?? releaseAddressOf(USER.publicKey.toString("hex"), NET), value: 4_999_700 });
  psbt.signInput(0, over.protocol ?? PROTOCOL);
  return psbt;
}

const expected = {
  txid: DEPOSIT_TXID,
  protocolPubkey: PROTOCOL.publicKey.toString("hex"),
  userPubkey: USER.publicKey.toString("hex"),
  timelockHeight: TIMELOCK,
  network: NET,
};

describe("checkReleasePsbt", () => {
  test("accepts the relayer's release and reads its output, amount and fee", () => {
    expect(checkReleasePsbt(relayerPsbt(), expected)).toEqual({
      vout: 1,
      amountSat: 5_000_000,
      feeSat: 300,
      recipient: releaseAddressOf(expected.userPubkey, NET),
    });
  });

  test("refuses a release paying anyone but the deposit key", () => {
    const other = releaseAddressOf(signer(3).publicKey.toString("hex"), NET);
    expect(() => checkReleasePsbt(relayerPsbt({ recipient: other }), expected)).toThrow("ReleaseMismatch: recipient");
  });

  test("refuses a release without the protocol's signature, or for another deposit", () => {
    expect(() => checkReleasePsbt(relayerPsbt(), { ...expected, protocolPubkey: signer(3).publicKey.toString("hex") })).toThrow(
      "ReleaseMismatch",
    );
    expect(() => checkReleasePsbt(relayerPsbt(), { ...expected, txid: "ef".repeat(32) })).toThrow("ReleaseMismatch: input");
  });
});

describe("releaseBtc", () => {
  const chainPosition = (status: "active" | "closed", debt = 0n) => ({
    txid: DEPOSIT_TXID,
    status,
    depositor: "GOWNER",
    collateralSats: 5_000_000n,
    debtStroops: debt,
    storedDebtStroops: debt,
    timelockHeight: TIMELOCK,
    userPubkey: USER.publicKey.toString("hex"),
    scriptPubKey: "",
    ledger: 1,
  });
  const position = {
    id: DEPOSIT_TXID,
    owner: "GOWNER",
    txid: DEPOSIT_TXID,
    collateralSats: "5000000",
    debtStroops: "0",
    index: 0,
    status: "closed" as const,
    createdAt: 0,
  };
  /** Xverse: adds the user's signature to input 0. */
  const signPsbt = async (b64: string) => {
    const p = bitcoin.Psbt.fromBase64(b64, { network: NET });
    p.signInput(0, USER);
    return p.toBase64();
  };

  test("fetches the co-signed release, has the user sign it and broadcasts a valid Path A spend", async () => {
    (config.bitcoin as { protocolPubkey: string }).protocolPubkey = expected.protocolPubkey;
    let polls = 0;
    let broadcast = "";
    const closed: string[] = [];
    const out = await releaseBtc({
      position,
      signPsbt,
      stellarAddress: "GOWNER",
      signTransaction: (async () => ({ signedTxXdr: "", signerAddress: "GOWNER" })) as never,
      emit: () => {},
      deps: {
        read: async () => chainPosition("closed"),
        getReleasePsbt: async () => (++polls < 2 ? null : relayerPsbt().toBuffer()),
        close: async ({ txid }) => void closed.push(txid),
        broadcast: async (hex) => {
          broadcast = hex;
          return "aa".repeat(32);
        },
        sleep: async () => {},
      },
    });
    expect(out).toEqual({ btcTxid: "aa".repeat(32), recipient: releaseAddressOf(expected.userPubkey, NET) });
    expect(closed).toEqual([]);
    const tx = bitcoin.Transaction.fromHex(broadcast);
    // [user_sig, protocol_sig, 0x01, redeem_script]: the cooperative branch.
    expect(tx.ins[0].witness).toHaveLength(4);
    expect(tx.ins[0].witness[2]).toEqual(Buffer.from([1]));
  });

  test("closes a loan that never borrowed before waiting for the co-signature", async () => {
    (config.bitcoin as { protocolPubkey: string }).protocolPubkey = expected.protocolPubkey;
    const closed: string[] = [];
    await releaseBtc({
      position,
      signPsbt,
      stellarAddress: "GOWNER",
      signTransaction: (async () => ({ signedTxXdr: "", signerAddress: "GOWNER" })) as never,
      emit: () => {},
      deps: {
        read: async () => chainPosition("active"),
        getReleasePsbt: async () => relayerPsbt().toBuffer(),
        close: async ({ txid }) => void closed.push(txid),
        broadcast: async () => "bb".repeat(32),
        sleep: async () => {},
      },
    });
    expect(closed).toEqual([DEPOSIT_TXID]);
  });

  test("refuses a loan that still owes, and gives up when Writz never co-signs", async () => {
    (config.bitcoin as { protocolPubkey: string }).protocolPubkey = expected.protocolPubkey;
    const base = {
      position,
      signPsbt,
      stellarAddress: "GOWNER",
      signTransaction: (async () => ({ signedTxXdr: "", signerAddress: "GOWNER" })) as never,
      emit: () => {},
    };
    const deps = {
      getReleasePsbt: async () => null,
      close: async () => {},
      broadcast: async () => "",
      sleep: async () => {},
    };
    await expect(releaseBtc({ ...base, deps: { ...deps, read: async () => chainPosition("active", 5n) } })).rejects.toThrow(
      "LoanNotRepaid",
    );
    await expect(releaseBtc({ ...base, deps: { ...deps, read: async () => chainPosition("closed") } })).rejects.toThrow(
      "ReleaseNotCosigned",
    );
  });

  test("waits ten minutes for the co-signature, polling every five seconds, before stopping", async () => {
    (config.bitcoin as { protocolPubkey: string }).protocolPubkey = expected.protocolPubkey;
    expect(COSIGN_POLL_MS).toBe(5_000);
    expect(COSIGN_WAIT_MS).toBe(10 * 60_000);
    let waited = 0;
    let reads = 0;
    const error = await releaseBtc({
      position,
      signPsbt,
      stellarAddress: "GOWNER",
      signTransaction: (async () => ({ signedTxXdr: "", signerAddress: "GOWNER" })) as never,
      emit: () => {},
      deps: {
        read: async () => chainPosition("closed"),
        getReleasePsbt: async () => {
          reads++;
          return null;
        },
        close: async () => {},
        broadcast: async () => "",
        sleep: async (ms) => void (waited += ms),
      },
    }).catch((e: unknown) => e);
    expect(isReleaseNotCosigned(error)).toBe(true);
    expect(waited).toBe(COSIGN_WAIT_MS);
    expect(reads).toBe(COSIGN_WAIT_MS / COSIGN_POLL_MS + 1);
  });

  test("a signature published after three minutes, as on a busy network, is still picked up", async () => {
    (config.bitcoin as { protocolPubkey: string }).protocolPubkey = expected.protocolPubkey;
    let waited = 0;
    const out = await releaseBtc({
      position,
      signPsbt,
      stellarAddress: "GOWNER",
      signTransaction: (async () => ({ signedTxXdr: "", signerAddress: "GOWNER" })) as never,
      emit: () => {},
      deps: {
        read: async () => chainPosition("closed"),
        // The relayer's publish landed 5.5 minutes after the repay.
        getReleasePsbt: async () => (waited >= 330_000 ? relayerPsbt().toBuffer() : null),
        close: async () => {},
        broadcast: async () => "cc".repeat(32),
        sleep: async (ms) => void (waited += ms),
      },
    });
    expect(out.btcTxid).toBe("cc".repeat(32));
    expect(waited).toBe(330_000);
  });

  test("checking again after a timeout resumes the wait without closing the loan again", async () => {
    (config.bitcoin as { protocolPubkey: string }).protocolPubkey = expected.protocolPubkey;
    const closed: string[] = [];
    const steps: string[] = [];
    let published = false;
    let status: "active" | "closed" = "active";
    const run = () =>
      releaseBtc({
        position,
        signPsbt,
        stellarAddress: "GOWNER",
        signTransaction: (async () => ({ signedTxXdr: "", signerAddress: "GOWNER" })) as never,
        emit: (e) => void (e.type === "preparing" && e.step && steps.push(e.step)),
        deps: {
          read: async () => chainPosition(status),
          getReleasePsbt: async () => (published ? relayerPsbt().toBuffer() : null),
          close: async ({ txid }) => {
            closed.push(txid);
            status = "closed";
          },
          broadcast: async () => "dd".repeat(32),
          sleep: async () => {},
        },
      });

    const first = await run().catch((e: unknown) => e);
    expect(isReleaseNotCosigned(first)).toBe(true);
    expect(closed).toEqual([DEPOSIT_TXID]);

    published = true;
    steps.length = 0;
    const out = await run();
    expect(out.btcTxid).toBe("dd".repeat(32));
    expect(closed).toEqual([DEPOSIT_TXID]);
    expect(steps).toEqual(["reading", "cosign", "broadcasting"]);
  });

  test("only the co-sign timeout is resumable", () => {
    expect(isReleaseNotCosigned(new Error("ReleaseNotCosigned"))).toBe(true);
    expect(isReleaseNotCosigned(new Error("ReleaseMismatch: recipient"))).toBe(false);
    expect(isReleaseNotCosigned("ReleaseNotCosigned")).toBe(false);
  });
});
