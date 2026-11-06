import sys
SK = {
 "light": dict(paper="#F6F7F8", ink="#15181E", muted="#4B515B", soft="#646A73", accent="#15181E",
               tint="#FFC300", link="#2A303A", zone_fill="rgba(21,24,30,0.02)", zone_stroke="rgba(21,24,30,0.14)",
               ext_fill="#F6F7F8", user_fill="#ECEEF1", rule="rgba(21,24,30,0.12)", focal_text="#15181E", focal_sub="#2A303A"),
 "dark": dict(paper="#0C0E12", ink="#F6F7F8", muted="#B6BBC4", soft="#8B919B", accent="#FFC300",
              tint="rgba(255,195,0,0.12)", link="#8FB0D8", zone_fill="rgba(246,247,248,0.02)", zone_stroke="rgba(246,247,248,0.14)",
              ext_fill="#0C0E12", user_fill="#15181E", rule="rgba(246,247,248,0.12)", focal_text="#F6F7F8", focal_sub="#FFC300"),
}
SANS = "'Work Sans', system-ui, sans-serif"
MONO = "'Geist Mono', ui-monospace, monospace"

def node(c, x, y, w, h, tag, name, sub, kind):
    if kind == "focal":
        fill, stroke, sw, dash, tc, sc = c["tint"], c["accent"], 1.4, "", c["focal_text"], c["focal_sub"]
    elif kind == "user":
        fill, stroke, sw, dash, tc, sc = c["user_fill"], c["muted"], 1, "", c["ink"], c["muted"]
    elif kind == "external":
        fill, stroke, sw, dash, tc, sc = c["ext_fill"], c["muted"], 1, ' stroke-dasharray="4,3"', c["ink"], c["muted"]
    else:
        fill, stroke, sw, dash, tc, sc = c["paper"], c["ink"], 1, "", c["ink"], c["muted"]
    tw = max(36, int(len(tag) * 0.62 * 7) + 12)
    cx = x + w / 2
    return f'''<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{c['paper']}"/>
<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>
<rect x="{x+8}" y="{y+8}" width="{tw}" height="12" rx="2" fill="none" stroke="{sc}" stroke-opacity="0.5" stroke-width="0.8"/>
<text x="{x+8+tw/2}" y="{y+17}" fill="{sc}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{tag}</text>
<text x="{cx}" y="{y+h/2+6}" fill="{tc}" font-size="13" font-weight="600" font-family="{SANS}" text-anchor="middle">{name}</text>
<text x="{cx}" y="{y+h/2+22}" fill="{sc}" font-size="9" font-family="{MONO}" text-anchor="middle">{sub}</text>'''

def label(c, x, y, w, text):
    return f'''<rect x="{x}" y="{y}" width="{w}" height="12" rx="2" fill="{c['paper']}"/>
<text x="{x+w/2}" y="{y+9}" fill="{c['soft']}" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.06em">{text}</text>'''

def zone(c, x, y, w, h, text, off=16):
    lw = int(len(text) * 0.62 * 7) + 16
    return f'''<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{c['zone_fill']}" stroke="{c['zone_stroke']}" stroke-width="0.8"/>
<rect x="{x+off}" y="{y-6}" width="{lw}" height="12" rx="2" fill="{c['paper']}"/>
<text x="{x+off+lw/2}" y="{y+3}" fill="{c['soft']}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.14em">{text}</text>'''

def arrow(c, d, marker="arrow", dash=""):
    col = c["muted"]
    return f'<path d="{d}" fill="none" stroke="{col}" stroke-width="1.2"{dash} marker-end="url(#{marker})"/>'

