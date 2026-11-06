from wz import *
B, BTC, R, L, S = 140, 390, 640, 890, 1140
A = [(B, "Borrower", "", "user"), (BTC, "Bitcoin", "", "default"), (R, "Relayer", "", "default"),
     (L, "writz-lend", "", "focal"), (S, "bitcoin-spv", "", "default")]
M = [(176, B, BTC, "LOCK BTC", "call"),
     (224, R, S, "HEADERS", "async"),
     (272, B, R, "REQUEST PROOF", "call"),
     (312, R, B, "SPV PROOF", "return"),
     (360, B, L, "DEPOSIT + PROOF", "call"),
     (400, L, S, "VERIFY TX", "call"),
     (440, S, L, "CONFIRMED", "return"),
     (468, L, L, "CHECK SCRIPT, KEY", "self"),
     (528, L, B, "POSITION OPEN", "return"),
     (576, B, L, "BORROW USDC", "call"),
     (604, L, L, "PRICE, HEALTH", "self"),
     (664, L, B, "USDC", "accent")]
def body(skin):
    c = SK[skin]
    s = seq(c, A, M, act_bars=[(L, 360, 528), (L, 576, 664)], bottom=704)
    note = f'<text x="40" y="748" fill="{c["muted"]}" font-size="13" font-style="italic" font-family="{SANS}">The deposit also carries the pre-signed liquidation steps; borrow sets a maturity in Bitcoin blocks.</text>'
    return s + "\n" + note + "\n" + legend(c, 808, [("line", "Call"), ("dashed", "Return or event"), ("accentline", "USDC to the borrower")], 1280)
for sk in ("light", "dark"):
    page("deposit-and-borrow", sk, "From a Bitcoin deposit to a USDC loan",
         "The borrower locks Bitcoin, gets an SPV proof from the relayer, deposits it to writz-lend, which verifies the transaction through bitcoin-spv and opens the position, then borrows USDC after a price and health check.",
         1280, 848, body(sk), eyebrow="Sequence")
