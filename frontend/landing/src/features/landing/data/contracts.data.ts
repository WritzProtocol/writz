export type LedgerEntry = { name: string; role: string; address: string };

// From contracts/deployments/testnet.md and defindex-vault-testnet.md.
export const ledger: LedgerEntry[] = [
  { name: "bitcoin-spv", role: "Verifies Bitcoin transactions on Stellar", address: "CAHHY4S4WCIFU4LBSKBI3IP6A4QYR2COV6EACDEBXGPJFDWBJWGOMCLP" },
  { name: "zk-verifier", role: "Checks the zero-knowledge proofs", address: "CB5XAP6MF2GVVFATFTVCKVEXUODWWRQP4B3QFDMRTM55REP7N2YMXEUD" },
  { name: "commitment-tree", role: "Keeps positions private", address: "CAQBLCAPGXXCZTJDAJLY7E4PTJYGR6CY4YWH4JSJKFXYIHW3GANP6RFM" },
  { name: "private-lend", role: "Runs the loans", address: "CA3T7T2S7HV27BXO7OLIHSMGAMQ37BMOOUHQLTBGUQVL4B6Y2CDJPHHX" },
  { name: "Earn vault", role: "Holds Earn deposits", address: "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S" },
];

export const explorerUrl = (address: string) =>
  `https://stellar.expert/explorer/testnet/contract/${address}`;
