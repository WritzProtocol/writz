/**
 * Repay-watcher event handler.
 *
 * On a `repay_full` event: loads the position, reconstructs the redeem
 * script and P2WSH vout from on-chain + Bitcoin data, builds the Path A
 * release PSBT, co-signs it with the resolved protocol signer (KMS,
 * preferred, or the testnet/signet-only raw-WIF fallback — see
 * `resolveProtocolSigner` in `@writz/bitcoin-script`), and publishes the
 * half-signed PSBT on-chain via `publish_release_psbt` — so the user can
 * retrieve and finish signing it even if the rest of the Writz stack is
 * down.
 *
 * Reuses `bitcoin-script`'s builders rather than reimplementing PSBT
 * construction a third time (the frontend's `address.ts` already carries a
 * documented duplication burden versus the same source — see that file's
 * own comment).
 */
import { Keypair, Transaction as StellarTransaction } from "@stellar/stellar-sdk";
import * as btc from "bitcoinjs-lib";
import {
  type ProtocolSigner,
  deriveDepositAddress,
  buildReleaseTransaction,
  pubkeyToP2WPKHAddress,
} from "@writz/bitcoin-script";
import { Client as PrivateLendClient, type Position } from "../contracts/privateLend.js";
import { EsploraClient } from "../bitcoin/esplora.js";
import { parseOutput } from "../bitcoin/tx.js";
import { config } from "../config.js";

// A widely-used, publicly documented placeholder account with no known
// private key — safe for read-only / simulation-only contract calls that
// never submit a transaction. Same value used in relayer/src/routes/merkle.ts
// and frontend/src/app/api/cosign/route.ts's READ_ONLY_SOURCE.
const READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

export function getBitcoinNetwork(): btc.networks.Network {
  return config.bitcoinNetwork === "mainnet" ? btc.networks.bitcoin : btc.networks.testnet;
}

function readOnlyClient(): PrivateLendClient {
  return new PrivateLendClient({
    contractId: config.privateLendId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.stellarRpcUrl,
    allowHttp: config.stellarRpcUrl.startsWith("http://"),
    publicKey: READ_ONLY_SOURCE,
  });
}

/**
 * Finds the output index whose scriptPubKey matches `scriptPubKeyHex` in a
 * raw transaction. `parseOutput` (relayer/src/bitcoin/tx.ts) needs an index
 * up front — this is the reverse lookup, bounded at a generous 64 outputs.
 */
function findOutputIndex(rawTxHex: string, scriptPubKeyHex: string): number {
  for (let i = 0; i < 64; i++) {
    let out: { scriptPubKey: string };
    try {
      out = parseOutput(rawTxHex, i);
    } catch {
      break;
    }
    if (out.scriptPubKey.toLowerCase() === scriptPubKeyHex.toLowerCase()) return i;
  }
  throw new Error(`no output matching scriptPubKey ${scriptPubKeyHex} found`);
}

/** Reverses a 32-byte hex string's byte order (internal <-> display). */
function reverseHex(hex: string): string {
  const bytes = hex.match(/../g);
  if (!bytes) return hex;
  return bytes.reverse().join("");
}

export interface HandlerDeps {
  esplora: EsploraClient;
  signer: ProtocolSigner;
  relayerKeypair: Keypair;
}

/**
 * Handles a single `repay_full` event for the given txid (internal byte
 * order, as stored on-chain). Idempotent: if a PSBT has already been
 * published for this position, does nothing.
 */
export async function handleRepayFull(
  txidInternal: Buffer,
  deps: HandlerDeps,
): Promise<void> {
  const readClient = readOnlyClient();
  const network = getBitcoinNetwork();

  const { result: position } = await readClient.get_position({ txid: txidInternal });
  if (!position) {
    throw new Error(`repay_full event for unknown position ${txidInternal.toString("hex")}`);
  }

  const { result: alreadyPublished } = await readClient.get_release_psbt({
    txid: txidInternal,
  });
  if (alreadyPublished) {
    return; // Idempotent — already handled (e.g. a re-processed event after a crash).
  }

  const txidDisplay = reverseHex(txidInternal.toString("hex"));

  // Sanity-check: the redeem script we're about to build must match the
  // scriptPubKey recorded on-chain at deposit time. If it doesn't, something
  // is wrong (e.g. a protocol key rotation without a matching migration) —
  // fail loudly rather than co-sign a release for the wrong script.
  const deposit = deriveDepositAddress(
    {
      protocolPubkey: deps.signer.publicKey,
      userPubkey: position.user_pubkey,
      timelockHeight: position.timelock_height,
    },
    network,
  );
  if (!deposit.scriptPubKey.equals(position.p2wsh_script_pubkey)) {
    throw new Error(
      `derived scriptPubKey for txid ${txidDisplay} does not match the on-chain position — ` +
        "refusing to co-sign (possible protocol key mismatch)",
    );
  }

  const rawTxFull = await deps.esplora.getRawTx(txidDisplay);
  const vout = findOutputIndex(rawTxFull, position.p2wsh_script_pubkey.toString("hex"));

  const recipientAddress = pubkeyToP2WPKHAddress(position.user_pubkey, network);

  const psbt = buildReleaseTransaction({
    txidHex: txidDisplay,
    vout,
    amountSat: Number(position.btc_satoshis),
    scriptPubKey: deposit.scriptPubKey,
    redeemScript: deposit.redeemScript,
    recipientAddress,
    feeSat: config.releaseFeeSat,
    network,
  });

  // Protocol partial signature only — the user must add their own before
  // this can be finalized and broadcast. Matches the existing
  // frontend /api/cosign route's behavior (never auto-finalizes).
  await psbt.signInputAsync(0, deps.signer);

  const writeClient = new PrivateLendClient({
    contractId: config.privateLendId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.stellarRpcUrl,
    allowHttp: config.stellarRpcUrl.startsWith("http://"),
    publicKey: deps.relayerKeypair.publicKey(),
  });

  const signTransaction = async (xdr: string) => {
    const tx = new StellarTransaction(xdr, config.networkPassphrase);
    tx.sign(deps.relayerKeypair);
    return { signedTxXdr: tx.toXDR(), signerAddress: deps.relayerKeypair.publicKey() };
  };

  const assembled = await writeClient.publish_release_psbt({
    relayer: deps.relayerKeypair.publicKey(),
    txid: txidInternal,
    psbt: psbt.toBuffer(),
  });
  await assembled.signAndSend({ signTransaction });
}

export type { Position };
