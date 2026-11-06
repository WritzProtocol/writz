from wz import *
def endmark(c, x, y):
    return f'<circle cx="{x}" cy="{y}" r="8" fill="none" stroke="{c["ink"]}" stroke-width="1.2"/><circle cx="{x}" cy="{y}" r="5" fill="{c["ink"]}"/>'
def body(skin):
    c = SK[skin]
    p = []
    p += [arrow(c, "M54,152 H118"),
          arrow(c, "M352,136 H526"),
          arrow(c, "M528,168 H354"),
          arrow(c, "M228,112 V72 Q228,64 236,64 H1052 Q1060,64 1060,72 V110"),
          arrow(c, "M608,192 V318"),
          arrow(c, "M680,320 V194"),
          arrow(c, "M760,360 H942"),
          arrow(c, "M236,192 V318", dash=True),
          arrow(c, "M1176,152 H1210"),
          arrow(c, "M1176,360 H1210"),
          arrow(c, "M352,360 H390"),
          arrow(c, "M560,192 V272 Q560,280 552,280 H308 Q300,280 300,288 V318", dash=True)]
    p += [label(c, 62, 124, 48, "DEPOSIT"),
          label(c, 416, 116, 48, "BORROW"),
          label(c, 396, 176, 84, "REPAY IN FULL"),
          label(c, 620, 44, 52, "RELEASE"),
          label(c, 616, 224, 52, "TRIGGER"),
          label(c, 688, 248, 64, "RECOVERED"),
          label(c, 812, 340, 80, "KEEPER SETTLES"),
          label(c, 244, 248, 48, "AFTER H"),
          label(c, 384, 260, 76, "UNPAID AT H")]
    p.append(f'<circle cx="48" cy="152" r="6" fill="{c["ink"]}"/>')
    p += [node(c, 120, 112, 232, 80, "", "Collateral, no debt", "BTC verified, can borrow"),
          node(c, 528, 112, 232, 80, "", "Loan open", "USDC debt, maturity in blocks", "focal"),
          node(c, 944, 112, 232, 80, "", "Released", "BTC back to the borrower"),
          node(c, 528, 320, 232, 80, "", "Liquidatable", "below threshold, or unpaid at maturity"),
          node(c, 944, 320, 232, 80, "", "Liquidated", "debt repaid, step confirmed"),
          node(c, 120, 320, 232, 80, "", "Timelock recovery", "borrower reclaims alone")]
    p += [endmark(c, 1220, 152), endmark(c, 1220, 360), endmark(c, 400, 360)]
    p.append(f'<text x="40" y="452" fill="{c["muted"]}" font-size="13" font-style="italic" font-family="{SANS}">Liquidation closes 288 blocks before H. A loan still unpaid then is reclaimed by the borrower, and the loss falls on lenders.</text>')
    p.append(f'<text x="40" y="474" fill="{c["muted"]}" font-size="13" font-style="italic" font-family="{SANS}">Planned: maturity, and borrowing again after a full repayment. On testnet today a full repayment closes the position.</text>')
    p.append(legend(c, 536, [("focal", "Active loan"), ("default", "Position state"), ("line", "Transition"), ("dashed", "Borrower alone, after H")], 1280))
    return "\n".join(p)
for s in ("light", "dark"):
    page("position-states", s, "Lifecycle of a Writz position",
         "A position starts when a Bitcoin deposit is verified, moves between no debt and an open loan as the borrower borrows and repays, ends released, liquidated by a keeper when unhealthy or unpaid at maturity, or reclaimed by the borrower after the timelock, in which case an unpaid loan becomes a loss for lenders.",
         1280, 576, body(s))
