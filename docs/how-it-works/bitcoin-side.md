---
title: "The Bitcoin Side"
---

**How your BTC is locked - and why nobody else can touch it.**

Before anything happens on Stellar, a Bitcoin transaction secures your collateral. This page explains the Bitcoin locking mechanism: what it is, how it works, and what the security guarantees are.

For how keeping BTC in your own script compares with wrapped Bitcoin and bridges, see [SPV vs Wrapped Bitcoin](/security/spv-vs-wrapped).

---

## The Core Idea: Rules Written Into Bitcoin

When you make a standard Bitcoin payment, you send BTC to an address, and the recipient can spend it with their private key. That is a simple rule: "this key can spend this output."

Bitcoin Script allows more complex rules. Writz uses a P2WSH - Pay to Witness Script Hash - which can encode multiple spending conditions. The address is a hash of a full script; to spend from it, you reveal the script and satisfy one of its conditions.

Writz's P2WSH script has exactly two conditions:

**Condition A (normal - loan repaid):**  
The BTC can be spent only if both the user's signature AND Writz's protocol signature are present. This is the cooperative release - it happens automatically when a loan is repaid and the Stellar contract generates the co-signature.

**Condition B (emergency - timelock expiry):**  
After a defined time-lock (loan duration + a 7-day safety buffer), the user can spend the BTC alone - no Writz signature required. This protects users if the protocol becomes unavailable, goes offline, or ceases to exist.

The critical property: **neither Writz alone nor the user alone can move the BTC during the active loan period**. Both signatures are required for Condition A. The time-lock enforces Condition B.

---

## The Script

```bitcoin
OP_IF
  <protocol_pubkey> OP_CHECKSIGVERIFY
  <user_pubkey>     OP_CHECKSIG
OP_ELSE
  <locktime>        OP_CHECKLOCKTIMEVERIFY
  OP_DROP
  <user_pubkey>     OP_CHECKSIG
OP_ENDIF
```

**Spending Condition A** (OP_IF branch):
- Requires protocol signature (`OP_CHECKSIGVERIFY` - fails without it)
- Then requires user signature (`OP_CHECKSIG`)
- Both must be present. Either alone is insufficient.

**Spending Condition B** (OP_ELSE branch):
- Requires the block height to exceed `<locktime>` (`OP_CHECKLOCKTIMEVERIFY`)
- Then requires only the user signature
- No protocol involvement needed after the time-lock expires

The script is 114 bytes. Each deposit gets a **unique address** derived from the protocol key, the user key, and the time-lock value - ensuring no two deposits share an address.

---

## How the Address Is Derived

```
deposit_address = P2WSH(
  redeem_script(protocol_pubkey, user_pubkey, locktime)
)
```

The `locktime` is calculated as:
```
locktime = current_block_height + loan_duration_blocks + safety_buffer_blocks
```

For a 90-day loan starting at block 900,000:
- Loan duration: ~12,960 blocks (90 days × 144 blocks/day)
- Safety buffer: ~1,008 blocks (7 days)
- `locktime` = 900,000 + 12,960 + 1,008 = 913,968

After Bitcoin block 913,968, the user can spend the locked BTC alone.

---

## Spending Path A: The Normal Release

When a user repays their USDC loan, the following happens:

1. The Stellar `writz-lend` contract records the full repayment, closes the position and emits a `repay_full` event.
2. The relayer's repay watcher sees the event, builds the release PSBT (Partially Signed Bitcoin Transaction) paying the user's own key, signs it with the protocol key, and publishes the half-signed PSBT on `writz-lend` with `publish_release_psbt`.
3. The Writz UI fetches it with `get_release_psbt` and the user's Bitcoin wallet adds the user signature.
4. The PSBT is finalized and broadcast to the Bitcoin network.
5. The BTC arrives in the user's wallet after 1–6 confirmations.

The witness structure for Condition A:
```
[user_sig (71 bytes), protocol_sig (72 bytes), 0x01, redeemScript (114 bytes)]
```

This produces a transaction of ~149 vbytes - efficient and inexpensive.

