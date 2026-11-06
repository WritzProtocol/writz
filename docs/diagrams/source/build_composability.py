from wz import *
def body(skin):
    c = SK[skin]
    p = [arrow(c, "M224,68 H278"),
         arrow(c, "M496,68 H702"),
         arrow(c, "M544,184 V160 Q544,152 552,152 H800 Q808,152 808,144 V106"),
         arrow(c, "M584,232 H702"),
         arrow(c, "M816,280 V358"),
         arrow(c, "M560,280 V358"),
         arrow(c, "M224,396 H278"),
         arrow(c, "M476,396 H526")]
    p += [label(c, 233, 44, 36, "USDC"),
          label(c, 572, 44, 56, "SUPPLY"),
          label(c, 640, 128, 72, "CONNECTOR"),
          label(c, 607, 208, 72, "CONNECTOR"),
          label(c, 824, 304, 80, "COLLATERAL"),
          label(c, 472, 304, 80, "VERIFY LOCK"),
          label(c, 235, 372, 32, "USE"),
          label(c, 477, 372, 48, "PROOFS")]
    p += [node(c, 24, 32, 200, 72, "EXTERNAL", "DeFindex vault", "savers' USDC", "external"),
          node(c, 280, 32, 216, 72, "CONTRACT", "Vault strategy", "no fee, immutable"),
          node(c, 704, 32, 224, 72, "CONNECTOR", "Writz Lend pool", "USDC from lenders"),
          node(c, 360, 184, 224, 96, "CORE", "Writz core", "lock proof, steps,", "focal", sub2="maturity, signers"),
          node(c, 704, 184, 224, 96, "CONNECTOR", "Lending-market adapter", "non-transferable unit", sub2="one per locked sat"),
          node(c, 24, 360, 200, 72, "EXTERNAL", "Stellar projects", "payments, locks", "external"),
          node(c, 280, 360, 196, 72, "SDK", "Verification SDK", "TypeScript and Rust"),
          node(c, 528, 360, 176, 72, "CONTRACT", "bitcoin-spv", "light client"),
          node(c, 728, 360, 200, 72, "EXTERNAL", "Other lending market", "e.g. XOXNO", "external")]
    p.append(legend(c, 512, [("focal", "Core in writz-lend"), ("default", "Writz component"), ("external", "Another protocol")], 960))
    return "\n".join(p)
for sk in ("light", "dark"):
    page("composability", sk, "How other protocols build on Writz",
         "The Writz core in writz-lend handles the Bitcoin side once; the Writz Lend pool and a lending-market adapter are connectors that bring USDC to it, a vault strategy lets DeFindex vaults supply the pool, and a verification SDK lets other Stellar projects verify Bitcoin through bitcoin-spv.",
         960, 552, body(sk))
