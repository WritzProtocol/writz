from wz import *
def body(skin):
    c = SK[skin]
    p = [zone(c, 24, 40, 912, 136, "BITCOIN"), zone(c, 24, 216, 912, 136, "STELLAR (SOROBAN)", off=200)]
    p += [arrow(c, "M120,144 V276 Q120,284 128,284 H222"),
          arrow(c, "M384,284 H406"),
          arrow(c, "M568,284 H590"),
          arrow(c, "M752,284 H848 Q856,284 856,276 V146"),
          arrow(c, "M200,108 H406", dash=True)]
    p += [label(c, 128, 184, 104, "6 CONFIRMATIONS"),
          label(c, 748, 184, 100, "WRITZ CO-SIGNS"),
          label(c, 254, 84, 100, "AFTER HEIGHT H")]
    p += [node(c, 40, 72, 160, 72, "STEP 1", "Lock BTC", "into your vault"),
          node(c, 224, 248, 160, 72, "STEP 2", "Prove the lock", "bitcoin-spv"),
          node(c, 408, 248, 160, 72, "STEP 3", "Borrow USDC", "writz-lend", "focal"),
          node(c, 592, 248, 160, 72, "STEP 4", "Repay", "USDC + interest"),
          node(c, 776, 72, 160, 72, "STEP 5", "Release BTC", "you sign, broadcast"),
          node(c, 408, 72, 160, 72, "FALLBACK", "Timelock exit", "you alone", "external")]
    p.append(f'<text x="24" y="400" fill="{c["muted"]}" font-size="{F_NOTE}" font-style="italic" font-family="{SANS}">Your Bitcoin never leaves Bitcoin: Stellar only checks a proof that it is locked.</text>')
    p.append(legend(c, 464, [("focal", "The loan"), ("default", "Step"), ("dashed", "Fallback if Writz stops")], 960))
    return "\n".join(p)
for s in ("light", "dark"):
    page("full-picture", s, "How a Writz loan works",
         "You lock Bitcoin in your own vault on Bitcoin, Stellar verifies the lock with an SPV proof after six confirmations, you borrow USDC from writz-lend, repay it with interest, and Writz co-signs so you can release your Bitcoin; if Writz stops, you can take it back alone after the timelock height.",
         960, 504, body(s), eyebrow="How Writz works")