**Verified on Bitcoin Signet:**  
A real Path A release transaction was broadcast and accepted by the Bitcoin Signet mempool: [`11932100`](https://blockstream.info/signet/tx/119321009b2f92dac8f25f6bcddb2ed6a3ae778e8748ec52910cce90742e4098)  
- 89,631 satoshis locked; 88,131 satoshis released (Path A co-signed release)
- 149 vbytes at 10.1 sat/vbyte
- Both keys signed the PSBT independently (multi-party flow)

---

## Spending Path B: The Emergency Release

If the time-lock has expired and a user wants to reclaim their BTC without a protocol co-signature:

1. The user assembles a transaction with `nLockTime` set to `locktime`.
2. **The input's `nSequence` must be set to a value less than `0xFFFFFFFF`** (Writz uses `0xFFFFFFFE`) - see the warning below.
3. The transaction is signed with the user's key only.
4. Once the Bitcoin block height exceeds `locktime`, the transaction becomes valid.
5. The user broadcasts it directly to the Bitcoin network - no Writz involvement.

This ensures that user funds are never permanently inaccessible, even in a worst-case scenario where Writz stops operating.

> **[WARNING] `nSequence` interaction:** `OP_CHECKLOCKTIMEVERIFY` has a non-obvious interaction with `nSequence` - if the spending input's `nSequence` is `0xFFFFFFFF` (Bitcoin's "final" value, which many wallets use by default), the Bitcoin Script interpreter causes `CLTV` to fail immediately, **even if the timelock has genuinely expired**. There is no clear error message - the transaction is simply rejected by the network, and it's easy to mistakenly conclude the timelock hasn't expired when it has. The Writz frontend and the `bitcoin-script` package's `buildEmergencyTransaction`/`finalizePathB` helpers already set this correctly and hardcode it (it cannot be overridden by a caller). If you are constructing this recovery transaction manually with a third-party wallet or library instead of using Writz's own tooling, you must set `nSequence` yourself - see [Manual Emergency Recovery](/how-it-works/manual-emergency-recovery) for a safe, copy-pasteable reference implementation.

---

## Security Properties

**What Writz can do:**
- Co-sign releases (with user agreement) when loans are repaid
- Refuse to co-sign (keep BTC locked) if a loan is still outstanding
- Nothing else

**What Writz cannot do:**
- Move the BTC unilaterally (no user signature = no valid Condition A spend)
- Prevent the user from recovering BTC after the time-lock (Condition B requires no protocol involvement)
- Access the BTC if both the user key and protocol key are lost (standard key management risk)

**What happens if Writz disappears:**
- Active loans: Users wait for the time-lock expiry, then claim BTC via Condition B. They keep their USDC. The protocol absorbs the loss.
- No active loans: No locked BTC exists; nothing is at risk.

---

## Protocol Co-signing Key Architecture

The protocol co-signing key is used only to co-sign release transactions for fully repaid loans. It can never move Bitcoin alone: every spending path of the script also requires the user's key, and the user's time-lock exit does not need it at all.

**Planned:** the protocol side becomes 2-of-3 keys, held separately and written into the P2WSH script itself (see the script form below), so Bitcoin enforces the threshold natively and no single key can co-sign a release. This replaces earlier plans for threshold MPC signing. The signing policy, what the protocol signers can and cannot sign, will be published.

---

## Script Roadmap: P2WSH, not Taproot

Writz stays on P2WSH with an absolute block-height time-lock (`OP_CHECKLOCKTIMEVERIFY`) for mainnet v1. An earlier plan to move to Taproot (P2TR) with a MuSig2 key path is withdrawn, because:

- Every launch wallet can sign a P2WSH miniscript today, while Taproot script-path and MuSig2 signing are not broadly supported.
- The protocol side is planned as 2-of-3 keys. MuSig2 is n-of-n, so a 2-of-3 key path would need threshold Schnorr signing (FROST), which no launch wallet or custody option supports.
- The Soroban contract checks a P2WSH output with one SHA-256 comparison. A Taproot output check would need Schnorr or elliptic-curve arithmetic that Soroban does not provide as host functions.

The planned change is to the script's form, not its type. It moves to a miniscript policy with the user's key and any 2 of 3 protocol keys on the cooperative path, and the user's key alone after the time-lock:

```
wsh(and_v(v:pk(U),or_i(multi(2,K1,K2,K3),after(H))))
```

This keeps the user's emergency exit exactly as it is and lets policy-based hardware wallets sign it. Until it ships, the deployed script is the one shown above. Taproot is reconsidered only once threshold Schnorr signing is available in the launch wallets and signers.

---

**Next:** [How SPV Verification Works →](/how-it-works/spv-verification)
