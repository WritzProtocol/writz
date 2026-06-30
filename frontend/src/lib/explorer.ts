import { config } from "@/config";

/** Stellar testnet explorer URL for a transaction hash. */
export function stellarTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

/**
 * Bitcoin explorer URL for a txid, matching the configured network.
 * mempool.space paths: mainnet `/tx`, others `/<network>/tx` (e.g. signet).
 */
export function btcTxUrl(txid: string): string {
  const net = config.bitcoin.network;
  const prefix = net === "mainnet" ? "" : `${net}/`;
  return `https://mempool.space/${prefix}tx/${txid}`;
}
