from wz import *
R, U, L, S = 112, 336, 576, 816
A = [(R, "Relayer", "", "default"), (U, "User", "browser", "user"), (L, "writz-lend", "", "focal"), (S, "bitcoin-spv", "", "default")]
M = [(176, R, U, "SPV PROOF", "return"),
     (204, U, U, "SIGN (BIP-137)", "self"),
     (272, U, L, "DEPOSIT", "call"),
     (300, L, L, "CHECK SCRIPT", "self"),
     (368, L, S, "VERIFY TX", "call"),
     (408, S, L, "RESULT", "return"),
     (436, L, L, "CHECK H, SIG", "self"),
     (504, L, S, "CONSUME TXID", "call"),
     (532, L, L, "STORE, EMIT", "selfaccent"),
     (608, L, U, "POSITION OPEN", "return")]
def body(skin):
    c = SK[skin]
    s = seq(c, A, M, act_bars=[(L, 272, 608), (S, 368, 408)], bottom=648, aw=176)
    note = f'<text x="24" y="692" fill="{c["muted"]}" font-size="{F_NOTE}" font-style="italic" font-family="{SANS}">One call does it all: if any check fails, the deposit reverts and nothing is stored.</text>'
    return s + "\n" + note + "\n" + legend(c, 752, [("line", "Call"), ("dashed", "Return"), ("accentline", "Position recorded")], 960)
for sk in ("light", "dark"):
    page("deposit-calls", sk, "What happens inside a deposit",
         "The user gets an SPV proof from the relayer, signs a key-control message with the Bitcoin wallet and calls writz-lend deposit; writz-lend checks the script, asks bitcoin-spv to verify the transaction, checks the timelock height and the signature, consumes the txid in bitcoin-spv and stores the position.",
         960, 792, body(sk), eyebrow="Sequence")
