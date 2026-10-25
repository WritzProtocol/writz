import { describe, expect, test } from "bun:test";
import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { createHash } from "crypto";
import { deriveP2WSH, finalizePathA } from "@/lib/bitcoin/address";
import { parseMessageSignature, signedMessageFrame } from "@/lib/bitcoin/keyProof";
import {
  buildPayment,
  embeddedSignetAllowed,
  assertEmbeddedAllowed,
  exportKeyFile,
  fromWif,
  importKey,
  keyFromPrivkey,
  loadKey,
  loadOrCreateKey,
  NotEnoughBitcoin,
  parseKeyFile,
  signBitcoinMessage,
  signReleasePsbt,
  storageKeyFor,
  toWif,
  type KeyStorage,
} from "./key";

const NET = bitcoin.networks.testnet;
const PRIV_ONE = Buffer.from("0000000000000000000000000000000000000000000000000000000000000001", "hex");
const G_PUB = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

function memory(): KeyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const counter = () => {
  let n = 1;
  return (len: number) => new Uint8Array(len).fill(n++);
};

describe("where the test key may exist", () => {
  test("testnet and local builds on signet only", () => {
    expect(embeddedSignetAllowed("testnet", "signet")).toBe(true);
    expect(embeddedSignetAllowed("local", "signet")).toBe(true);
    expect(embeddedSignetAllowed("mainnet", "signet")).toBe(false);
    expect(embeddedSignetAllowed("testnet", "mainnet")).toBe(false);
    expect(embeddedSignetAllowed("testnet", "testnet4")).toBe(false);
    expect(() => assertEmbeddedAllowed("mainnet", "signet")).toThrow(/only exists on Writz testnet/);
  });
});

