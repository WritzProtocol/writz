"""Shared Graphite & Gold primitives for Writz diagrams (diagram-design skill, profile `writz`)."""
SK = {
 "light": dict(paper="#F6F7F8", paper2="#ECEEF1", ink="#15181E", muted="#4B515B", soft="#646A73", accent="#15181E",
               tint="#FFC300", link="#2A303A", zone_fill="rgba(21,24,30,0.02)", zone_stroke="rgba(21,24,30,0.14)",
               user_fill="#ECEEF1", rule="rgba(21,24,30,0.12)", life="rgba(21,24,30,0.22)", act="rgba(21,24,30,0.06)",
               focal_text="#15181E", focal_sub="#2A303A", frame="rgba(21,24,30,0.02)", frame_stroke="rgba(21,24,30,0.22)"),
 "dark": dict(paper="#0C0E12", paper2="#15181E", ink="#F6F7F8", muted="#B6BBC4", soft="#8B919B", accent="#FFC300",
              tint="rgba(255,195,0,0.12)", link="#8FB0D8", zone_fill="rgba(246,247,248,0.02)", zone_stroke="rgba(246,247,248,0.14)",
              user_fill="#15181E", rule="rgba(246,247,248,0.12)", life="rgba(246,247,248,0.22)", act="rgba(246,247,248,0.08)",
              focal_text="#F6F7F8", focal_sub="#FFC300", frame="rgba(246,247,248,0.04)", frame_stroke="rgba(246,247,248,0.22)"),
}
SANS = "'Work Sans', system-ui, sans-serif"
MONO = "'Geist Mono', ui-monospace, monospace"

def esc(t): return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def node(c, x, y, w, h, tag, name, sub="", kind="default", sub2=""):
    if kind == "focal":
        fill, stroke, sw, dash, tc, sc = c["tint"], c["accent"], 1.4, "", c["focal_text"], c["focal_sub"]
    elif kind == "user":
        fill, stroke, sw, dash, tc, sc = c["user_fill"], c["muted"], 1, "", c["ink"], c["muted"]
    elif kind == "external":
        fill, stroke, sw, dash, tc, sc = c["paper"], c["muted"], 1, ' stroke-dasharray="4,3"', c["ink"], c["muted"]
    else:
        fill, stroke, sw, dash, tc, sc = c["paper"], c["ink"], 1, "", c["ink"], c["muted"]
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{c["paper"]}"/>',
           f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{dash}/>']
    if tag:
        tw = max(36, int(len(tag) * 0.62 * 7) + 12)
        out += [f'<rect x="{x+8}" y="{y+8}" width="{tw}" height="12" rx="2" fill="none" stroke="{sc}" stroke-opacity="0.5" stroke-width="0.8"/>',
                f'<text x="{x+8+tw/2}" y="{y+17}" fill="{sc}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{esc(tag)}</text>']
    cx = x + w / 2
    lines = [s for s in (sub, sub2) if s]
    base = y + h / 2 + (6 if tag else 4) - 8 * (len(lines) - 1)
    if not lines: base = y + h / 2 + (8 if tag else 4)
    out.append(f'<text x="{cx}" y="{base}" fill="{tc}" font-size="13" font-weight="600" font-family="{SANS}" text-anchor="middle">{esc(name)}</text>')
    for i, s in enumerate(lines):
        out.append(f'<text x="{cx}" y="{base+16+14*i}" fill="{sc}" font-size="9" font-family="{MONO}" text-anchor="middle">{esc(s)}</text>')
    return "\n".join(out)

def label(c, x, y, w, text, anchor="middle"):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="12" rx="2" fill="{c["paper"]}"/>'
            f'<text x="{x+w/2}" y="{y+9}" fill="{c["soft"]}" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.06em">{esc(text)}</text>')

def lw(text, size=8): return int(len(text) * 0.62 * size) + 10 + (4 - (int(len(text) * 0.62 * size) + 10) % 4) % 4

