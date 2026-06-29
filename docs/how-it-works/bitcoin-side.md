# The Bitcoin Side

**How your BTC is locked — and why nobody else can touch it.**

Before anything happens on Stellar, a Bitcoin transaction secures your collateral. This page explains the Bitcoin locking mechanism: what it is, how it works, and what the security guarantees are.

---

## The Core Idea: Rules Written Into Bitcoin

When you make a standard Bitcoin payment, you send BTC to an address, and the recipient can spend it with their private key. That is a simple rule: "this key can spend this output."

Bitcoin Script allows more complex rules. Writz uses a P2WSH — Pay to Witness Script Hash — which can encode multiple spending conditions. The address is a hash of a full script; to spend from it, you reveal the script and satisfy one of its conditions.

Writz's P2WSH script has exactly two conditions:

**Condition A (normal — loan repaid):**  
The BTC can be spent only if both the user's signature AND Writz's protocol signature are present. This is the cooperative release — it happens automatically when a loan is repaid and the Stellar contract generates the co-signature.

**Condition B (emergency — timelock expiry):**  
After a defined time-lock (loan duration + a 7-day safety buffer), the user can spend the BTC alone — no Writz signature required. This protects users if the protocol becomes unavailable, goes offline, or ceases to exist.

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
- Requires protocol signature (`OP_CHECKSIGVERIFY` — fails without it)
- Then requires user signature (`OP_CHECKSIG`)
- Both must be present. Either alone is insufficient.

**Spending Condition B** (OP_ELSE branch):
- Requires the block height to exceed `<locktime>` (`OP_CHECKLOCKTIMEVERIFY`)
- Then requires only the user signature
- No protocol involvement needed after the time-lock expires

The script is 114 bytes. Each deposit gets a **unique address** derived from the protocol key, the user key, and the time-lock value — ensuring no two deposits share an address.

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

1. The Stellar `commitment-tree` contract records the repayment and emits a `repay_full` event.
2. The Writz co-signing service (a backend service monitoring this event) sees the event and generates a Schnorr/ECDSA signature over the release transaction using the protocol key.
3. The Writz UI assembles a PSBT (Partially Signed Bitcoin Transaction) with both the protocol signature and the user signature.
4. The PSBT is finalized and broadcast to the Bitcoin network.
5. The BTC arrives in the user's wallet after 1–6 confirmations.

The witness structure for Condition A:
```
[user_sig (71 bytes), protocol_sig (72 bytes), 0x01, redeemScript (114 bytes)]
```

This produces a transaction of ~149 vbytes — efficient and inexpensive.

**Verified on Bitcoin Signet:**  
A real Path A release transaction was broadcast and accepted by the Bitcoin Signet mempool: [`11932100`](https://blockstream.info/signet/tx/119321009b2f92dac8f25f6bcddb2ed6a3ae778e8748ec52910cce90742e4098)  
- 89,631 satoshis locked; 88,131 satoshis released (Path A co-signed release)
- 149 vbytes at 10.1 sat/vbyte
- Both keys signed the PSBT independently (multi-party flow)

---

## Spending Path B: The Emergency Release

If the time-lock has expired and a user wants to reclaim their BTC without a protocol co-signature:

1. The user assembles a transaction with `nLockTime` set to `locktime`.
2. The transaction is signed with the user's key only.
3. Once the Bitcoin block height exceeds `locktime`, the transaction becomes valid.
4. The user broadcasts it directly to the Bitcoin network — no Writz involvement.

This ensures that user funds are never permanently inaccessible, even in a worst-case scenario where Writz stops operating.

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

**Phase 1 (current):** The protocol co-signing key is held in an HSM (Hardware Security Module) operated by the Writz team. It is used exclusively to sign BTC release transactions for fully repaid loans.

**Phase 2 (after Protocol 27 ships, Q3 2026):** The co-signing key architecture is upgraded using Stellar's `delegate_account_auth` (Protocol 27 / Zipper). This enables threshold co-signing — multiple independent parties must agree before a release is signed — removing the single-point-of-failure of an HSM.

**Phase 3 (2027):** Full MPC (Multi-Party Computation) for the protocol co-signing key, eliminating any single HSM as a trust assumption.

---

## Taproot Roadmap

Phase 1 uses P2WSH for simplicity and auditability. P2WSH is well-understood, battle-tested, and the easiest to implement correctly.

In Phase 2+, Writz will migrate to **Taproot (P2TR)**:
- The normal release path (Condition A) becomes a simple key-path spend that looks like any ordinary Bitcoin payment
- No script is revealed on-chain for the happy path — improving privacy on the Bitcoin side
- Script-path spending (Condition B emergency) is still available but is now a hidden alternative
- Reduced transaction fees (~50% smaller for Condition A)

---

**Next:** [How SPV Verification Works →](spv-verification.md)
