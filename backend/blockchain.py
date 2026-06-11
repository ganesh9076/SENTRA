

from fastapi import APIRouter
import hashlib
import time

router = APIRouter()

# ── In-memory chain (replace with DB later) ──────────
blockchain = [{
    "num":   0,
    "hash":  "0000a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
    "prev":  "0" * 64,
    "data":  "GENESIS BLOCK",
    "nonce": 0,
    "ts":    "2024-01-01 00:00:00"
}]


def sha256_hash(num, prev, data, nonce, ts) -> str:
    text = f"{num}{prev}{data}{nonce}{ts}"
    return hashlib.sha256(text.encode()).hexdigest()


# ── Endpoints ─────────────────────────────────────────

@router.get("")
def get_chain():
    """Return full blockchain."""
    return {"blocks": blockchain, "length": len(blockchain)}


@router.post("/mine")
def mine_block(data: dict):
    """
    Mine a new block with proof-of-work (hash must start with '0000').
    Body: { "data": "some string" }
    """
    last  = blockchain[-1]
    ts    = time.strftime("%Y-%m-%d %H:%M:%S")
    nonce = 0

    while True:
        h = sha256_hash(last["num"] + 1, last["hash"], data.get("data", "BLOCK"), nonce, ts)
        if h.startswith("0000"):
            break
        nonce += 1
        if nonce > 200000:
            return {"error": "Mining timeout — nonce exceeded 200k"}

    new_block = {
        "num":   last["num"] + 1,
        "hash":  h,
        "prev":  last["hash"],
        "data":  data.get("data", "BLOCK"),
        "nonce": nonce,
        "ts":    ts
    }
    blockchain.append(new_block)
    return {"block": new_block, "mined": True, "attempts": nonce}