def zone(c, x, y, w, h, text, off=16):
    l = int(len(text) * 0.62 * 7) + 16
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{c["zone_fill"]}" stroke="{c["zone_stroke"]}" stroke-width="0.8"/>'
            f'<rect x="{x+off}" y="{y-6}" width="{l}" height="12" rx="2" fill="{c["paper"]}"/>'
            f'<text x="{x+off+l/2}" y="{y+3}" fill="{c["soft"]}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.14em">{esc(text)}</text>')

def arrow(c, d, kind="default", dash=False):
    col = {"default": c["muted"], "accent": c["accent"]}[kind]
    mk = {"default": "arrow", "accent": "arrow-accent"}[kind]
    sw = 1.6 if kind == "accent" else 1.2
    da = ' stroke-dasharray="5,4"' if dash else ""
    return f'<path d="{d}" fill="none" stroke="{col}" stroke-width="{sw}"{da} marker-end="url(#{mk})"/>'

def defs(c):
    return (f'<defs><marker id="arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{c["muted"]}"/></marker>'
            f'<marker id="arrow-accent" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{c["accent"]}"/></marker>'
            f'<marker id="arrow-link" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{c["link"]}"/></marker>'
            f'<marker id="arrow-open" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polyline points="0 0, 8 3, 0 6" fill="none" stroke="{c["muted"]}" stroke-width="1.2"/></marker></defs>')

def legend(c, y, items, width):
    out = [f'<line x1="32" y1="{y-24}" x2="{width-32}" y2="{y-24}" stroke="{c["rule"]}" stroke-width="0.8"/>',
           f'<text x="32" y="{y+4}" fill="{c["muted"]}" font-size="8" font-family="{MONO}" letter-spacing="0.14em">LEGEND</text>']
    x = 112
    for kind, text in items:
        if kind == "focal": sw = f'<rect x="{x}" y="{y-6}" width="20" height="14" rx="3" fill="{c["tint"]}" stroke="{c["accent"]}" stroke-width="1.2"/>'
        elif kind == "external": sw = f'<rect x="{x}" y="{y-6}" width="20" height="14" rx="3" fill="{c["paper"]}" stroke="{c["muted"]}" stroke-width="1" stroke-dasharray="4,3"/>'
        elif kind == "user": sw = f'<rect x="{x}" y="{y-6}" width="20" height="14" rx="3" fill="{c["user_fill"]}" stroke="{c["muted"]}" stroke-width="1"/>'
        elif kind == "line": sw = f'<line x1="{x}" y1="{y+1}" x2="{x+20}" y2="{y+1}" stroke="{c["muted"]}" stroke-width="1.2"/>'
        elif kind == "dashed": sw = f'<line x1="{x}" y1="{y+1}" x2="{x+20}" y2="{y+1}" stroke="{c["muted"]}" stroke-width="1.2" stroke-dasharray="5,4"/>'
        elif kind == "accentline": sw = f'<line x1="{x}" y1="{y+1}" x2="{x+20}" y2="{y+1}" stroke="{c["accent"]}" stroke-width="1.6"/>'
        else: sw = f'<rect x="{x}" y="{y-6}" width="20" height="14" rx="3" fill="{c["paper"]}" stroke="{c["ink"]}" stroke-width="1"/>'
        out += [sw, f'<text x="{x+28}" y="{y+5}" fill="{c["ink"]}" font-size="10" font-family="{SANS}">{esc(text)}</text>']
        x += 28 + int(len(text) * 6.2) + 40
    return "\n".join(out)

def page(slug_base, skin, title, desc, w, h, body, eyebrow="Architecture"):
    c = SK[skin]
    slug = slug_base + ("-dark" if skin == "dark" else "")
    svg = (f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">\n'
           f'<title id="{slug}-title">{esc(title)}</title>\n<desc id="{slug}-desc">{esc(desc)}</desc>\n{defs(c)}\n'
           f'<rect width="100%" height="100%" fill="{c["paper"]}"/>\n{body}\n</svg>')
    html = f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:{SANS};background:{c['paper']};color:{c['ink']};min-height:100vh;display:flex;align-items:center;justify-content:center;padding:3rem 2rem}}
