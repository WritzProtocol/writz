"""
Shared design system for all Writz Protocol diagrams.
Professional palette · transparent background · light/dark compatible.
Accent: amber (#E3A646) — the protocol's signature color.
"""

# ── Background ────────────────────────────────────────────────────────────────
BGCOLOR = "transparent"

# ── Typography ────────────────────────────────────────────────────────────────
FONT   = "Helvetica"
T_DARK = "#1C1917"   # stone-900  — primary text
T_MED  = "#57534E"   # stone-600  — secondary / edge labels
T_LITE = "#A8A29E"   # stone-400  — minor annotations

# ── Node fills — light "card" look, readable on any background ───────────────
F_DEFAULT  = "#FAFAF9"   # stone-50   — general nodes
F_BITCOIN  = "#FFF7ED"   # orange-50  — Bitcoin layer
F_ZK       = "#F0F9FF"   # sky-50     — ZK / circuit nodes
F_STELLAR  = "#EFF6FF"   # blue-50    — Soroban / Stellar contracts
F_FRONTEND = "#ECFDF5"   # emerald-50 — Frontend / browser
F_RELAYER  = "#FAF5FF"   # purple-50  — Relayer / infra
F_DECISION = "#FFFBEB"   # amber-50   — Decision / gate
F_SUCCESS  = "#F0FDF4"   # green-50   — Success / terminal
F_DANGER   = "#FEF2F2"   # red-50     — Error / liquidation

# ── Borders ───────────────────────────────────────────────────────────────────
B_DEFAULT  = "#78716C"   # stone-500
B_BITCOIN  = "#EA580C"   # orange-600
B_ZK       = "#0284C7"   # sky-600
B_STELLAR  = "#2563EB"   # blue-600
B_FRONTEND = "#059669"   # emerald-600
B_RELAYER  = "#7C3AED"   # purple-600
B_DECISION = "#D97706"   # amber-600  — same as protocol amber (approx)
B_SUCCESS  = "#16A34A"   # green-600
B_DANGER   = "#DC2626"   # red-600
B_AMBER    = "#E3A646"   # Writz amber — used for key accent edges/nodes

# ── Edges ─────────────────────────────────────────────────────────────────────
E_DEFAULT  = "#A8A29E"   # stone-400
E_MAIN     = "#E3A646"   # Writz amber — primary flow
E_BITCOIN  = "#EA580C"   # orange-600
E_ZK       = "#0284C7"   # sky-600
E_STELLAR  = "#2563EB"   # blue-600
E_DANGER   = "#DC2626"   # red-600


def render(g, name: str, out: str = "docs/diagrams/output") -> None:
    """Render graph to both SVG and PNG."""
    from pathlib import Path
    Path(out).mkdir(parents=True, exist_ok=True)
    svg = g.pipe(format="svg")
    png = g.pipe(format="png")
    Path(f"{out}/{name}.svg").write_bytes(svg)
    Path(f"{out}/{name}.png").write_bytes(png)
    print(f"  ✓ {name}  (.svg + .png)")


def base_graph_attr(**extra):
    return {
        "bgcolor": BGCOLOR,
        "fontname": FONT,
        "fontsize": "13",
        "fontcolor": T_DARK,
        "labelloc": "t",
        "labeljust": "l",
        "pad": "0.7",
        "nodesep": "0.55",
        "ranksep": "0.9",
        "dpi": "150",
        **extra,
    }


def base_node_attr(**extra):
    return {
        "shape": "box",
        "style": "filled,rounded",
        "fillcolor": F_DEFAULT,
        "color": B_DEFAULT,
        "fontname": FONT,
        "fontsize": "11",
        "fontcolor": T_DARK,
        "margin": "0.22,0.13",
        "penwidth": "1.6",
        **extra,
    }


def base_edge_attr(**extra):
    return {
        "color": E_DEFAULT,
        "fontname": FONT,
        "fontsize": "10",
        "fontcolor": T_MED,
        "arrowsize": "0.85",
        "penwidth": "1.4",
        **extra,
    }


def _escape(text: str) -> str:
    """Escape special HTML characters in label text content."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def hl(title: str, subtitle: str = "", subtitle2: str = "") -> str:
    """HTML label: bold title + optional smaller subtitle lines."""
    s = f"<B>{_escape(title)}</B>"
    if subtitle:
        s += f'<BR/><FONT POINT-SIZE="9" COLOR="{T_MED}">{_escape(subtitle)}</FONT>'
    if subtitle2:
        s += f'<BR/><FONT POINT-SIZE="9" COLOR="{T_LITE}">{_escape(subtitle2)}</FONT>'
    return f"<{s}>"


def cluster_attr(label: str, color: str, subtitle: str = "") -> dict:
    lbl = f"<<B>{_escape(label)}</B>"
    if subtitle:
        lbl += f'<BR/><FONT POINT-SIZE="9" COLOR="{T_MED}">{_escape(subtitle)}</FONT>'
    lbl += ">"
    return {
        "label": lbl,
        "style": "rounded",
        "color": color,
        "fontcolor": color,
        "fontname": FONT,
        "fontsize": "12",
        "penwidth": "2.5",
        "margin": "18",
    }
