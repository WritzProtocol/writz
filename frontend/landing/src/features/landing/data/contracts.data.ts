export type LedgerEntry = { name: string; role: string; address: string };

// From contracts/deployments/testnet.md and defindex-vault-testnet.md.
// The protocol (v1) is bitcoin-spv + writz-lend. The privacy edition's
// contracts (zk-verifier, commitment-tree) are a separate edition in progress
// and are not listed here.
export const ledger: LedgerEntry[] = [
  { name: "bitcoin-spv", role: "Verifies Bitcoin transactions on Stellar", address: "CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP" },
  { name: "writz-lend", role: "Runs the loans", address: "CA3T7T2S7HV27BXO7OLIHSMGAMQ37BMOOUHQLTBGUQVL4B6Y2CDJPHHX" },
  { name: "Earn vault", role: "Holds Earn deposits", address: "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S" },
];

export const explorerUrl = (address: string) =>
  `https://stellar.expert/explorer/testnet/contract/${address}`;
