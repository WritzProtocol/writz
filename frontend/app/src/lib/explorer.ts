import { config } from "@/config";

/** Stellar explorer URL for a transaction hash, on this deploy's network. */
export function stellarTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/${config.explorerNetwork}/tx/${hash}`;
}

export function stellarContractUrl(id: string): string {
  return `https://stellar.expert/explorer/${config.explorerNetwork}/contract/${id}`;
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

export function stellarAccountUrl(address: string): string {
  return `https://stellar.expert/explorer/${config.explorerNetwork}/account/${address}`;
}

export function btcAddressUrl(address: string): string {
  const net = config.bitcoin.network;
  const prefix = net === "mainnet" ? "" : `${net}/`;
  return `https://mempool.space/${prefix}address/${address}`;
}
