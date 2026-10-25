/**
 * Generates a fresh key for the CCTP relay's Base Sepolia account.
 *
 *   bun scripts/cctp-relay-keygen.ts              prints the key and the address to fund
 *   bun scripts/cctp-relay-keygen.ts --key-only   prints only the key on stdout, for piping into a secret store;
 *                                                 the address goes to stderr, so the terminal shows only that
 *
 * The account only pays gas for `receiveMessage` on Base Sepolia and never
 * holds the transferred USDC. Never commit the key, and never use an account
 * that holds anything on a mainnet.
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const key = generatePrivateKey();
const { address } = privateKeyToAccount(key);

if (process.argv.includes("--key-only")) {
  process.stdout.write(key);
  process.stderr.write(`CCTP relay address (fund this with Base Sepolia ETH): ${address}\n`);
} else {
  console.log(`CCTP_RELAY_EVM_KEY=${key}`);
  console.log(`CCTP relay address (fund this with Base Sepolia ETH): ${address}`);
  console.log("Store the key in the deployment's secrets only. Do not commit it or paste it anywhere else.");
}
