# Privacy Policy

Effective date: August 17, 2026

Writz Protocol is designed to minimize what it knows about you. This policy explains, in plain terms, what data exists when you use the website and the application, and what does not.

## 1. What We Do Not Collect

Writz does not require an account, an email address, or any form of identity verification to use the protocol at its current stage. We do not collect names, government identification, or Know Your Customer (KYC) information. We do not use tracking cookies.

## 2. What Exists On-Chain

Bitcoin and Stellar are public blockchains. Any transaction you make, including deposits, borrows, repayments, and withdrawals, is recorded on these public ledgers and is visible to anyone, independent of Writz. This is a property of the underlying networks, not something Writz collects or controls.

The zero-knowledge privacy layer is designed to keep specific details private on Stellar: the size of your collateral, the size of your loan, and your liquidation threshold are hidden behind cryptographic commitments. The fact that a deposit, borrow, or liquidation event occurred is still visible on-chain, but the amounts and the identity of the position holder are not derivable from that visibility alone. See docs/how-it-works/zk-privacy-layer.md for the technical detail of what is and is not hidden.

## 3. Website Analytics

The Writz website uses Umami, a privacy-focused, cookieless analytics service, to understand aggregate traffic such as page views and referral sources. Umami does not use cookies and does not build individual user profiles. No personally identifiable information is collected through this analytics integration.

## 4. Infrastructure Providers

Parts of the Writz stack, including the relayer service and RPC access to the Bitcoin and Stellar networks, run on third-party infrastructure providers (currently Railway for the relayer, and standard Bitcoin and Stellar RPC endpoints). These providers may log standard connection information, such as IP address and request timestamps, as part of normal web server operation. Writz does not direct these providers to build user profiles, and does not receive or store this information itself beyond what is needed to operate the service.

## 5. Wallet Connections

When you connect a Bitcoin or Stellar wallet to the Writz interface, the interface reads your public wallet address to display your positions and to construct transactions for you to sign. Writz never requests, receives, or stores your private keys or seed phrases. All signing happens in your own wallet software.

## 6. Future Compliance Features

As described in the project's regulatory research (docs/research/regulatory-landscape.md), Writz plans to integrate an Association Set Provider (ASP) system for deposits above certain thresholds once the protocol reaches later phases. When that integration ships, this policy will be updated to describe exactly what is verified, what is disclosed, and to whom, before it becomes active.

## 7. Your Rights

If you are located in a jurisdiction that grants you data protection rights (such as the GDPR in the European Union), those rights apply to any data Writz does hold about you, which, per Sections 1 through 5 above, is minimal by design. Questions or requests can be raised through the project's public GitHub repository at github.com/WritzProtocol/writz.

## 8. Changes to This Policy

This policy will be updated as the protocol adds features that change what data is processed, including the ASP compliance integration referenced in Section 6. Material changes will be reflected here with an updated effective date.
