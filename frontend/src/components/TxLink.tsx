/**
 * Renders a transaction hash as a truncated, clickable link to its block
 * explorer (Stellar testnet or Bitcoin signet). Pass the full URL via `url`.
 */
export function TxLink({ url, hash }: { url: string; hash: string }) {
  const short = hash.length > 18 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-amber underline-offset-2 hover:underline"
    >
      {short} ↗
    </a>
  );
}
