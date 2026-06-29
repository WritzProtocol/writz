import { NextRequest, NextResponse } from "next/server";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { ECPairFactory } from "ecpair";
import { Client } from "commitment-tree";
import { config, requireContract } from "@/config";

const ECPair = ECPairFactory(ecc);

const READ_ONLY_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

function getNetwork(): bitcoin.networks.Network {
  return process.env.BITCOIN_NETWORK === "mainnet"
    ? bitcoin.networks.bitcoin
    : bitcoin.networks.testnet;
}

/**
 * Ensures input 0 is locked to a Writz deposit P2WSH whose cooperative branch
 * designates THIS protocol key as the co-signer, and that the input's
 * scriptPubKey commits to exactly that script. Without this the endpoint would
 * be a blind signing oracle — it would add the protocol signature to any input.
 */
function assertWritzReleaseInput(
  psbt: bitcoin.Psbt,
  protocolPubkey: Buffer,
  network: bitcoin.networks.Network,
): void {
  const input = psbt.data.inputs[0];
  if (!input?.witnessScript) {
    throw new Error("input 0 has no witnessScript");
  }

  // Expected redeem script (see bitcoin-script/src/script.ts):
  //   OP_IF   <protocol> OP_CHECKSIGVERIFY <user> OP_CHECKSIG
  //   OP_ELSE <timelock> OP_CHECKLOCKTIMEVERIFY OP_DROP <user> OP_CHECKSIG
  //   OP_ENDIF
  const ops = bitcoin.script.decompile(input.witnessScript);
  const op = bitcoin.opcodes;
  const is33 = (x: unknown): x is Buffer => Buffer.isBuffer(x) && x.length === 33;
  const shapeOk =
    ops != null &&
    ops.length === 12 &&
    ops[0] === op.OP_IF &&
    is33(ops[1]) &&
    ops[2] === op.OP_CHECKSIGVERIFY &&
    is33(ops[3]) &&
    ops[4] === op.OP_CHECKSIG &&
    ops[5] === op.OP_ELSE &&
    Buffer.isBuffer(ops[6]) &&
    ops[7] === op.OP_CHECKLOCKTIMEVERIFY &&
    ops[8] === op.OP_DROP &&
    is33(ops[9]) &&
    ops[10] === op.OP_CHECKSIG &&
    ops[11] === op.OP_ENDIF;
  if (!shapeOk) {
    throw new Error("input 0 is not a Writz deposit script");
  }

  // The cooperative-branch co-signer must be this protocol key.
  if (!(ops![1] as Buffer).equals(protocolPubkey)) {
    throw new Error("protocol key is not the co-signer for this input");
  }

  // The scriptPubKey must commit to exactly this redeem script.
  const expected = bitcoin.payments.p2wsh({
    redeem: { output: input.witnessScript, network },
    network,
  }).output;
  if (
    !input.witnessUtxo?.script ||
    !expected ||
    !input.witnessUtxo.script.equals(expected)
  ) {
    throw new Error("input 0 scriptPubKey does not match its witnessScript");
  }
}

export async function POST(req: NextRequest) {
  const protocolKey = process.env.PROTOCOL_SIGNING_KEY;
  if (!protocolKey) {
    return NextResponse.json(
      { error: "PROTOCOL_SIGNING_KEY not configured" },
      { status: 500 },
    );
  }

  let body: { psbt?: string; commitment?: string; stellarAddress?: string };
  try {
    body = (await req.json()) as {
      psbt?: string;
      commitment?: string;
      stellarAddress?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { psbt: psbtBase64, commitment: commitmentHex, stellarAddress } = body;

  if (!psbtBase64 || typeof psbtBase64 !== "string") {
    return NextResponse.json({ error: "psbt is required" }, { status: 400 });
  }
  if (!commitmentHex || !/^[0-9a-f]{64}$/i.test(commitmentHex)) {
    return NextResponse.json(
      { error: "commitment must be a 64-char hex string" },
      { status: 400 },
    );
  }
  if (!stellarAddress || typeof stellarAddress !== "string") {
    return NextResponse.json(
      { error: "stellarAddress is required" },
      { status: 400 },
    );
  }

  // Eligibility: the position must be finalized on-chain AND the loan repaid.
  // `is_commitment_pending` only tells us the commitment was inserted into the
  // tree — it does NOT prove the debt is cleared (a finalized commitment can
  // still carry debt). So we also require no outstanding debt on-chain.
  //
  // Demo-grade: on the single-borrower testnet, `borrowed == 0` means this loan
  // is repaid, and it leaks no private position data. The production check is a
  // ZK proof of `debt == 0` bound to the deposit txid (out of scope here).
  try {
    const client = new Client({
      contractId: requireContract(
        config.contracts.commitmentTree,
        "commitment-tree",
      ),
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
      allowHttp: config.rpcUrl.startsWith("http://"),
      publicKey: READ_ONLY_SOURCE,
    });

    const commitmentBuf = Buffer.from(commitmentHex, "hex");
    const [{ result: isPending }, { result: pool }] = await Promise.all([
      client.is_commitment_pending({ commitment: commitmentBuf }),
      client.get_pool_state(),
    ]);

    if (isPending) {
      return NextResponse.json(
        { error: "Position commitment is not yet finalized on-chain" },
        { status: 403 },
      );
    }

    const [, totalBorrowed] = pool;
    if (totalBorrowed > 0n) {
      return NextResponse.json(
        { error: "Outstanding debt on-chain — repay the loan before releasing collateral" },
        { status: 403 },
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `On-chain check failed: ${msg}` },
      { status: 502 },
    );
  }

  // Co-sign the cooperative release. Only sign an input locked to a Writz
  // deposit P2WSH where this protocol key is the co-signer — never act as a
  // blind signing oracle for arbitrary inputs.
  try {
    const network = getNetwork();
    const keypair = ECPair.fromWIF(protocolKey, network);

    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });
    assertWritzReleaseInput(psbt, Buffer.from(keypair.publicKey), network);
    psbt.signInput(0, keypair);

    return NextResponse.json({ signedPsbt: psbt.toBase64() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `PSBT signing failed: ${msg}` },
      { status: 400 },
    );
  }
}
