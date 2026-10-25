import { buildPayment, type SignetKey, type Utxo } from "./key";

/** Signet's relay floor is 1 sat/vB; 2 confirms in the next block or two without overpaying. */
export const MIN_FEE_RATE = 2;
export const MAX_FEE_RATE = 25;

export interface EsploraIo {
  apiUrl: string;
  fetch?: typeof fetch;
}

const base = (apiUrl: string) => apiUrl.replace(/\/+$/, "");

/** Coins at `address`, confirmed or not: Signet coins are spendable from the mempool. */
export async function addressUtxos(address: string, io: EsploraIo): Promise<Utxo[]> {
  const doFetch = io.fetch ?? fetch;
  const res = await doFetch(`${base(io.apiUrl)}/address/${address}/utxo`);
  if (!res.ok) throw new Error(`Bitcoin API error ${res.status}`);
  const list = (await res.json()) as { txid: string; vout: number; value: number }[];
  return list.map(({ txid, vout, value }) => ({ txid, vout, value }));
}

/** Esplora's estimate for a confirmation within 3 blocks, kept between the Signet floor and a ceiling. */
export async function feeRate(io: EsploraIo): Promise<number> {
  const doFetch = io.fetch ?? fetch;
  try {
    const res = await doFetch(`${base(io.apiUrl)}/fee-estimates`);
    if (!res.ok) return MIN_FEE_RATE;
    const est = (await res.json()) as Record<string, number>;
    const v = est["3"] ?? est["6"] ?? MIN_FEE_RATE;
    return Math.min(MAX_FEE_RATE, Math.max(MIN_FEE_RATE, Math.ceil(v)));
  } catch {
    return MIN_FEE_RATE;
  }
}

export async function broadcast(txHex: string, io: EsploraIo): Promise<string> {
  const doFetch = io.fetch ?? fetch;
  const res = await doFetch(`${base(io.apiUrl)}/tx`, { method: "POST", body: txHex });
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(`The Bitcoin network refused the transaction: ${text.slice(0, 160)}`);
  return text;
}

/** Sends `amountSats` from the test key to `to` and returns the txid. */
export async function sendFromKey(key: SignetKey, to: string, amountSats: number, io: EsploraIo): Promise<string> {
  const [utxos, rate] = await Promise.all([addressUtxos(key.address, io), feeRate(io)]);
  const payment = buildPayment({ key, utxos, to, amountSats, feeRate: rate });
  const txid = await broadcast(payment.txHex, io);
  return /^[0-9a-f]{64}$/i.test(txid) ? txid.toLowerCase() : payment.txid;
}

/** Spendable sats at `address` from Esplora's address summary, unconfirmed included. */
export async function addressBalance(address: string, io: EsploraIo): Promise<number> {
  const doFetch = io.fetch ?? fetch;
  const res = await doFetch(`${base(io.apiUrl)}/address/${address}`);
  if (!res.ok) throw new Error(`Bitcoin API error ${res.status}`);
  const a = (await res.json()) as {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
    mempool_stats?: { funded_txo_sum: number; spent_txo_sum: number };
  };
  const m = a.mempool_stats ?? { funded_txo_sum: 0, spent_txo_sum: 0 };
  return a.chain_stats.funded_txo_sum - a.chain_stats.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum;
}

/** True once `txid` has at least one confirmation. */
export async function isConfirmed(txid: string, io: EsploraIo): Promise<boolean> {
  const doFetch = io.fetch ?? fetch;
  const res = await doFetch(`${base(io.apiUrl)}/tx/${txid}/status`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Bitcoin API error ${res.status}`);
  return Boolean(((await res.json()) as { confirmed?: boolean }).confirmed);
}
