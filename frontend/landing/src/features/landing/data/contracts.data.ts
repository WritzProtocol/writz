export type LedgerEntry = { name: string; role: string; address: string };

// From contracts/deployments/testnet.md and defindex-vault-testnet.md.
export const ledger: LedgerEntry[] = [
  { name: "bitcoin-spv", role: "Verifies Bitcoin transactions on Stellar", address: "CB2BD6QCSZVNZN5NLI7C5NF356WXVJDSXT6LVAQFWHHS4SZ4NCKKNIVA" },
  { name: "zk-verifier", role: "Checks the zero-knowledge proofs", address: "CBNZU23QGCZATJB2QMNF2K6IST2SVP7FSGCKASQNBULTWDWGANDBYLFY" },
  { name: "commitment-tree", role: "Keeps positions private", address: "CDQCTFO3FK3M47QS47O2A4WLNPSQAQBSXBFPJ6RZEHFO5D7RY34FSBBP" },
  { name: "private-lend", role: "Runs the loans", address: "CAAWVMDRUPEJNELSQ6RU2VMVX5EJLQ2E77T7IXDWGMW4DGSNAGECGSWR" },
  { name: "Earn vault", role: "Holds Earn deposits", address: "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S" },
];

export const explorerUrl = (address: string) =>
  `https://stellar.expert/explorer/testnet/contract/${address}`;
