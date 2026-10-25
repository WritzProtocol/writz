// Proves a Bitcoin signet transaction against the Writz `bitcoin-spv`
// contract on Stellar testnet, read-only (simulation, no signing, no fees).
//
//   bun install
//   bun run start [txid] [confirmations]
//
// 1. Reads the light client's best Bitcoin tip.
// 2. Fetches a ready-made proof for `txid` from the Writz relayer.
// 3. Simulates `verify_transaction` with that proof and prints the result.

import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

const RPC_URL = "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const RELAYER_URL = "https://api.testnet.writz.xyz";
const BITCOIN_SPV_ID =
  "CBX23YKCCJMAMBMSCNP6YVKEXUIYK2CTKSR4TQ3RVBPAFYZFVCW7W4EO";

// A confirmed signet transaction, used when no txid is given.
const DEFAULT_TXID =
  "eac0f95c531b4bd5307597f74bedd7379928539056b9a1467ea6d1159507e269";

const txid = (process.argv[2] ?? DEFAULT_TXID).toLowerCase();
const confirmations = Number(process.argv[3] ?? 6);

const server = new rpc.Server(RPC_URL);
const spv = new Contract(BITCOIN_SPV_ID);

// Simulation needs a source account but never signs or submits, so a random
// keypair with sequence 0 is enough for read-only calls.
const reader = new Account(Keypair.random().publicKey(), "0");

async function simulate(op: xdr.Operation): Promise<unknown> {
  const tx = new TransactionBuilder(reader, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    // Contract errors arrive as "Error(Contract, #N)"; see the error table
    // in docs/developers/integrate.md.
    throw new Error(sim.error);
  }
  if (!sim.result) throw new Error("simulation returned no result");
  return scValToNative(sim.result.retval);
}

const hex = (s: string) => Buffer.from(s, "hex");

// BytesN<32> values come back as Buffers; print them as hex.
const show = (v: unknown) =>
  JSON.stringify(
    v,
    (_k, x) =>
      x && x.type === "Buffer" && Array.isArray(x.data)
        ? Buffer.from(x.data).toString("hex")
        : typeof x === "bigint"
          ? x.toString()
          : x,
    2,
  );

async function main() {
  // 1. The light client's view of Bitcoin.
  const tip = await simulate(spv.call("get_best_tip"));
  console.log("bitcoin-spv best tip:", show(tip));

  // 2. A proof bundle from the relayer.
  const res = await fetch(
    `${RELAYER_URL}/spv-proof/${txid}?confirmations=${confirmations}`,
  );
  const body = (await res.json()) as any;
  if (!res.ok) {
    throw new Error(
      `relayer ${res.status}: ${body.error} ${body.message ?? ""}`,
    );
  }
  const a = body.sorobanArgs as {
    block_hash: string;
    merkle_proof: string[];
    tx_index: number;
    raw_tx: string;
    min_confirmations: number;
  };
  console.log(
    `proof for ${txid}: block ${body.blockHeight}, index ${a.tx_index}, ${a.merkle_proof.length} siblings`,
  );

  // 3. verify_transaction(block_hash, merkle_proof, tx_index, raw_tx, min_confirmations)
  const result = await simulate(
    spv.call(
      "verify_transaction",
      nativeToScVal(hex(a.block_hash)),
      xdr.ScVal.scvVec(a.merkle_proof.map((h) => nativeToScVal(hex(h)))),
      nativeToScVal(a.tx_index, { type: "u32" }),
      nativeToScVal(hex(a.raw_tx)),
      nativeToScVal(a.min_confirmations, { type: "u32" }),
    ),
  );
  console.log("verify_transaction:", show(result));
  console.log(
    "note: txid and block_hash are in internal byte order (reversed from explorers).",
  );
}

main().catch((err) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
