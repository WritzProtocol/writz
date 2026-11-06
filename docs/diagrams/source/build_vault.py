from wz import *
def body(skin):
    c = SK[skin]
    p = []
    p += [arrow(c, "M272,256 H320 Q328,256 328,248 V160 Q328,152 336,152 H382"),
          arrow(c, "M272,288 H320 Q328,288 328,296 V384 Q328,392 336,392 H382"),
          arrow(c, "M632,136 H680 Q688,136 688,128 V92 Q688,84 696,84 H798"),
          arrow(c, "M632,168 H696 Q704,168 704,176 V212 Q704,220 712,220 H798"),
          arrow(c, "M632,392 H798")]
    p += [label(c, 724, 64, 48, "REPAID"),
          label(c, 724, 200, 72, "LIQUIDATION"),
          label(c, 676, 372, 84, "AFTER HEIGHT H")]
    p += [node(c, 40, 232, 232, 80, "P2WSH", "Writz vault output", "locked by the borrower", "focal"),
          node(c, 384, 112, 248, 80, "PATH A", "Cooperative path", "user key + 2 of 3 protocol keys"),
          node(c, 384, 352, 248, 80, "PATH B", "Timelock path", "user key alone, after height H"),
          node(c, 800, 48, 280, 72, "TX", "Release", "all Bitcoin back to the borrower"),
          node(c, 800, 176, 280, 88, "TX", "Liquidation step", "pre-signed by the borrower at deposit", sub2="keeper share, remainder to borrower"),
          node(c, 800, 356, 280, 72, "TX", "Timelock recovery", "borrower takes the whole output")]
    p.append(f'<text x="384" y="468" fill="{c["muted"]}" font-size="13" font-style="italic" font-family="{SANS}">Maturity sits thousands of blocks before H, so an unpaid loan is liquidated before Path B opens.</text>')
    p.append(legend(c, 528, [("focal", "Bitcoin locked by the borrower"), ("default", "Spending path or transaction")], 1120))
    return "\n".join(p)
for s in ("light", "dark"):
    page("vault-spending-paths", s, "Writz vault: spending paths",
         "A Writz vault output can be spent on the cooperative path, by the borrower plus two of three protocol keys, to release a repaid loan or execute a pre-signed liquidation step, or on the timelock path by the borrower alone after height H.",
         1120, 568, body(s))
