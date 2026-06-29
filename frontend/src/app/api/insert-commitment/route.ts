import { NextRequest, NextResponse } from "next/server";
import { Keypair, Transaction } from "@stellar/stellar-sdk";
import { Client } from "commitment-tree";
import { config, requireContract } from "@/config";
import { singleLeafPath } from "@/lib/merkle";
import { simulateWithRetry } from "@/lib/flows/submit";

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "ADMIN_SECRET not configured" }, { status: 500 });
  }

  let body: { commitment?: string; new_root?: string };
  try {
    body = (await req.json()) as { commitment?: string; new_root?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { commitment: commitmentHex } = body;
  if (!commitmentHex || !/^[0-9a-f]{64}$/i.test(commitmentHex)) {
    return NextResponse.json({ error: "commitment must be a 64-char hex string" }, { status: 400 });
  }

  try {
    const keypair = Keypair.fromSecret(adminSecret);
    const admin = keypair.publicKey();

    const commitment = BigInt("0x" + commitmentHex);
    const newRoot = singleLeafPath(commitment).root;
    const toBytes = (n: bigint) =>
      Buffer.from(n.toString(16).padStart(64, "0"), "hex");

    const client = new Client({
      contractId: requireContract(config.contracts.commitmentTree, "commitment-tree"),
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
      allowHttp: config.rpcUrl.startsWith("http://"),
      publicKey: admin,
    });

    const signTransaction = async (xdr: string) => {
      const tx = new Transaction(xdr, config.networkPassphrase);
      tx.sign(keypair);
      return { signedTxXdr: tx.toXDR(), signerAddress: admin };
    };

    const tx = await simulateWithRetry(() =>
      client.insert_commitment({
        caller: admin,
        commitment: toBytes(commitment),
        new_root: toBytes(newRoot),
      }),
    );
    const sent = await tx.signAndSend({ signTransaction });

    return NextResponse.json({
      txHash: sent.sendTransactionResponse?.hash,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
