# Privacy Policy

Effective date: November 6, 2026

Writz Protocol is designed to minimize what it knows about you. This policy explains, in plain terms, what data exists when you use the website and the application, and what does not.

## 1. What We Do Not Collect

Writz does not require an account, an email address, or any form of identity verification to use the protocol at its current stage. We do not collect names, government identification, or Know Your Customer (KYC) information. We do not use tracking cookies.

The testnet application keeps some data in your browser's own storage, on your device: loans and transactions in progress, your progress through the onboarding steps, and, if you use the email or social sign-in described in Section 5, a Signet test key. This data stays in your browser unless a section below says otherwise.

## 2. What Exists On-Chain

Bitcoin and Stellar are public blockchains. Any transaction you make, including deposits, borrows, repayments, and withdrawals, is recorded on these public ledgers and is visible to anyone, independent of Writz. This is a property of the underlying networks, not something Writz collects or controls.

Writz Lend positions are recorded in plaintext on public blockchains. Your Stellar address, the Bitcoin deposit transaction linked to it, the size of your collateral, the size of your loan and your health ratio are visible on-chain to anyone. Writz does not offer a privacy layer for Writz Lend.

## 3. Analytics

The Writz website and the testnet application use Umami, a privacy-focused, cookieless analytics service, to understand aggregate traffic such as page views and referral sources. Umami does not use cookies and does not build individual user profiles. No personally identifiable information is collected through this analytics integration.

The testnet application also reports to the Writz relayer which onboarding steps a person reaches (sign-in, test key created, deposit, borrow, repay, release). The relayer stores each step under a keyed hash of your Stellar address, not the address itself, and uses these records only to count how many people reach each step. No email address, sign-in provider identifier or IP address is stored with them.

## 4. Infrastructure Providers

Parts of the Writz stack run on third-party infrastructure providers: the relayer service on Railway, the website and the testnet application on Vercel, and access to the Bitcoin and Stellar networks through public endpoints (currently mempool.space for Bitcoin Signet, and Stellar's testnet RPC and Horizon). If you send a loan to another chain with Circle CCTP, the application also queries Circle's attestation service. These providers may log standard connection information, such as IP address and request timestamps, as part of normal web server operation. Writz does not direct these providers to build user profiles, and does not receive or store this information itself beyond what is needed to operate the service.

The Writz Signet faucet, which sends free test Bitcoin to accounts created through the social sign-in, stores for each claim the Signet address paid, the Stellar address of the account, a hash of the sign-in provider's user identifier and a hash of the IP address the claim came from. These records exist to enforce the one-claim limit.

## 5. Wallet Connections and Sign-in

When you connect a Bitcoin or Stellar wallet to the Writz interface, the interface reads your public wallet address to display your positions and to construct transactions for you to sign. Writz never requests, receives, or stores your private keys or seed phrases. When you use your own wallet, all signing happens in that wallet software.

On testnet only, you can instead sign in with Google, GitHub or an email code through Pollar, a third-party service. Pollar then handles your sign-in details and creates and holds the key of a Stellar test account for you, under Pollar's own privacy terms. Writz does not read or store your email address or profile from Pollar. In that mode the application also generates a Signet test key in your browser and keeps it only in your browser's storage. It is never sent to Writz, to Pollar or to the relayer, and it can sign only for test coins with no value.

## 6. Your Rights

If you are located in a jurisdiction that grants you data protection rights (such as the GDPR in the European Union), those rights apply to any data Writz does hold about you, which, per Sections 1 through 5 above, is minimal by design. Questions or requests can be raised through the project's public GitHub repository at github.com/WritzProtocol/writz.

## 7. Changes to This Policy

This policy will be updated as the protocol adds features that change what data is processed. Material changes will be reflected here with an updated effective date.
