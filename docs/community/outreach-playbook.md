# Community Outreach Playbook

**Goal:** Build genuine community presence and secure at least one SCF referral before submitting the application.
**Timeline:** 2–3 weeks of consistent engagement before applying.

The SCF handbook states referrals from community members are "strongly recommended" and are weighted in the review. They don't just check if a box is ticked — they verify the relationship is real.

---

## Channel-by-channel action plan

### 1. Stellar Discord — Primary channel

**Server:** discord.gg/stellar  
**Join first:** `#introductions`, then `#soroban`, `#defi`

**Week 1 — Listen and context-build:**
Before posting anything about Writz, spend 3–5 days reading conversations in each channel. Understand the running discussions, who the active builders are, what questions are being asked. This prevents your first post from feeling like a cold pitch into a community you don't know.

**Week 1 — First contribution (not about Writz):**
Find a question you can genuinely answer. Good target areas:
- Soroban storage patterns (you know the CertiK per-entry warning cold)
- Cross-contract call patterns (you've implemented this)
- P2WSH + Taproot Bitcoin scripting (you've built this library)

Answer it well. No mention of Writz. Build credibility first.

**Week 2 — Announce Writz:**
Post the forum post from `community/forum-post.md` in `#soroban`.
Post the short version in `#defi`.

**Week 2–3 — Sustained engagement:**
Reply to anyone who engages with your announcement. Ask follow-up questions to keep conversations going. Join any threads relevant to Bitcoin, cross-chain, or ZK topics.

---

### 2. GitHub — Technical credibility signal

**Action:** Post the discussion from `community/github-discussion.md` in:
- Primary: `https://github.com/stellar/stellar-protocol/discussions`
- Backup: `https://github.com/stellar/stellar-community/discussions`

**Timing:** Post this at the same time as the Discord announcement (Week 2). Cross-link: mention the GitHub discussion in your Discord post and vice versa.

**Why GitHub matters:** SCF reviewers look at GitHub activity. A thoughtful technical discussion on the official Stellar protocol repo signals you're a serious builder who understands the ecosystem, not just someone who filled out a grant form.

---

### 3. Twitter / X — Awareness and reach

**Account:** Create or use existing account. Follow the Stellar ecosystem accounts first.

**Key accounts to follow and engage with:**
- @StellarOrg (Stellar Foundation)
- @StellarDev (Stellar developer account)
- @soroban_network (if active)
- @buildoncsoroban (SDF's Soroban account)
- @lobstrco (LOBSTR wallet team)
- @AquaNetwork_ (AQUA protocol)
- @PhoenixLabsDeFi (Blend protocol team)

**First tweet (Week 2, same day as Discord post):**

```
Been building for a few weeks — here's what's live:

• Bitcoin SPV verification on Soroban testnet (SHA256d + Merkle proof, stateless)
• P2WSH locking script library for trustless BTC collateral
• PrivateLend skeleton: deposit BTC → borrow USDC → ZK-private positions

Full thread 🧵
```

**Thread continuation:**

```
2/ The core insight: Bitcoin has no native way to "freeze" funds based on activity on another chain. But P2WSH with a 2-of-2 multisig + CLTV timelock gets you close.

User sends BTC to a script that requires BOTH the protocol key + user key to release — or a timelock expiry if Writz is unavailable.
```

```
3/ The SPV contract verifies Bitcoin transactions inside Soroban. No bridge. No custodian. No wrapped token.

Just math: SHA256d(header chain) + Merkle proof verification. Deployed on testnet: CDYQRO6PZ55A3...NLKYCPLVC
```

```
4/ ZK privacy layer coming in Phase 2: positions hidden by Circom + Groth16 proofs on Stellar's Protocol X-Ray BN254 ops.

Collateral amount, debt size, health ratio — all hidden. Nobody knows you're about to get liquidated. The keeper proves it ZK.
```

```
5/ Building toward SCF application. Docs will be public on Mintlify (docs.writz.io) next week.

If you're in the Stellar ecosystem and want to collaborate or give feedback — DM me or drop a comment on the GitHub discussion [link].
```

---

### 4. Reddit — r/Stellar

**Subreddit:** reddit.com/r/Stellar

**Timing:** Week 2 (same week as Discord + GitHub)

**Post title:** `Building a Bitcoin SPV client on Soroban — why this is different from bridges and wrapped tokens`

**Post body:**

```markdown
I've been building Writz Protocol on Stellar/Soroban for the past month. It's a BTC-collateralized lending protocol with ZK-private positions. Wanted to share what makes it technically different from other BTCfi approaches.

**The problem with bridges and wrapped tokens:**
- WBTC: BitGo holds your BTC (custodial risk)
- tBTC: Threshold signatures improve this but still has federated trust assumptions
- Stacks sBTC: Federated peg with governance process

**How Writz works instead:**
1. User sends BTC to a P2WSH address with a 2-of-2 multisig + CLTV timelock escape hatch
2. User submits an SPV proof to a Soroban contract — 6 Bitcoin block headers + Merkle proof
3. Contract verifies the proof cryptographically (SHA256d + Merkle inclusion)
4. PrivateLend contract creates a private lending position (ZK proofs, Phase 2)

**Why this is trust-minimized:**
- No third party holds your BTC — it stays locked in a Bitcoin script
- If Writz disappears, you recover your BTC via the CLTV timelock (no protocol involvement needed)
- SPV verification is cryptographic, not based on oracle trust

**What's working on testnet today:**
SPV contract deployed, relayer service running, P2WSH address generation library complete, PrivateLend skeleton (50 tests) done.

Planning to apply to the Stellar Community Fund (Open Track) and go public with the GitHub repo shortly.

Questions welcome — happy to dig into any of the technical details.
```

---

## Referral strategy — who to approach and how

The SCF referral is the hardest part of Phase 1.6. Here is a realistic strategy.

### Who can give referrals

SCF referrals must come from someone with standing in the Stellar community — typically:
- Previous SCF awardees (any Build Award recipient)
- Active Stellar ecosystem builders
- SDF team members (rarely give referrals formally, but their engagement signals legitimacy)
- Stellar validators and community members

### How to identify referral candidates

**Step 1:** Find active SCF awardees from recent rounds (SCF #30+).
Search `https://stellar.community/c/community-fund/` for recent recipients.
Look for projects that:
- Are technically adjacent (DeFi, cross-chain, ZK, lending)
- Were funded recently (they understand the process)
- Have active developers you can genuinely engage with

**Step 2:** Engage genuinely first, ask for referral second.
The timeline is:
- Week 1: Engage with their work (GitHub issues, Discord, Twitter)
- Week 2: Have a real technical conversation — share your SPV approach, ask about their work
- Week 3: If there's genuine mutual interest, ask: "I'm applying to SCF Open Track — would you be open to providing a referral?"

**Step 3:** Make the referral easy for them.
When you ask, provide:
1. A 3-sentence summary of Writz they can verify quickly
2. A link to the testnet contract (shows it's real, not vaporware)
3. A link to the GitHub discussion (shows technical depth)
4. A statement like: "A referral just means you know me as a builder and think the work is legitimate — you're not vouching for commercial success."

### Template DM for referral request

```
Hey [name] — I've been following your work on [their project] for a while, 
really appreciated [specific thing about their work].

I'm building Writz Protocol on Stellar — a Bitcoin SPV client + ZK-private 
lending on Soroban. SPV contract is live on testnet, PrivateLend skeleton is 
working with 50 tests. Applying to SCF Open Track next month.

Would you be open to providing a referral for the application? 
It's just confirming you know me as a legitimate builder — there's a form 
for it in the SCF submission. Happy to walk you through the tech first if useful.

Testnet contract: CDYQRO6PZ55A3AMJQBHDEUUCQTSVHHRWQW7WSDX7CBX6FQ2NLKYCPLVC
GitHub discussion: [link]
```

### If you can't get a referral

The SCF handbook says referrals are "strongly recommended" but not mandatory. A strong application with no referral is still competitive. A weak application with a referral is not.

Focus on the substance first. If a referral doesn't materialize in 3 weeks, apply anyway.

---

## Mintlify setup instructions

The SCF Open Track submission requires public documentation. Writz uses Mintlify (mintlify.com) — better DX than Gitbook, cleaner output, and native GitHub sync.

**Setup (15 minutes):**

1. Create account at [mintlify.com](https://mintlify.com)
2. Create a new project: "Writz Protocol"
3. Connect to your GitHub repo → select the `docs/` folder as the source root
4. Mintlify reads `mint.json` for configuration and navigation — `docs/mint.json` is already created
5. Publish → your docs live at `[your-slug].mintlify.app`

**Custom domain:**
- Point `docs.writz.io` → go to Mintlify dashboard → Settings → Custom Domain → add `docs.writz.io`
- Add the CNAME record in your DNS provider

**Local preview (before publishing):**
```bash
cd docs
npx mintlify dev
# Opens localhost:3000 with live reload
```

**After publishing, update `mint.json`:**
Replace placeholder URLs (`https://github.com/writz-protocol/writz`, `https://app.writz.io`) with the real ones once the GitHub repo is public.

---

## Weekly schedule

| Week | Action | Goal |
|---|---|---|
| Week 1 | Join Discord, listen, answer one non-Writz question | Establish presence, learn the community |
| Week 2 | Post Discord announcement + GitHub discussion + Twitter thread + Reddit post | Go public |
| Week 2 | Launch Mintlify docs | Have public docs live at docs.writz.io |
| Week 3 | Identify 3 referral candidates, start genuine engagement | Build toward referral |
| Week 3 | Follow up with Discord conversations, reply to all GitHub discussion comments | Sustain presence |
| Week 4 | Ask for referral from best candidate | Secure referral if possible |
| Week 4 | Finalize Phase 1.7 SCF application content | Ready to submit |

---

## What "community presence" looks like to an SCF reviewer

SCF reviewers will Google your name and the project name before reviewing. What they want to find:
- A GitHub profile with real commits to the project
- A Discord message history in the Stellar server (visible via server search)
- A GitHub discussion or comment thread that demonstrates technical understanding
- A public Mintlify site that's clearly written by someone who understands what they're building

What immediately disqualifies community presence as fake:
- One post made the day before the application
- Generic posts with no technical substance
- No replies or engagement in the thread

**The test:** If an SCF reviewer asks the community "who knows this builder?", someone should be able to say "yes, I've seen them in #soroban, they asked a good question about cross-contract call patterns."
