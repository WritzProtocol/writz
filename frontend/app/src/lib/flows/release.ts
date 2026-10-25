import { Buffer } from "buffer";
import * as bitcoin from "bitcoinjs-lib";
import { config } from "@/config";
import {
  deriveP2WSH,
  estimateReleaseFee,
  finalizePathA,
  getBitcoinNetwork,
  isAddressForNetwork,
} from "@/lib/bitcoin/address";
import {
  getReleasePsbt,
  internalTxid,
  readPosition,
  writzLendClient,
  type ChainPosition,
} from "@/lib/contracts/writzLend";
import type { Emit } from "@/lib/flow/engine";
import { savePosition, type Position } from "@/lib/position";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import { simulateWritzLend } from "./submit";
import { submitTrackedTx } from "./positionTx";

export type ReleaseBlocker = "missing_details" | "no_wallet" | "wrong_account" | "wrong_network";

/** Why this position can't be released with the connected Bitcoin wallet, or null when it can. */
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

/**
 * Where a release pays: the native SegWit address of the deposit's own
 * Bitcoin key. The relayer builds the release to this address from the key
 * stored on chain, so the BTC can only go back to the key that locked it.
 */
export function releaseAddressOf(btcPubkeyHex: string, network: bitcoin.networks.Network = getBitcoinNetwork()): string {
  const { address } = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(btcPubkeyHex, "hex"), network });
  if (!address) throw new Error("Could not derive the release address.");
  return address;
}

export const releaseFeeEstimate = () => estimateReleaseFee(config.bitcoin.apiUrl);

export interface ReleaseQuote {
  /** The deposit output the release spends. */
  vout: number;
  amountSat: number;
  feeSat: number;
  recipient: string;
}

/**
 * Checks the relayer's half-signed release before the user signs it: one
 * input spending this deposit's Writz output, one output paying the deposit
 * key's own address, and the protocol's signature on the input. Anything else
 * is refused, so a wrong or tampered PSBT never reaches the wallet.
 */
export function checkReleasePsbt(
  psbt: bitcoin.Psbt,
  expected: { txid: string; protocolPubkey: string; userPubkey: string; timelockHeight: number; network?: bitcoin.networks.Network },
): ReleaseQuote {
  const network = expected.network ?? getBitcoinNetwork();
  const lock = deriveP2WSH(expected.protocolPubkey, expected.userPubkey, expected.timelockHeight);
  const recipient = releaseAddressOf(expected.userPubkey, network);
  if (psbt.txInputs.length !== 1 || psbt.txOutputs.length !== 1) throw new Error("ReleaseMismatch: shape");

  const input = psbt.txInputs[0];
  const data = psbt.data.inputs[0];
  if (Buffer.from(input.hash).reverse().toString("hex") !== expected.txid.toLowerCase()) {
    throw new Error("ReleaseMismatch: input");
  }
  if (!data.witnessUtxo || !Buffer.from(data.witnessUtxo.script).equals(lock.scriptPubKey)) {
    throw new Error("ReleaseMismatch: lock");
  }
  if (!data.witnessScript || !Buffer.from(data.witnessScript).equals(lock.redeemScript)) {
    throw new Error("ReleaseMismatch: script");
  }
  const protocolKey = Buffer.from(expected.protocolPubkey, "hex");
  if (!data.partialSig?.some((s) => Buffer.from(s.pubkey).equals(protocolKey))) {
    throw new Error("ReleaseMismatch: protocol signature");
  }

  const out = psbt.txOutputs[0];
  if (!Buffer.from(out.script).equals(bitcoin.address.toOutputScript(recipient, network))) {
    throw new Error("ReleaseMismatch: recipient");
  }
  const amountSat = Number(data.witnessUtxo.value);
  const feeSat = amountSat - Number(out.value);
  if (feeSat < 0) throw new Error("ReleaseMismatch: amount");
  return { vout: input.index, amountSat, feeSat, recipient };
}

export interface ReleaseDeps {
  read(txid: string): Promise<ChainPosition | null>;
  getReleasePsbt(txid: string): Promise<Buffer | null>;
  /** Closes a position that was never borrowed against, so the relayer co-signs its release. */
  close(input: { txid: string; owner: string; signTransaction: SignTransaction; emit: Emit }): Promise<void>;
  broadcast(txHex: string): Promise<string>;
  sleep(ms: number): Promise<void>;
}

