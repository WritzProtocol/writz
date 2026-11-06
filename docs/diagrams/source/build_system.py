from wz import *
def body(skin):
    c = SK[skin]
    p = [zone(c, 24, 136, 912, 120, "BITCOIN"), zone(c, 24, 296, 912, 128, "STELLAR (SOROBAN)"), zone(c, 24, 464, 912, 128, "OFF-CHAIN SERVICES")]
    p += [arrow(c, "M224,96 V158"),
          arrow(c, "M352,60 H452 Q460,60 460,68 V318"),
          arrow(c, "M560,96 V318"),
          arrow(c, "M280,360 H362"),
          arrow(c, "M596,360 H678"),
          arrow(c, "M232,488 V456 Q232,448 240,448 H412 Q420,448 420,440 V402"),
          arrow(c, "M796,488 V402"),
          arrow(c, "M480,568 V596 Q480,604 472,604 H44 Q36,604 36,596 V208 Q36,200 44,200 H94")]
    p += [label(c, 232, 112, 64, "LOCK BTC"),
          label(c, 468, 104, 80, "BORROW USDC"),
          label(c, 568, 104, 80, "SUPPLY USDC"),
          label(c, 293, 336, 56, "BTC/USD"),
          label(c, 598, 336, 80, "VERIFY LOCK"),
          label(c, 300, 424, 68, "LIQUIDATE"),
          label(c, 804, 436, 60, "HEADERS"),
          label(c, 112, 580, 56, "CO-SIGN")]
    p += [node(c, 96, 24, 256, 72, "USER", "Borrower", "BTC + Stellar wallets", "user"),
          node(c, 520, 24, 256, 72, "USER", "Lender", "Stellar wallet, USDC", "user"),
          node(c, 96, 160, 256, 80, "SCRIPT", "Writz vault", "borrower + 2 of 3 signers"),
          node(c, 48, 320, 232, 80, "EXTERNAL", "Price oracles", "Reflector + RedStone", "external"),
          node(c, 364, 320, 232, 80, "CONTRACT", "writz-lend", "positions, USDC pool", "focal"),
          node(c, 680, 320, 232, 80, "CONTRACT", "bitcoin-spv", "Bitcoin light client"),
          node(c, 48, 488, 232, 80, "SERVICE", "Keepers", "liquidate, settle by proof"),
          node(c, 364, 488, 232, 80, "SERVICE", "Protocol signers", "2-of-3 protocol keys"),
          node(c, 680, 488, 232, 80, "SERVICE", "Relayer", "headers and proofs")]
    p.append(f'<text x="24" y="636" fill="{c["muted"]}" font-size="{F_NOTE}" font-style="italic" font-family="{SANS}">Drawn as designed: 2 of 3 signers, RedStone and settlement by proof are not on testnet yet.</text>')
    p.append(legend(c, 680, [("focal", "Lending contract"), ("default", "Writz component"), ("external", "Price source"), ("user", "User")], 960))
    return "\n".join(p)
for s in ("light", "dark"):
    page("system-architecture", s, "Writz Protocol system architecture",
         "Borrowers lock Bitcoin in a Writz vault and borrow USDC from writz-lend on Stellar, which verifies the lock through the bitcoin-spv light client, prices it with two oracles, and is served by keepers, protocol signers and a relayer.",
         960, 720, body(s))
