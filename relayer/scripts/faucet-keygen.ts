/**
 * Generates a fresh key for the Signet faucet's hot wallet.
 *
 *   bun scripts/faucet-keygen.ts              prints the WIF and the address to fund
 *   bun scripts/faucet-keygen.ts --wif-only   prints only the WIF, for piping into a secret store
 *
 * The WIF is a Signet (testnet-version) key and is refused on mainnet. Never
 * commit it, and never reuse PROTOCOL_SIGNING_KEY: the relayer refuses to
 * start the faucet with the protocol key.
 */
import * as btc from "bitcoinjs-lib";
import { generateKeyPair, pubkeyToP2WPKHAddress } from "@writz/bitcoin-script";

const key = generateKeyPair(btc.networks.testnet);
const wif = key.signer.toWIF();

if (process.argv.includes("--wif-only")) {
  process.stdout.write(wif);
} else {
  console.log(`FAUCET_SIGNET_WIF=${wif}`);
  console.log(`Faucet address (fund this on Signet): ${pubkeyToP2WPKHAddress(key.publicKey, btc.networks.testnet)}`);
  console.log("Store the WIF in the deployment's secrets only. Do not commit it or paste it anywhere else.");
}
