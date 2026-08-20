# Manual Emergency Recovery (Path B)

**A safe, copy-pasteable reference for reclaiming BTC via the CLTV timelock, without relying on the Writz frontend.**

Path B lets a user recover their locked BTC unilaterally once the CLTV timelock has expired - no Writz co-signature needed (see [Bitcoin Side](./bitcoin-side.md#spending-path-b-the-emergency-release)). `bitcoin-script`'s `buildEmergencyTransaction`/`finalizePathB` build this transaction correctly and are tested - **but nothing in the frontend calls them yet.** There is currently no in-app UI for Path B; this document is the only recovery path that exists today, and it requires running the Node.js script below yourself. Closing that gap with a guided in-app flow is specified in `docs/design/guided-recovery-spec.md` - until that ships, this document is not a "fallback for when the frontend is unavailable," it is the only path, full stop.

**Do not build this transaction by hand in a generic wallet UI.** The most common way to get this wrong is `nSequence`: many wallets default to `0xFFFFFFFF`, which silently disables `OP_CHECKLOCKTIMEVERIFY` - your transaction will be rejected by the network with no clear error, and it's easy to mistakenly conclude the timelock hasn't expired when it actually has. `bitcoin-script`'s `buildEmergencyTransaction`/`finalizePathB` already set this correctly and - unlike a hand-built PSBT - make it **impossible to override**: `SpendParams` has no caller-settable `sequence` field for this path, so there is no way to accidentally regress this into `0xFFFFFFFF`. Use the canonical implementation below instead of a generic wallet.

---

## What you need

- Your deposit's redeem script and P2WSH scriptPubKey (derivable from your BTC pubkey, the protocol pubkey, and the CLTV `timelockHeight` - see `bitcoin-script/src/address.ts`'s `deriveDepositAddress`, or read them back from `PositionDashboard`/your original deposit record).
- The funding transaction's txid and output index (`vout`), and the amount locked (satoshis).
- Your own Bitcoin private key (the one that derived your deposit).
- Confirmation that the current Bitcoin block height has passed `timelockHeight`.

## Reference script

```js
// Requires: bun add bitcoinjs-lib @bitcoinerlab/secp256k1 ecpair
// Run from a checkout of this repo so the local bitcoin-script package resolves,
// or `bun add file:./bitcoin-script` from elsewhere in this monorepo.
import * as bitcoin from 'bitcoinjs-lib';
import {
  buildEmergencyTransaction,
  finalizePathB,
  keyPairFromPrivkey,
} from '@writz/bitcoin-script';

const network = bitcoin.networks.testnet; // or bitcoin.networks.bitcoin for mainnet

const userKey = keyPairFromPrivkey(
  Buffer.from('<your 32-byte private key, hex>', 'hex'),
  network,
);

const spendParams = {
  txidHex: '<funding txid, display order>',
  vout: 0,
  amountSat: 89_631,
  scriptPubKey: Buffer.from('<34-byte P2WSH scriptPubKey, hex>', 'hex'),
  redeemScript: Buffer.from('<redeem script, hex>', 'hex'),
  recipientAddress: '<your own BTC address to receive the funds>',
  feeSat: 1_500, // estimate via your node's fee-rate API and the ~149 vbyte tx size
  network,
};

const timelockHeight = 700_000; // your deposit's CLTV height

const psbt = buildEmergencyTransaction(spendParams, timelockHeight);
psbt.signInput(0, userKey.signer);
finalizePathB(psbt, 0, userKey.publicKey);

const tx = psbt.extractTransaction();
console.log('Broadcast this raw tx hex:', tx.toHex());
```

Broadcast the resulting hex via any Bitcoin node or block explorer's "broadcast transaction" tool (e.g. `bitcoin-cli sendrawtransaction`, or Blockstream/mempool.space's broadcast page).

## Verifying before you broadcast

- Decode the raw tx (e.g. `bitcoin-cli decoderawtransaction <hex>`) and confirm `locktime` equals your `timelockHeight`, and the input's `sequence` is `4294967294` (`0xfffffffe`) - **not** `4294967295`.
- Confirm the current chain tip height is `>= timelockHeight`. If it isn't yet, the transaction will be rejected regardless of `nSequence` - this is expected, not a bug.
