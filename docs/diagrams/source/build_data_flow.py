from wz import *
def body(skin):
    c = SK[skin]
    p = [zone(c, 24, 40, 912, 120, "UNTRUSTED"),
         zone(c, 24, 216, 296, 120, "TRUSTLESS, BITCOIN"),
         zone(c, 344, 216, 592, 120, "TRUSTLESS, SOROBAN", off=216),
         zone(c, 24, 392, 600, 120, "TRUSTED, WRITZ OPERATOR", off=216),
         zone(c, 640, 392, 296, 120, "PARTIALLY TRUSTED", off=160)]
    p += [arrow(c, "M176,136 V238"),
          arrow(c, "M468,136 V238"),
          arrow(c, "M492,240 V138", "accent"),
          arrow(c, "M664,100 H602"),
          arrow(c, "M784,136 V238"),
          arrow(c, "M600,276 H662"),
          arrow(c, "M704,416 V368 Q704,360 696,360 H568 Q560,360 560,352 V314"),
          arrow(c, "M176,416 V314"),
          arrow(c, "M480,416 V314")]
    p += [label(c, 184, 172, 64, "LOCK BTC"),
          label(c, 356, 172, 104, "DEPOSIT, BORROW"),
          label(c, 500, 172, 36, "USDC"),
          label(c, 611, 76, 44, "PROOF"),
          label(c, 792, 172, 56, "HEADERS"),
          label(c, 608, 252, 48, "VERIFY"),
          label(c, 604, 336, 56, "BTC/USD"),
          label(c, 184, 356, 56, "CO-SIGN"),
          label(c, 404, 356, 68, "LIQUIDATE")]
    p += [node(c, 56, 64, 240, 72, "USER", "Bitcoin wallet", "Xverse", "user"),
          node(c, 360, 64, 240, 72, "USER", "Stellar wallet", "Freighter", "user"),
          node(c, 664, 64, 240, 72, "SERVICE", "Relayer", "headers, proofs"),
          node(c, 56, 240, 240, 72, "P2WSH", "Writz vault", "locks the BTC"),
          node(c, 360, 240, 240, 72, "CONTRACT", "writz-lend", "positions, USDC pool", "focal"),
          node(c, 664, 240, 240, 72, "CONTRACT", "bitcoin-spv", "header chain, proofs"),
          node(c, 56, 416, 240, 72, "KEY", "Protocol key", "co-signs releases"),
          node(c, 360, 416, 240, 72, "SERVICE", "Keeper", "calls liquidate()"),
          node(c, 664, 416, 240, 72, "ORACLE", "Reflector", "second source planned", "external")]
    p.append(f'<text x="24" y="560" fill="{c["muted"]}" font-size="{F_NOTE}" font-style="italic" font-family="{SANS}">The relayer is untrusted: a false header or proof fails the checks in bitcoin-spv.</text>')
    p.append(legend(c, 624, [("focal", "Lending contract"), ("user", "User wallet"), ("default", "Component"), ("external", "Price source")], 960))
    return "\n".join(p)
for s in ("light", "dark"):
    page("data-flow", s, "Data flow and trust boundaries",
         "User wallets and the relayer are untrusted; the Writz vault on Bitcoin and the writz-lend and bitcoin-spv contracts on Soroban are trustless; the protocol co-signing key and the liquidation keeper are trusted Writz-operated components; the Reflector price feed is partially trusted.",
         960, 664, body(s), eyebrow="Threat model")