async function closeUnborrowed({ txid, owner, signTransaction, emit }: Parameters<ReleaseDeps["close"]>[0]) {
  const client = writzLendClient(owner);
  const tx = await simulateWritzLend(() => client.repay({ repayer: owner, txid: internalTxid(txid), usdc_amount: 0n }));
  // `submitTrackedTx` settles the flow; the release carries on past it.
  await submitTrackedTx({
    kind: "repay",
    owner,
    tx,
    signTransaction,
    emit: (e) => {
      if (e.type !== "settled") emit(e);
    },
  });
}

export const releaseDeps: ReleaseDeps = {
  read: readPosition,
  getReleasePsbt,
  close: closeUnborrowed,
  async broadcast(txHex) {
    const res = await fetch(`${config.bitcoin.apiUrl}/tx`, { method: "POST", body: txHex });
    if (!res.ok) {
      const errText = await res.text().catch(() => String(res.status));
      throw new Error(`Broadcast failed: ${errText}`);
    }
    return (await res.text()).trim();
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * How long the release waits for the relayer to co-sign. It usually does so
 * within a poll or two of the repay, but on a busy testnet its publish can be
 * dropped and land on its next attempt, minutes later, so the wait is generous.
 * Past it the release stops with `ReleaseNotCosigned`, which the release panel
 * shows as a resumable state: checking again reads the chain, finds the loan
 * already closed and only polls for the signature.
 */
export const COSIGN_POLL_MS = 5_000;
export const COSIGN_WAIT_MS = 10 * 60_000;
const COSIGN_POLLS = COSIGN_WAIT_MS / COSIGN_POLL_MS;

/** The release stopped waiting for the co-signature; the loan is closed and checking again resumes it. */
export const isReleaseNotCosigned = (error: unknown): boolean =>
  error instanceof Error && error.message === "ReleaseNotCosigned";

/**
 * Releases a repaid position's BTC. Repaying in full closes the position on
 * `writz-lend`; the relayer's repay watcher then builds the cooperative
 * release, co-signs it with the protocol key and publishes it on chain
 * (`publish_release_psbt`). This reads it back with `get_release_psbt`,
 * checks it, has the user sign in their Bitcoin wallet and broadcasts. A
 * position that never borrowed is closed first with a zero repayment.
 */
export async function releaseBtc(params: {
  position: Position;
  signPsbt: (psbtBase64: string) => Promise<string>;
  /** The Stellar account that owns the position; it signs the closing transaction when one is needed. */
  stellarAddress: string;
  signTransaction: SignTransaction;
  emit: Emit;
  deps?: ReleaseDeps;
}): Promise<{ btcTxid: string; recipient: string }> {
  const { position, signPsbt, stellarAddress, signTransaction, emit } = params;
  const deps = params.deps ?? releaseDeps;
  const protocolPubkey = config.bitcoin.protocolPubkey;
  if (!protocolPubkey) throw new Error("NEXT_PUBLIC_PROTOCOL_BTC_PUBKEY not configured");

  emit({ type: "preparing", step: "reading" });
  const chain = await deps.read(position.txid);
  if (!chain) throw new Error("PositionNotFound");
  if (chain.depositor !== stellarAddress) throw new Error("Unauthorized");
  if (chain.status === "liquidated") throw new Error("PositionNotActive");
  if (chain.status === "active") {
    if (chain.debtStroops > 0n) throw new Error("LoanNotRepaid");
    await deps.close({ txid: position.txid, owner: stellarAddress, signTransaction, emit });
  }

  emit({ type: "preparing", step: "cosign" });
  let raw: Buffer | null = null;
  for (let i = 0; !raw; i++) {
    raw = await deps.getReleasePsbt(position.txid);
    if (raw) break;
    if (i >= COSIGN_POLLS) throw new Error("ReleaseNotCosigned");
    await deps.sleep(COSIGN_POLL_MS);
  }

  const network = getBitcoinNetwork();
  const psbt = bitcoin.Psbt.fromBuffer(raw, { network });
  const quote = checkReleasePsbt(psbt, {
    txid: position.txid,
    protocolPubkey,
    userPubkey: chain.userPubkey,
    timelockHeight: chain.timelockHeight,
    network,
  });

  emit({ type: "awaiting_signature", wallet: "bitcoin" });
  const protocolSigned = psbt.toBase64();
  const userSigned = await signPsbt(protocolSigned);

  emit({ type: "preparing", step: "broadcasting" });
  const txHex = finalizePathA(protocolSigned, userSigned, protocolPubkey, chain.userPubkey);
  const btcTxid = await deps.broadcast(txHex);

  savePosition({ ...position, status: "released", vout: quote.vout, releaseTxid: btcTxid, releaseAddress: quote.recipient });
  emit({ type: "settled" });
  return { btcTxid, recipient: quote.recipient };
}
