from wz import *
ROLES = [("Borrower", "own position"), ("Protocol signers", "2 of 3 planned"), ("Keepers", "open after 24 h"),
         ("Admin", "multisig planned"), ("Relayer", "headers, proofs"), ("Price oracles", "RedStone planned")]
N = ("No", "none")
POWERS = [
 ("Take the Bitcoin", [("After H", "rw", "own BTC only"), N, ("Keeper share", "read", "planned"), N, N, N]),
 ("Take lenders' USDC", [("If unpaid at H", "rw", "not liquidated"), N, N, ("Indirectly", "read", "via SPV, oracle"), N, ("If both wrong", "read")]),
 ("Force a liquidation", [N, ("With a keeper", "focal", "one keeper share"), ("Unhealthy, due", "read", "only then"), N, N, ("If both wrong", "rw")]),
 ("Delay a release", [N, ("Until H", "rw"), N, N, ("Until H", "rw", "publishes today"), N]),
 ("Move the price", [N, N, N, ("Change source", "rw", "delay planned"), N, ("Bounded", "rw", "divergence check")]),
 ("Set caps, keepers", [N, N, N, ("Yes", "full"), N, N]),
 ("Pause new loans", [N, N, N, ("Yes", "full", "exits stay open"), N, N]),
 ("Change the code", [N, N, N, ("No", "none", "immutable"), N, N]),
 ("Stall by stopping", [N, ("Releases wait", "read"), ("If all stop", "read"), N, ("Headers stop", "rw", "borrows fail"), ("If stale", "rw", "price pauses")]),
]
def cell(c, x, y, w, h, val, lvl, sub):
    if lvl == "focal": fill, stroke, tc, sc, dash = c["tint"], c["accent"], c["focal_text"], c["focal_sub"], ""
    elif lvl == "full": fill, stroke, tc, sc, dash = c["ink"], c["ink"], c["paper"], c["paper"], ""
    elif lvl == "rw": fill, stroke, tc, sc, dash = c["paper"], c["ink"], c["ink"], c["muted"], ""
    elif lvl == "read": fill, stroke, tc, sc, dash = c["paper"], c["muted"], c["ink"], c["muted"], ' stroke-dasharray="4,3"'
    else: fill, stroke, tc, sc, dash = c["paper"], c["rule"], c["soft"], c["soft"], ""
    sw = 1.4 if lvl == "focal" else 1
    o = [f'<rect x="{x+2}" y="{y+2}" width="{w-4}" height="{h-4}" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>']
    ty = y + h / 2 + (0 if sub else 4)
    o.append(f'<text x="{x+w/2}" y="{ty}" fill="{tc}" font-size="13" font-weight="{600 if lvl in ("focal","full") else 500}" font-family="{SANS}" text-anchor="middle">{esc(val)}</text>')
    if sub: o.append(f'<text x="{x+w/2}" y="{ty+16}" fill="{sc}" font-size="10" font-family="{MONO}" text-anchor="middle">{esc(sub)}</text>')
    return "\n".join(o)
def body(skin):
    c = SK[skin]
    x0, y0, lw_, cw, hh, rh = 16, 32, 160, 130, 60, 56
    p = []
    for j, (name, sub) in enumerate(ROLES):
        x = x0 + lw_ + j * cw
        p.append(f'<rect x="{x+2}" y="{y0}" width="{cw-4}" height="{hh}" rx="4" fill="{c["ink"]}"/>')
        p.append(f'<text x="{x+cw/2}" y="{y0+24}" fill="{c["paper"]}" font-size="13" font-weight="600" font-family="{SANS}" text-anchor="middle">{esc(name)}</text>')
        p.append(f'<text x="{x+cw/2}" y="{y0+40}" fill="{c["paper"]}" fill-opacity="0.8" font-size="10" font-family="{MONO}" text-anchor="middle">{esc(sub)}</text>')
    for i, (power, cells) in enumerate(POWERS):
        y = y0 + hh + 8 + i * rh
        p.append(f'<rect x="{x0}" y="{y+2}" width="{lw_-8}" height="{rh-4}" rx="4" fill="{c["paper2"]}" stroke="{c["rule"]}" stroke-width="0.8"/>')
        p.append(f'<text x="{x0+12}" y="{y+rh/2+5}" fill="{c["ink"]}" font-size="13" font-weight="600" font-family="{SANS}">{esc(power)}</text>')
        for j, cl in enumerate(cells):
            p.append(cell(c, x0 + lw_ + j * cw, y, cw, rh, cl[0], cl[1], cl[2] if len(cl) > 2 else ""))
    ty = y0 + hh + 8 + len(POWERS) * rh + 40
    p.append(f'<text x="16" y="{ty}" fill="{c["muted"]}" font-size="15" font-style="italic" font-family="{SANS}">No role can redirect the Bitcoin: every spend was pre-signed by the borrower.</text>')
    ly = ty + 64
    out = [f'<line x1="32" y1="{ly-24}" x2="944" y2="{ly-24}" stroke="{c["rule"]}" stroke-width="0.8"/>',
           f'<text x="32" y="{ly+4}" fill="{c["muted"]}" font-size="9" font-family="{MONO}" letter-spacing="0.14em">LEGEND</text>']
    x = 96
    for lvl, t in [("full", "Can"), ("rw", "Can, within limits"), ("read", "Conditional"), ("none", "Cannot"), ("focal", "Main residual trust")]:
        if lvl == "focal": sw = f'<rect x="{x}" y="{ly-6}" width="20" height="14" rx="3" fill="{c["tint"]}" stroke="{c["accent"]}" stroke-width="1.2"/>'
        elif lvl == "full": sw = f'<rect x="{x}" y="{ly-6}" width="20" height="14" rx="3" fill="{c["ink"]}"/>'
        elif lvl == "rw": sw = f'<rect x="{x}" y="{ly-6}" width="20" height="14" rx="3" fill="{c["paper"]}" stroke="{c["ink"]}"/>'
        elif lvl == "read": sw = f'<rect x="{x}" y="{ly-6}" width="20" height="14" rx="3" fill="{c["paper"]}" stroke="{c["muted"]}" stroke-dasharray="4,3"/>'
        else: sw = f'<rect x="{x}" y="{ly-6}" width="20" height="14" rx="3" fill="{c["paper"]}" stroke="{c["rule"]}"/>'
        out += [sw, f'<text x="{x+28}" y="{ly+6}" fill="{c["ink"]}" font-size="12" font-family="{SANS}">{esc(t)}</text>']
        x += 28 + int(len(t) * 7.0) + 24
    return "\n".join(p + out)
for s in ("light", "dark"):
    page("trust-model", s, "Who can do what in Writz",
         "A matrix of what each role in Writz can and cannot do, today and as planned: no role can redirect the borrower's Bitcoin, two signers with a keeper could force a liquidation, a loan left unpaid at the timelock becomes a lender loss, the admin can change caps, keepers and the price source and pause new loans, and the contracts are immutable.",
         960, 728, body(s), eyebrow="Trust model, security matrix")
