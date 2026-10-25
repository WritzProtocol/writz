import { Buffer } from "buffer";
import { Address, nativeToScVal, rpc } from "@stellar/stellar-sdk";
import { config, requireContract } from "@/config";
import type { Emit } from "@/lib/flow/engine";
import { signAndSubmit } from "@/lib/flow/stellarTx";
import type { SignTransaction } from "@/lib/wallet/WalletProvider";
import { callContract } from "./call";

/** Circle's domain for Stellar; every burn from here is attested under it. */
export const STELLAR_DOMAIN = 27;
/** Outbound from Stellar always executes at Standard, whatever is requested. */
const STANDARD_FINALITY = 2000;
/** About 16 minutes of ledgers for the allowance, enough to sign the burn after it. */
const ALLOWANCE_LEDGERS = 200;

const tmmId = () => requireContract(config.receive.cctp.tokenMessengerMinter, "CCTP TokenMessengerMinter");
const usdcId = () => requireContract(config.contracts.usdcToken, "USDC token");

export const isEvmAddress = (address: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(address);

/** An EVM address as CCTP's 32-byte recipient: left-padded with zeros. */
export function evmAddressToBytes32(address: string): Buffer {
  if (!isEvmAddress(address)) throw new Error("Enter a 0x address with 40 hex characters.");
  return Buffer.concat([Buffer.alloc(12), Buffer.from(address.slice(2), "hex")]);
}

/**
 * Stroops CCTP actually burns: messages carry 6 decimals, so the seventh
 * Stellar digit stays in the wallet. Rounding here keeps the amount shown
 * equal to the amount minted.
 */
export const burnableStroops = (stroops: bigint): bigint => stroops - (stroops % 10n);

/** The fee budget for `amount` at `minimumFeeBp`, rounded up so Iris never delays the transfer for it. */
export function maxFeeFor(amount: bigint, minimumFeeBp: number): bigint {
  const bp = BigInt(Math.ceil(minimumFeeBp));
  return (amount * bp + 9_999n) / 10_000n;
}

/** Circle's minimum fee for a Standard transfer from Stellar to the destination, in basis points. */
export async function fetchMinimumFeeBp(fetchImpl: typeof fetch = fetch): Promise<number> {
  const { irisUrl, destination } = config.receive.cctp;
  const res = await fetchImpl(`${irisUrl}/v2/burn/USDC/fees/${STELLAR_DOMAIN}/${destination.domain}`);
  if (!res.ok) throw new Error(`Circle fee lookup failed (${res.status}).`);
  const tiers = (await res.json()) as { finalityThreshold: number; minimumFee: number }[];
  const standard = tiers.find((t) => t.finalityThreshold === STANDARD_FINALITY);
  if (!standard) throw new Error("Circle returned no Standard fee.");
  return standard.minimumFee;
}

async function allowance(owner: string): Promise<bigint> {
  const tx = await callContract<bigint>({
    contractId: usdcId(),
    method: "allowance",
    args: [Address.fromString(owner).toScVal(), Address.fromString(tmmId()).toScVal()],
  });
  return BigInt(tx.result);
}

export interface SendResult {
  /** Absent when an earlier allowance already covered the amount. */
  approveHash?: string;
  burnHash: string;
  /** Stroops burned, which is what arrives less `maxFee`. */
  amount: bigint;
  maxFee: bigint;
}

/**
 * Send USDC from the borrower's Stellar wallet to `recipient` on the
 * destination chain: an allowance for the TokenMessengerMinter when needed,
 * then `deposit_for_burn`. Anyone can complete the mint (destination caller
 * zero); the relay does it so the borrower needs no wallet there.
 */
export async function sendUsdcToChain(params: {
  owner: string;
  amountStroops: bigint;
  recipient: string;
  signTransaction: SignTransaction;
  emit?: Emit;
  fetchImpl?: typeof fetch;
}): Promise<SendResult> {
  const { owner, recipient, signTransaction, emit, fetchImpl } = params;
  const mintRecipient = evmAddressToBytes32(recipient);
  const amount = burnableStroops(params.amountStroops);
  if (amount <= 0n) throw new Error("Enter an amount of at least 0.000001 USDC.");

  emit?.({ type: "preparing", step: "reading" });
  const [feeBp, allowed] = await Promise.all([fetchMinimumFeeBp(fetchImpl), allowance(owner)]);
  const maxFee = maxFeeFor(amount, feeBp);

  let approveHash: string | undefined;
  if (allowed < amount) {
    emit?.({ type: "preparing", step: "building" });
    const server = new rpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
    const { sequence } = await server.getLatestLedger();
    const approve = await callContract<null>({
      contractId: usdcId(),
      method: "approve",
      publicKey: owner,
      args: [
        Address.fromString(owner).toScVal(),
        Address.fromString(tmmId()).toScVal(),
        nativeToScVal(amount, { type: "i128" }),
        nativeToScVal(sequence + ALLOWANCE_LEDGERS, { type: "u32" }),
      ],
    });
    approveHash = (await signAndSubmit(approve, { signTransaction, emit })).hash;
  }

  emit?.({ type: "preparing", step: "building" });
  const burn = await callContract<null>({
    contractId: tmmId(),
    method: "deposit_for_burn",
    publicKey: owner,
    args: [
      Address.fromString(owner).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
      nativeToScVal(config.receive.cctp.destination.domain, { type: "u32" }),
      nativeToScVal(mintRecipient),
      Address.fromString(usdcId()).toScVal(),
      nativeToScVal(Buffer.alloc(32)),
      nativeToScVal(maxFee, { type: "i128" }),
      nativeToScVal(STANDARD_FINALITY, { type: "u32" }),
    ],
  });
  const { hash: burnHash } = await signAndSubmit(burn, { signTransaction, emit });
  emit?.({ type: "settled", hash: burnHash });
  return { approveHash, burnHash, amount, maxFee };
}

export type Attestation =
  | { status: "pending" }
  | { status: "complete"; message: string; attestation: string };

/** Circle's attestation for a Stellar burn; "pending" until Iris has signed it (and while it 404s at first). */
export async function fetchAttestation(burnHash: string, fetchImpl: typeof fetch = fetch): Promise<Attestation> {
  const hash = burnHash.toLowerCase();
  const res = await fetchImpl(
    `${config.receive.cctp.irisUrl}/v2/messages/${STELLAR_DOMAIN}?transactionHash=${hash}`,
  );
  if (res.status === 404) return { status: "pending" };
  if (!res.ok) throw new Error(`Circle attestation lookup failed (${res.status}).`);
  const body = (await res.json()) as { messages?: { status: string; message: string; attestation: string }[] };
  const m = body.messages?.[0];
  if (!m || m.status !== "complete" || !m.attestation || m.attestation === "PENDING") return { status: "pending" };
  return { status: "complete", message: m.message, attestation: m.attestation };
}

export const destinationTxUrl = (hash: string): string => `${config.receive.cctp.destination.explorerUrl}/tx/${hash}`;
