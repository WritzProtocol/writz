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

  // Verify the commitment is in the Merkle tree (not pending) — proves it went
  // through the full deposit + insert_commitment flow on-chain.
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
    const { result: isPending } = await client.is_commitment_pending({
      commitment: commitmentBuf,
    });

    if (isPending) {
      return NextResponse.json(
        { error: "Position commitment is not yet finalized on-chain" },
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

  // Co-sign the PSBT with the protocol key (Path A).
  try {
    const network = getNetwork();
    const keypair = ECPair.fromWIF(protocolKey, network);

    const psbt = bitcoin.Psbt.fromBase64(psbtBase64, { network });
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
