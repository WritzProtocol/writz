from wz import *
def body(skin):
    c = SK[skin]
    p = [arrow(c, "M240,224 H264 Q272,224 272,216 V152 Q272,144 280,144 H302"),
         arrow(c, "M240,256 H264 Q272,256 272,264 V360 Q272,368 280,368 H302"),
         arrow(c, "M560,128 H584 Q592,128 592,120 V84 Q592,76 600,76 H702"),
         arrow(c, "M560,168 H600 Q608,168 608,176 V192 Q608,200 616,200 H702"),
         arrow(c, "M560,368 H702")]
    p += [label(c, 624, 52, 56, "REPAID"),
          label(c, 620, 176, 80, "LIQUIDATION"),
          label(c, 581, 344, 100, "AFTER HEIGHT H")]
    p += [node(c, 24, 200, 216, 80, "P2WSH", "Writz vault", "locked by the borrower", "focal"),
          node(c, 304, 104, 256, 80, "PATH A", "Cooperative path", "user key + 2 of 3 protocol"),
          node(c, 304, 328, 256, 80, "PATH B", "Timelock path", "user key alone, after H"),
          node(c, 704, 40, 232, 72, "TX", "Release", "all BTC to the borrower"),
          node(c, 704, 152, 232, 96, "TX", "Liquidation step", "pre-signed at deposit", sub2="keeper share, rest back"),
          node(c, 704, 330, 232, 76, "TX", "Timelock recovery", "borrower takes it all")]
    p.append(f'<text x="304" y="452" fill="{c["muted"]}" font-size="{F_NOTE}" font-style="italic" font-family="{SANS}">Maturity sits well before H, so an unpaid loan is liquidated first.</text>')
    p.append(legend(c, 520, [("focal", "Bitcoin locked by the borrower"), ("default", "Spending path or transaction")], 960))
    return "\n".join(p)
for s in ("light", "dark"):
    page("vault-spending-paths", s, "Writz vault: spending paths",
         "A Writz vault output can be spent on the cooperative path, by the borrower plus two of three protocol keys, to release a repaid loan or execute a pre-signed liquidation step, or on the timelock path by the borrower alone after height H.",
         960, 560, body(s))