describe("keys and addresses", () => {
  test("fixed vector: private key 1 is the generator point and its P2WPKH", () => {
    const key = keyFromPrivkey(PRIV_ONE, 0);
    expect(key.pubkey.toString("hex")).toBe(G_PUB);
    expect(key.address).toBe("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
  });

  test("refuses an invalid scalar", () => {
    expect(() => keyFromPrivkey(Buffer.alloc(32))).toThrow(/valid private key/);
    expect(() => keyFromPrivkey(Buffer.alloc(31, 1))).toThrow(/valid private key/);
  });

  test("WIF round trip uses the testnet version and refuses mainnet keys", () => {
    const wif = toWif(PRIV_ONE);
    expect(wif).toBe("cMahea7zqjxrtgAbB7LSGbcQUr1uX1ojuat9jZodMN87JcbXMTcA");
    expect(fromWif(wif).equals(PRIV_ONE)).toBe(true);
    // Mainnet WIF of the same key.
    expect(() => fromWif("KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn")).toThrow(/mainnet key/);
    expect(() => fromWif(wif.slice(0, -1) + (wif.endsWith("A") ? "B" : "A"))).toThrow(/checksum/);
  });
});

describe("storage scoped to the account", () => {
  test("creates once per account, survives a reload, never shares between accounts", () => {
    const s = memory();
    const random = counter();
    const a = loadOrCreateKey(s, "user-a", { random, now: 1 });
    expect(a.created).toBe(true);
    expect([...s.data.keys()]).toEqual([storageKeyFor("user-a")]);
    expect(storageKeyFor("user-a")).toBe("writz:signet-key:user-a");

    const again = loadOrCreateKey(s, "user-a", { random });
    expect(again.created).toBe(false);
    expect(again.key.address).toBe(a.key.address);
    expect(loadKey(s, "user-a")?.address).toBe(a.key.address);

    const b = loadOrCreateKey(s, "user-b", { random });
    expect(b.created).toBe(true);
    expect(b.key.address).not.toBe(a.key.address);
    expect(loadKey(s, "user-c")).toBeNull();
  });

  test("an unreadable entry is not a key", () => {
    const s = memory();
    s.setItem(storageKeyFor("u"), "{not json");
    expect(loadKey(s, "u")).toBeNull();
    s.setItem(storageKeyFor("u"), JSON.stringify({ v: 1, network: "mainnet", privkey: "01".repeat(32), createdAt: 0 }));
    expect(loadKey(s, "u")).toBeNull();
  });

  test("refuses to hand out a key the storage did not keep", () => {
    const dropping: KeyStorage = { getItem: () => null, setItem: () => {} };
    expect(() => loadOrCreateKey(dropping, "u")).toThrow(/did not keep/);
  });

  test("needs an account id", () => {
    expect(() => storageKeyFor("")).toThrow();
  });
});

describe("export and import", () => {
  test("a backup file restores the same address in a fresh browser", () => {
    const first = memory();
    const { key } = loadOrCreateKey(first, "user-a", { random: counter(), now: Date.UTC(2026, 9, 25) });
    const file = exportKeyFile(key);
    expect(file).toContain("Signet test key, worthless coins");
    expect(JSON.parse(file).address).toBe(key.address);

    const fresh = memory();
    const restored = importKey(fresh, "user-a", file);
    expect(restored.address).toBe(key.address);
    expect(loadKey(fresh, "user-a")?.address).toBe(key.address);
    expect(loadKey(fresh, "user-a")?.createdAt).toBe(Date.UTC(2026, 9, 25));
  });

  test("accepts a bare Signet WIF and refuses other files", () => {
    expect(parseKeyFile(toWif(PRIV_ONE)).pubkey.toString("hex")).toBe(G_PUB);
    expect(() => parseKeyFile("")).toThrow(/empty/);
    expect(() => parseKeyFile('{"format":"something-else"}')).toThrow(/not a Writz Signet test key/);
    const mismatched = JSON.stringify({ format: "writz-signet-test-key", network: "signet", wif: toWif(PRIV_ONE), address: "tb1qother" });
    expect(() => parseKeyFile(mismatched)).toThrow(/do not match/);
  });
});

describe("signing", () => {
  const key = keyFromPrivkey(Buffer.alloc(32, 9), 0);

  test("BIP-137 message: 65 bytes, P2WPKH header, recovers to the key", () => {
    const message = "Writz Signet faucet\nnonce:00\nstellar:G\nsignet:tb1q";
    const sig = parseMessageSignature(signBitcoinMessage(message, key));
    expect(sig[0]).toBeGreaterThanOrEqual(39);
    expect(sig[0]).toBeLessThanOrEqual(42);
    const sha = (b: Buffer) => createHash("sha256").update(b).digest();
    const hash = sha(sha(signedMessageFrame(message)));
    const recovered = Buffer.from(ecc.recover(hash, sig.subarray(1), ((sig[0] - 27) & 3) as 0 | 1 | 2 | 3, true)!);
    expect(recovered.equals(key.pubkey)).toBe(true);
  });

  test("release PSBT: signs input 0 so Path A finalizes with the protocol signature", () => {
    const protocolPriv = Buffer.alloc(32, 7);
    const protocol = {
      publicKey: Buffer.from(ecc.pointFromScalar(protocolPriv, true)!),
      sign: (h: Buffer) => Buffer.from(ecc.sign(h, protocolPriv)),
    };
    const lock = deriveP2WSH(protocol.publicKey.toString("hex"), key.pubkey.toString("hex"), 300_000);
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.addInput({
      hash: "cd".repeat(32),
      index: 0,
      witnessUtxo: { script: lock.scriptPubKey, value: 19_000 },
      witnessScript: lock.redeemScript,
    });
    psbt.addOutput({ address: key.address, value: 18_700 });
    psbt.signInput(0, protocol);
    const protocolSigned = psbt.toBase64();

    const userSigned = signReleasePsbt(protocolSigned, key);
    const sigs = bitcoin.Psbt.fromBase64(userSigned, { network: NET }).data.inputs[0].partialSig!;
    expect(sigs.map((s) => s.pubkey.toString("hex")).sort()).toEqual(
      [protocol.publicKey.toString("hex"), key.pubkey.toString("hex")].sort(),
    );
    const txHex = finalizePathA(protocolSigned, userSigned, protocol.publicKey.toString("hex"), key.pubkey.toString("hex"));
    expect(bitcoin.Transaction.fromHex(txHex).ins[0].witness).toHaveLength(4);
  });

  test("refuses a release for another key", () => {
    const other = keyFromPrivkey(Buffer.alloc(32, 3), 0);
    const lock = deriveP2WSH(G_PUB, other.pubkey.toString("hex"), 300_000);
    const psbt = new bitcoin.Psbt({ network: NET });
    psbt.addInput({ hash: "cd".repeat(32), index: 0, witnessUtxo: { script: lock.scriptPubKey, value: 19_000 }, witnessScript: lock.redeemScript });
    psbt.addOutput({ address: key.address, value: 18_700 });
    expect(() => signReleasePsbt(psbt.toBase64(), key)).toThrow(/different Bitcoin key/);
  });
});

describe("payments", () => {
  const key = keyFromPrivkey(Buffer.alloc(32, 9), 0);
  const lock = deriveP2WSH(G_PUB, key.pubkey.toString("hex"), 300_000);

  test("pays the lock from the faucet coin with change back to the key", () => {
    const p = buildPayment({ key, utxos: [{ txid: "aa".repeat(32), vout: 0, value: 20_000 }], to: lock.address, amountSats: 15_000, feeRate: 2 });
    const tx = bitcoin.Transaction.fromHex(p.txHex);
    expect(tx.getId()).toBe(p.txid);
    expect(tx.outs[0].value).toBe(15_000);
    expect(Buffer.from(tx.outs[0].script).equals(lock.scriptPubKey)).toBe(true);
    expect(tx.outs[1].value).toBe(p.changeSats);
    expect(p.feeSats).toBe(Math.ceil(10.5 + 68 + 43 + 31) * 2);
    expect(p.changeSats + p.feeSats + 15_000).toBe(20_000);
  });

  test("drops dust change into the fee", () => {
    const p = buildPayment({ key, utxos: [{ txid: "aa".repeat(32), vout: 0, value: 20_000 }], to: lock.address, amountSats: 19_600, feeRate: 1 });
    expect(p.changeSats).toBe(0);
    expect(p.feeSats).toBe(400);
    expect(bitcoin.Transaction.fromHex(p.txHex).outs).toHaveLength(1);
  });

  test("uses more coins when one is not enough, and says when all are not", () => {
    const utxos = [
      { txid: "aa".repeat(32), vout: 0, value: 8_000 },
      { txid: "bb".repeat(32), vout: 1, value: 9_000 },
    ];
    const p = buildPayment({ key, utxos, to: lock.address, amountSats: 15_000, feeRate: 1 });
    expect(bitcoin.Transaction.fromHex(p.txHex).ins).toHaveLength(2);
    expect(() => buildPayment({ key, utxos, to: lock.address, amountSats: 17_000, feeRate: 1 })).toThrow(NotEnoughBitcoin);
  });
});
