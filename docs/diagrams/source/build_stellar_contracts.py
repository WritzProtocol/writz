from wz import *
def body(skin):
    c = SK[skin]
    p = [arrow(c, "M168,112 V172 Q168,180 176,180 H358"),
         arrow(c, "M480,112 V142"),
         arrow(c, "M600,180 H670"),
         arrow(c, "M560,280 V218"),
         arrow(c, "M720,280 V218")]
    p += [label(c, 176, 128, 56, "BTC/USD"),
          label(c, 488, 120, 68, "TRANSFER"),
          label(c, 611, 156, 48, "VERIFY"),
          label(c, 464, 240, 88, "RELEASE PSBT"),
          label(c, 728, 240, 56, "HEADERS")]
    p += [node(c, 48, 40, 240, 72, "ORACLE", "Reflector", "BTC/USD, SEP-40", "external"),
          node(c, 360, 40, 240, 72, "TOKEN", "USDC", "Stellar Asset Contract", "external"),
          node(c, 360, 144, 240, 72, "CONTRACT", "writz-lend", "positions, USDC pool", "focal"),
          node(c, 672, 144, 240, 72, "CONTRACT", "bitcoin-spv", "header chain, proofs"),
          node(c, 528, 280, 224, 72, "SERVICE", "Relayer", "off-chain")]
    p.append(f'<text x="24" y="400" fill="{c["muted"]}" font-size="{F_NOTE}" font-style="italic" font-family="{SANS}">A second price source, RedStone, is planned next to Reflector.</text>')
    p.append(legend(c, 464, [("focal", "Lending contract"), ("default", "Writz contract or service"), ("external", "External contract")], 960))
    return "\n".join(p)
for s in ("light", "dark"):
    page("stellar-contracts", s, "The contracts on Stellar",
         "writz-lend reads the BTC/USD price from Reflector, moves USDC through the Stellar Asset Contract and asks bitcoin-spv to verify Bitcoin transactions; the relayer submits Bitcoin headers to bitcoin-spv and publishes release PSBTs to writz-lend.",
         960, 504, body(s), eyebrow="Stellar side")