.frame{{max-width:{w+40}px;width:100%}}.diagram-container{{width:100%;overflow-x:auto}}
.eyebrow{{font-family:{MONO};font-size:.66rem;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:{c['muted']};margin-bottom:.5rem}}
h1{{font-family:{SANS};font-size:1.75rem;font-weight:600;letter-spacing:-.02em;line-height:1.15;margin-bottom:1.5rem}}
svg{{width:100%;min-width:{w}px;display:block}}@media print{{.diagram-container{{overflow-x:visible}}svg{{min-width:0}}}}</style></head>
<body><div class="frame"><p class="eyebrow">{esc(eyebrow)}</p><h1>{esc(title)}</h1>
<div class="diagram-container">
{svg}
</div></div></body></html>'''
    open(f"{slug}.html", "w").write(html)

def seq(c, actors, msgs, top=64, bottom=None, act_bars=(), frames=(), width=1280):
    """actors: [(x, name, sub, kind)]; msgs: [(y, from_x, to_x, text, style)] style in call|return|async|accent|self|selfaccent."""
    p = []
    bottom = bottom or max(m[0] for m in msgs) + 48
    for (fx, fy, fw, fh, op, guard) in frames:
        p += [f'<rect x="{fx}" y="{fy}" width="{fw}" height="{fh}" rx="4" fill="{c["frame"]}" stroke="{c["frame_stroke"]}" stroke-width="1"/>',
              f'<rect x="{fx}" y="{fy}" width="40" height="16" rx="2" fill="{c["paper"]}" stroke="{c["frame_stroke"]}" stroke-width="1"/>',
              f'<text x="{fx+20}" y="{fy+12}" fill="{c["muted"]}" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.12em">{op}</text>',
              f'<text x="{fx+52}" y="{fy+12}" fill="{c["muted"]}" font-size="8" font-family="{MONO}" letter-spacing="0.04em">{esc(guard)}</text>']
    for (x, name, sub, kind) in actors:
        p.append(f'<line x1="{x}" y1="{top+48}" x2="{x}" y2="{bottom}" stroke="{c["life"]}" stroke-width="1" stroke-dasharray="3,3"/>')
    for (x, y1, y2) in act_bars:
        p.append(f'<rect x="{x-4}" y="{y1}" width="8" height="{y2-y1}" fill="{c["act"]}" stroke="{c["muted"]}" stroke-width="0.8"/>')
    for (y, a, b, text, style) in msgs:
        if style in ("self", "selfaccent"):
            col = c["accent"] if style == "selfaccent" else c["muted"]
            mk = "arrow-accent" if style == "selfaccent" else "arrow"
            p.append(f'<path d="M{a+4},{y} H{a+36} Q{a+44},{y} {a+44},{y+8} V{y+16} Q{a+44},{y+24} {a+36},{y+24} H{a+6}" fill="none" stroke="{col}" stroke-width="{1.6 if style=="selfaccent" else 1.2}" marker-end="url(#{mk})"/>')
            w = lw(text)
            p.append(label(c, a + 52, y + 6, w, text))
            continue
        d = 1 if b > a else -1
        x1, x2 = a + 4 * d, b - 6 * d
        if style == "return":
            p.append(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{c["muted"]}" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#arrow)"/>')
        elif style == "async":
            p.append(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{c["muted"]}" stroke-width="1.2" stroke-dasharray="5,4" marker-end="url(#arrow-open)"/>')
        elif style == "accent":
            p.append(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{c["accent"]}" stroke-width="1.6" marker-end="url(#arrow-accent)"/>')
        else:
            p.append(f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="{c["muted"]}" stroke-width="1.2" marker-end="url(#arrow)"/>')
        w = lw(text)
        # label sits next to the source, inside the first gap between lifelines
        xs = sorted(x for x, *_ in actors)
        nxt = min((xx for xx in xs if (xx - a) * d > 0), key=lambda xx: abs(xx - a))
        mid = (a + nxt) / 2
        p.append(label(c, mid - w / 2, y - 20, w, text))
    for (x, name, sub, kind) in actors:
        p.append(node(c, x - 92, top, 184, 48, "", name, sub, kind))
    return "\n".join(p)
