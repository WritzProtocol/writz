export type LedgerEntry = { name: string; role: string; address: string };

// From contracts/deployments/testnet.md and defindex-vault-testnet.md.
// The protocol (v1) is bitcoin-spv + writz-lend. The privacy edition's
// contracts (zk-verifier, commitment-tree) are a separate edition in progress
// and are not listed here.
export const ledger: LedgerEntry[] = [
  { name: "bitcoin-spv", role: "Verifies Bitcoin transactions on Stellar", address: "NEWSPVID" },
  { name: "writz-lend", role: "Runs the loans", address: "NEWLENDID" },
  { name: "Earn vault", role: "Holds Earn deposits", address: "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S" },
];

export const explorerUrl = (address: string) =>
  `https://stellar.expert/explorer/testnet/contract/${address}`;
