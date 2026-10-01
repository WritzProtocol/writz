import { config } from "@/config";
import {
  buildReleasePsbt,
  deriveP2WSH,
  estimateReleaseFee,
  finalizePathA,
  isAddressForNetwork,
} from "@/lib/bitcoin/address";
import type { Emit } from "@/lib/flow/engine";
import { positionKeys, savePosition, type Position } from "@/lib/position";
import { proveZeroDebt, type ZeroDebtInput } from "@/lib/prover";

export type ReleaseBlocker = "missing_details" | "no_wallet" | "wrong_account" | "wrong_network";

/** Why this position can't be released to the connected Bitcoin wallet, or null when it can. */
export function releaseBlocker(
  position: Pick<Position, "btcPubkey" | "timelockHeight" | "txid">,
  wallet: { address: string | null; pubkey: string | null },
  onNetwork: (address: string) => boolean = isAddressForNetwork,
): ReleaseBlocker | null {
  if (!position.btcPubkey || !position.timelockHeight || !position.txid) return "missing_details";
  if (!wallet.address) return "no_wallet";
  if (wallet.pubkey && wallet.pubkey.toLowerCase() !== position.btcPubkey.toLowerCase()) return "wrong_account";
  if (!onNetwork(wallet.address)) return "wrong_network";
  return null;
}

export const releaseFeeEstimate = () => estimateReleaseFee(config.bitcoin.apiUrl);

/**
 * Releases a repaid position's BTC to `recipient`: builds the cooperative
 * PSBT, proves zero debt, gets the protocol co-signature, has the user sign
 * in their Bitcoin wallet and broadcasts. The recipient must be the
 * connected wallet that made the deposit (see `releaseBlocker`).
 */
export async function releaseBtc(params: {
  position: Position;
  seed: Uint8Array;
  recipient: string;
  signPsbt: (psbtBase64: string) => Promise<string>;
  emit: Emit;
  /** The fee shown at review; estimated again when absent. */
  feeSat?: number;
}): Promise<{ btcTxid: string }> {
  const { position, seed, recipient, signPsbt, emit } = params;
  const { btcPubkey, timelockHeight, txid: depositTxid } = position;
  if (!btcPubkey || !timelockHeight || !depositTxid) {
    throw new Error("Position is missing Bitcoin metadata needed for release.");
  }

  emit({ type: "preparing", step: "building" });
  const protocolPubkey = config.bitcoin.protocolPubkey;
  if (!protocolPubkey) throw new Error("NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY not configured");

  const relayerUrl = config.services.relayerUrl;
  if (!relayerUrl) throw new Error("NEXT_PUBLIC_RELAYER_URL not configured");

  const p2wsh = deriveP2WSH(protocolPubkey, btcPubkey, timelockHeight);
  const feeSat = params.feeSat ?? (await estimateReleaseFee(config.bitcoin.apiUrl));

  const psbt = buildReleasePsbt({
    txidHex: depositTxid,
    vout: position.vout ?? 0,
    amountSat: Number(BigInt(position.collateralSats)),
    scriptPubKey: p2wsh.scriptPubKey,
    redeemScript: p2wsh.redeemScript,
    recipientAddress: recipient,
    feeSat,
  });

  emit({ type: "preparing", step: "merkle_path" });
  const commitmentHex = BigInt(position.commitment).toString(16).padStart(64, "0");
  const qs =
    position.leafIndex !== undefined
      ? `?leafIndex=${position.leafIndex}&commitment=${commitmentHex}`
      : `?commitment=${commitmentHex}`;
  const pathRes = await fetch(`${relayerUrl}/merkle-path${qs}`);
  if (!pathRes.ok) {
    const pb = (await pathRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Merkle path fetch failed: ${pb.error ?? pathRes.status}`);
  }
  const { pathElements, pathIndices, root: merkleRoot } = (await pathRes.json()) as {
    pathElements: string[];
    pathIndices: number[];
    root: string;
  };

  emit({ type: "proving" });
  const { secret, nonce } = positionKeys(seed, position);
  const zeroDebtInput: ZeroDebtInput = {
    collateral_satoshis: position.collateralSats,
    secret: secret.toString(),
    nonce: nonce.toString(),
    path_elements: pathElements,
    path_indices: pathIndices,
    merkle_root: merkleRoot,
  };
  const { raw: zkRaw } = await proveZeroDebt(zeroDebtInput);

  emit({ type: "preparing", step: "cosign" });
  const cosignRes = await fetch("/api/cosign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      psbt: psbt.toBase64(),
      commitment: commitmentHex,
      zkProof: { proof: zkRaw.proof, publicSignals: zkRaw.publicSignals },
    }),
  });
  if (!cosignRes.ok) {
    const cbody = (await cosignRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(`Co-sign failed: ${cbody.error ?? cosignRes.status}`);
  }
  const { signedPsbt: protocolSignedPsbt } = (await cosignRes.json()) as { signedPsbt: string };

  emit({ type: "awaiting_signature", wallet: "bitcoin" });
  const userSignedPsbt = await signPsbt(psbt.toBase64());

  emit({ type: "preparing", step: "broadcasting" });
  const txHex = finalizePathA(protocolSignedPsbt, userSignedPsbt, protocolPubkey, btcPubkey);
  const broadcastRes = await fetch(`${config.bitcoin.apiUrl}/tx`, { method: "POST", body: txHex });
  if (!broadcastRes.ok) {
    const errText = await broadcastRes.text().catch(() => String(broadcastRes.status));
    throw new Error(`Broadcast failed: ${errText}`);
  }
  const btcTxid = await broadcastRes.text();

  savePosition({ ...position, status: "released", releaseTxid: btcTxid, releaseAddress: recipient });
  emit({ type: "settled" });
  return { btcTxid };
}
