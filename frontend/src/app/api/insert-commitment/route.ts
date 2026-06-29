import { NextRequest, NextResponse } from "next/server";
import { Keypair, Transaction } from "@stellar/stellar-sdk";
import { Client } from "commitment-tree";
import { config, requireContract } from "@/config";
import { computeRoot } from "@/lib/merkle";
import { readLeaves, writeLeaves } from "@/lib/server/leaf-store";
import { getMerkleRoot } from "@/lib/contracts/commitmentTree";
import { simulateWithRetry } from "@/lib/flows/submit";

export async function POST(req: NextRequest) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return NextResponse.json({ error: "ADMIN_SECRET not configured" }, { status: 500 });
  }

  let body: { commitment?: string };
  try {
    body = (await req.json()) as { commitment?: string };
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

    // Read existing leaf list and verify it matches the current on-chain root.
    // This catches cases where the server restarted after an on-chain insert but
    // before writeLeaves() completed, which would otherwise corrupt future roots.
    const existingLeaves = readLeaves();
    const computedCurrentRoot = computeRoot(existingLeaves);
    const onChainRootHex = await getMerkleRoot();
    const onChainRoot = BigInt("0x" + onChainRootHex);

    if (computedCurrentRoot !== onChainRoot) {
      return NextResponse.json(
        {
          error:
            "Leaf store is out of sync with the on-chain Merkle root. " +
            "Manual resync required before new insertions can proceed.",
          onChainRoot: onChainRootHex,
          computedRoot: computedCurrentRoot.toString(16).padStart(64, "0"),
          leafCount: existingLeaves.length,
        },
        { status: 409 },
      );
    }

    const newLeaves = [...existingLeaves, commitment];
    const newRoot = computeRoot(newLeaves);
    const toBytes = (n: bigint) => Buffer.from(n.toString(16).padStart(64, "0"), "hex");

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

    // Persist the leaf list only after the on-chain tx confirms. If the process
    // dies between here and writeLeaves(), the sync check above will catch it on
    // the next call and prevent a bad root from being computed.
    writeLeaves(newLeaves);

    return NextResponse.json({
      txHash: sent.sendTransactionResponse?.hash,
      leafIndex: existingLeaves.length,
      newRoot: newRoot.toString(16).padStart(64, "0"),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
