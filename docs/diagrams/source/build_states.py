from wz import *
def endmark(c, x, y):
    return f'<circle cx="{x}" cy="{y}" r="8" fill="none" stroke="{c["ink"]}" stroke-width="1.2"/><circle cx="{x}" cy="{y}" r="5" fill="{c["ink"]}"/>'
def body(skin):
    c = SK[skin]
    p = [arrow(c, "M168,58 V94"),
         arrow(c, "M240,96 V64 Q240,56 248,56 H784 Q792,56 792,64 V94"),
         arrow(c, "M280,120 H366"),
         arrow(c, "M368,152 H282"),
         arrow(c, "M448,176 V342"),
         arrow(c, "M528,344 V178"),
         arrow(c, "M592,384 H678"),
         arrow(c, "M120,176 V342", dash=True),
         arrow(c, "M400,176 V296 Q400,304 392,304 H176 Q168,304 168,312 V342", dash=True),
         arrow(c, "M904,136 H922"), arrow(c, "M904,384 H922"), arrow(c, "M280,384 H298")]
    p += [label(c, 176, 64, 60, "DEPOSIT"),
          label(c, 456, 28, 64, "RELEASE"),
          label(c, 298, 96, 52, "BORROW"),
          label(c, 290, 160, 68, "REPAY ALL"),
          label(c, 460, 232, 56, "TRIGGER"),
          label(c, 536, 232, 72, "RECOVERED"),
          label(c, 604, 360, 60, "SETTLED"),
          label(c, 128, 232, 56, "AFTER H"),
          label(c, 216, 280, 84, "UNPAID AT H")]
    p.append(f'<circle cx="168" cy="52" r="6" fill="{c["ink"]}"/>')
    p += [node(c, 56, 96, 224, 80, "", "Collateral, no debt", "BTC verified, can borrow"),
          node(c, 368, 96, 224, 80, "", "Loan open", "USDC debt, maturity set", "focal"),
          node(c, 680, 96, 224, 80, "", "Released", "BTC back to borrower"),
          node(c, 368, 344, 224, 80, "", "Liquidatable", "unhealthy or past maturity"),
          node(c, 680, 344, 224, 80, "", "Liquidated", "debt repaid by a keeper"),
          node(c, 56, 344, 224, 80, "", "Timelock recovery", "borrower reclaims alone")]
    p += [endmark(c, 936, 136), endmark(c, 936, 384), endmark(c, 312, 384)]
    p.append(f'<text x="24" y="476" fill="{c["muted"]}" font-size="{F_NOTE}" font-style="italic" font-family="{SANS}">Liquidation stops 288 blocks before H; a loan unpaid by then is a loss for lenders.</text>')
    p.append(f'<text x="24" y="500" fill="{c["muted"]}" font-size="{F_NOTE}" font-style="italic" font-family="{SANS}">Planned: maturity, and borrowing again after repaying. Today, repaying in full closes the position.</text>')
    p.append(legend(c, 568, [("focal", "Active loan"), ("default", "Position state"), ("line", "Transition"), ("dashed", "Borrower alone, after H")], 960))
    return "\n".join(p)
for s in ("light", "dark"):
    page("position-states", s, "Lifecycle of a Writz position",
         "A position starts when a Bitcoin deposit is verified, moves between no debt and an open loan as the borrower borrows and repays, ends released, liquidated by a keeper when unhealthy or unpaid at maturity, or reclaimed by the borrower after the timelock, in which case an unpaid loan becomes a loss for lenders.",
         960, 608, body(s))