def build(skin):
    c = SK[skin]
    slug = "system-architecture" + ("-dark" if skin == "dark" else "")
    parts = []
    parts += [zone(c, 32, 168, 320, 416, "BITCOIN"), zone(c, 400, 168, 480, 416, "STELLAR (SOROBAN)", off=64), zone(c, 928, 168, 320, 416, "OFF-CHAIN SERVICES")]
    parts += [
      arrow(c, "M192,120 V214"),
      arrow(c, "M312,104 H432 Q440,104 440,112 V256 Q440,264 448,264 H518"),
      arrow(c, "M680,120 V230"),
      arrow(c, "M720,320 V446"),
      arrow(c, "M560,448 V322"),
      arrow(c, "M968,496 H866"),
      arrow(c, "M968,268 H762"),
      arrow(c, "M968,380 H728 a8,8 0 0,0 -16,0 H568 a8,8 0 0,0 -16,0 H200 Q192,380 192,372 V298"),
    ]
    parts += [
      label(c, 200, 136, 56, "LOCK BTC"),
      label(c, 448, 128, 72, "BORROW USDC"),
      label(c, 688, 150, 72, "SUPPLY USDC"),
      label(c, 728, 336, 72, "VERIFY LOCK"),
      label(c, 496, 336, 56, "BTC/USD"),
      label(c, 888, 476, 56, "HEADERS"),
      label(c, 836, 248, 64, "LIQUIDATE"),
      label(c, 328, 360, 56, "CO-SIGN"),
    ]
    parts += [
      node(c, 72, 56, 240, 64, "USER", "Borrower", "Bitcoin wallet + Stellar wallet", "user"),
      node(c, 520, 56, 240, 64, "USER", "Lender", "Stellar wallet, USDC", "user"),
      node(c, 72, 216, 240, 80, "SCRIPT", "Writz vault", "user key + 2-of-3, or timelock", "default"),
      node(c, 520, 232, 240, 88, "CONTRACT", "writz-lend", "positions, USDC pool, liquidation", "focal"),
      node(c, 432, 448, 200, 72, "EXTERNAL", "Price oracles", "Reflector + RedStone", "external"),
      node(c, 664, 448, 200, 72, "CONTRACT", "bitcoin-spv", "headers, proof of work, proofs", "default"),
      node(c, 968, 232, 240, 72, "SERVICE", "Keepers", "liquidate, settle by SPV proof", "default"),
      node(c, 968, 344, 240, 72, "SERVICE", "Protocol signers", "2-of-3 protocol keys", "default"),
      node(c, 968, 472, 240, 72, "SERVICE", "Relayer", "Bitcoin headers and proofs", "default"),
    ]
    ly = 648
    leg = f'''<line x1="32" y1="{ly-24}" x2="1248" y2="{ly-24}" stroke="{c['rule']}" stroke-width="0.8"/>
<text x="32" y="{ly+4}" fill="{c['muted']}" font-size="8" font-family="{MONO}" letter-spacing="0.14em">LEGEND</text>
<rect x="112" y="{ly-6}" width="20" height="14" rx="3" fill="{c['tint']}" stroke="{c['accent']}" stroke-width="1.2"/>
<text x="140" y="{ly+5}" fill="{c['ink']}" font-size="10" font-family="{SANS}">Core lending contract</text>
<rect x="296" y="{ly-6}" width="20" height="14" rx="3" fill="{c['paper']}" stroke="{c['ink']}" stroke-width="1"/>
<text x="324" y="{ly+5}" fill="{c['ink']}" font-size="10" font-family="{SANS}">Writz contract, script or service</text>
<rect x="540" y="{ly-6}" width="20" height="14" rx="3" fill="{c['ext_fill']}" stroke="{c['muted']}" stroke-width="1" stroke-dasharray="4,3"/>
<text x="568" y="{ly+5}" fill="{c['ink']}" font-size="10" font-family="{SANS}">External price source</text>
<rect x="740" y="{ly-6}" width="20" height="14" rx="3" fill="{c['user_fill']}" stroke="{c['muted']}" stroke-width="1"/>
<text x="768" y="{ly+5}" fill="{c['ink']}" font-size="10" font-family="{SANS}">User</text>'''
    svg = f'''<svg viewBox="0 0 1280 680" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">
<title id="{slug}-title">Writz Protocol system architecture</title>
<desc id="{slug}-desc">Borrowers lock Bitcoin in a Writz vault and borrow USDC from writz-lend on Stellar, which verifies the lock through the bitcoin-spv light client, prices it with two oracles, and is served by keepers, protocol signers and a relayer.</desc>
<defs><marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{c['muted']}"/></marker>
<marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{c['accent']}"/></marker>
<marker id="arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{c['link']}"/></marker></defs>
<rect width="100%" height="100%" fill="{c['paper']}"/>
{chr(10).join(parts)}
{leg}
</svg>'''
    html = f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Writz Protocol system architecture</title>
<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:{SANS};background:{c['paper']};color:{c['ink']};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:3rem 2rem}}
.frame{{max-width:1320px;width:100%}}.diagram-container{{width:100%;overflow-x:auto}}
.eyebrow{{font-family:{MONO};font-size:.66rem;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:{c['muted']};margin-bottom:.5rem}}
h1{{font-family:{SANS};font-size:1.75rem;font-weight:600;letter-spacing:-.02em;line-height:1.15;margin-bottom:1.5rem}}
svg{{width:100%;min-width:1280px;display:block}}@media print{{.diagram-container{{overflow-x:visible}}svg{{min-width:0}}}}</style></head>
<body><div class="frame"><p class="eyebrow">Architecture</p><h1>Writz Protocol system architecture</h1>
<div class="diagram-container">
{svg}
</div></div></body></html>'''
    open(f"{slug}.html", "w").write(html)

for s in ("light", "dark"):
    build(s)
