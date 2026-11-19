export type LedgerEntry = { name: string; role: string; address: string };

// From contracts/deployments/testnet.md and defindex-vault-testnet.md.
// The protocol is bitcoin-spv + writz-lend.
export const ledger: LedgerEntry[] = [
  { name: "bitcoin-spv", role: "Verifies Bitcoin transactions on Stellar", address: "CCCQXNWQGLAAVGOB7YCZNWNHIC456LZXML55Z65OOXRTAZ5BIPNIZ3HB" },
  { name: "writz-lend", role: "Runs the loans", address: "CBI4AGULYDCCNYHKAC5HBCIF7X3YEZCYFXLYVLQWUOKPLXWO7LJCKG4Q" },
  { name: "Earn vault", role: "Holds Earn deposits", address: "CBMHGL7GGGHODEDDJ5H2LKJEFHJWBRSQUKOXMC4FKOFDZK5HBKW6PI2S" },
];

export const explorerUrl = (address: string) =>
  `https://stellar.expert/explorer/testnet/contract/${address}`;
