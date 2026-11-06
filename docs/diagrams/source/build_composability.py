from wz import *
def body(skin):
    c = SK[skin]
    p = [arrow(c, "M240,132 H286"),
         arrow(c, "M488,132 H838"),
         arrow(c, "M720,248 V216 Q720,208 728,208 H912 Q920,208 920,200 V170"),
         arrow(c, "M760,292 H838"),
         arrow(c, "M1040,292 H1078"),
         arrow(c, "M640,336 V414"),
         arrow(c, "M240,452 H286"),
         arrow(c, "M488,452 H558")]
    p += [label(c, 244, 112, 36, "USDC"),
          label(c, 636, 112, 48, "SUPPLY"),
          label(c, 784, 188, 64, "CONNECTOR"),
          label(c, 768, 272, 64, "CONNECTOR"),
          label(c, 648, 368, 72, "VERIFY LOCK"),
          label(c, 248, 432, 32, "USE"),
          label(c, 500, 432, 48, "PROOFS")]
    p += [node(c, 40, 96, 200, 72, "EXTERNAL", "DeFindex vault", "savers' USDC", "external"),
          node(c, 288, 96, 200, 72, "CONTRACT", "Vault strategy", "no fee, non-upgradable"),
          node(c, 840, 96, 200, 72, "CONNECTOR", "Writz Lend pool", "USDC from Writz lenders"),
          node(c, 520, 248, 240, 88, "CORE", "Writz core", "lock proof, pre-signed steps,", "focal", sub2="maturity, signer policy"),
          node(c, 840, 248, 200, 88, "CONNECTOR", "Lending-market adapter", "non-transferable unit,", sub2="one connector per market"),
          node(c, 1080, 248, 168, 88, "EXTERNAL", "Host market", "e.g. XOXNO", "external"),
          node(c, 40, 416, 200, 72, "EXTERNAL", "Stellar projects", "payments, escrow, locks", "external"),
          node(c, 288, 416, 200, 72, "SDK", "Bitcoin verification SDK", "TypeScript and Rust"),
          node(c, 560, 416, 240, 72, "CONTRACT", "bitcoin-spv", "Bitcoin light client")]
    p.append(legend(c, 576, [("focal", "Writz core in writz-lend"), ("default", "Writz component"), ("external", "Another protocol or project")], 1280))
    return "\n".join(p)
for sk in ("light", "dark"):
    page("composability", sk, "How other protocols build on Writz",
         "The Writz core in writz-lend handles the Bitcoin side once; the Writz Lend pool and a lending-market adapter are connectors that bring USDC to it, a vault strategy lets DeFindex vaults supply the pool, and a verification SDK lets other Stellar projects verify Bitcoin through bitcoin-spv.",
         1280, 616, body(sk))
