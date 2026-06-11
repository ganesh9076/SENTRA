
from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import logging
import platform
import random
import re
import socket
import subprocess
import threading
import time
from datetime import datetime
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

import base64
import secrets
import string
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("sentra")

# ── Config (override via env vars in production) ──────────────────────────────

API_KEY         = "sentra-dev-key"
MAX_BODY_BYTES  = 64 * 1024
THREAT_FEED_URL = "https://feodotracker.abuse.ch/downloads/ipblocklist.txt"
URLHAUS_URL     = "https://urlhaus-api.abuse.ch/v1/host/"
MALBAZAAR_URL   = "https://mb-api.abuse.ch/api/v1/"
IPAPI_URL       = "http://ip-api.com/json/{ip}?fields=country,isp,org,as,proxy,hosting"

DEBUG_MODE = True

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="SENTRA", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5501", "http://localhost:5501", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth middleware ───────────────────────────────────────────────────────────

class APIKeyMiddleware(BaseHTTPMiddleware):
    """Require X-API-Key header on all non-WebSocket routes."""

    EXEMPT_PATHS = {"/docs", "/openapi.json", "/redoc"}

    async def dispatch(self, request: Request, call_next):
        if request.url.path in self.EXEMPT_PATHS:
            return await call_next(request)
        if request.headers.get("upgrade", "").lower() == "websocket":
            return await call_next(request)

        key = request.headers.get("X-API-Key", "")

        if DEBUG_MODE:
            log.warning(f"DEBUG AUTH: Path={request.url.path} | Key received='{key}' | Expected='{API_KEY}'")
            if key != API_KEY:
                log.error(f"DEBUG AUTH: Would block this request in production! Key mismatch.")
            return await call_next(request)

        if key != API_KEY:
            raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")
        return await call_next(request)


app.add_middleware(APIKeyMiddleware)

# ── Body-size guard ───────────────────────────────────────────────────────────

@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Request body too large")
    return await call_next(request)

# ── Shared async HTTP client ──────────────────────────────────────────────────

http: httpx.AsyncClient | None = None

@app.on_event("startup")
async def on_startup():
    global http
    http = httpx.AsyncClient(timeout=8.0)
    log.info("SENTRA backend started")
    if DEBUG_MODE:
        log.warning("=" * 50)
        log.warning("DEBUG MODE ENABLED - AUTH BYPASSED")
        log.warning("Set DEBUG_MODE = False for production!")
        log.warning("=" * 50)

@app.on_event("shutdown")
async def on_shutdown():
    if http:
        await http.aclose()

# ========== BLOCKCHAIN ==========

def _sha256(num: int, prev: str, data: str, nonce: int, ts: str) -> str:
    text = f"{num}{prev}{data}{nonce}{ts}"
    return hashlib.sha256(text.encode()).hexdigest()


def _build_genesis() -> dict:
    ts    = "2024-01-01 00:00:00"
    nonce = 0
    h     = _sha256(0, "0" * 64, "GENESIS BLOCK", nonce, ts)
    return {"num": 0, "hash": h, "prev": "0" * 64,
            "data": "GENESIS BLOCK", "nonce": nonce, "ts": ts}


blockchain: list[dict] = [_build_genesis()]


def _mine_sync(last: dict, data_str: str) -> dict | None:
    """CPU-bound PoW — runs in a thread pool."""
    ts    = time.strftime("%Y-%m-%d %H:%M:%S")
    nonce = 0
    while nonce <= 200_000:
        h = _sha256(last["num"] + 1, last["hash"], data_str, nonce, ts)
        if h.startswith("0000"):
            return {"num": last["num"] + 1, "hash": h, "prev": last["hash"],
                    "data": data_str, "nonce": nonce, "ts": ts}
        nonce += 1
    return None


@app.get("/api/blockchain")
def get_chain():
    return {"blocks": blockchain}


@app.post("/api/blockchain/mine")
async def mine_block(data: dict):
    data_str = str(data.get("data", "BLOCK"))[:512]
    last     = blockchain[-1]
    block    = await run_in_threadpool(_mine_sync, last, data_str)
    if block is None:
        raise HTTPException(status_code=408, detail="Mining timeout — nonce limit reached")
    blockchain.append(block)
    return {"block": block, "mined": True, "attempts": block["nonce"]}


# ========== REAL-TIME THREAT FEED ==========

threat_feed: dict[str, Any] = {"ips": set(), "last_updated": None}
THREAT_LOCK = threading.Lock()


def _update_threat_feed():
    while True:
        try:
            res = httpx.get(THREAT_FEED_URL, timeout=10)
            new_ips: set[str] = set()
            for line in res.text.splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    try:
                        ipaddress.ip_address(line)
                        new_ips.add(line)
                    except ValueError:
                        pass
            with THREAT_LOCK:
                threat_feed["ips"]          = new_ips
                threat_feed["last_updated"] = time.time()
            log.info("Threat feed updated — %d IPs loaded", len(new_ips))
        except Exception as exc:
            log.error("Threat feed update failed: %s", exc)
        time.sleep(60)


threading.Thread(target=_update_threat_feed, daemon=True, name="threat-feed").start()


@app.get("/api/threat-feed")
def get_threat_feed():
    with THREAT_LOCK:
        return {
            "total_ips":    len(threat_feed["ips"]),
            "last_updated": threat_feed["last_updated"],
        }


# ========== THREAT CHECK ==========

def _validate_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


@app.post("/api/threat/check")
async def threat_check(data: dict):
    value       = str(data.get("value", "")).strip()[:256]
    source_node = str(data.get("source_node", "UNKNOWN"))[:64]
    check_time  = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    if not value:
        raise HTTPException(status_code=400, detail="Empty input")

    if _validate_ip(value):
        result = await _check_ip(value, source_node)
    elif re.match(r"^[a-f0-9]{32}$", value, re.I):
        result = await _check_hash(value, "MD5", source_node)
    elif re.match(r"^[a-f0-9]{64}$", value, re.I):
        result = await _check_hash(value, "SHA256", source_node)
    else:
        result = await _check_domain(value, source_node)

    result["checked_at"] = check_time
    return result


async def _check_ip(ip: str, source_node: str) -> dict:
    try:
        geo_resp = await http.get(IPAPI_URL.format(ip=ip))
        geo      = geo_resp.json()
    except Exception:
        geo = {}

    score   = 20
    reasons = []
    cat     = "unknown"

    with THREAT_LOCK:
        if ip in threat_feed["ips"]:
            score += 70
            cat    = "malware"
            reasons.append("Matched real-time threat feed")

    if geo.get("proxy") or geo.get("hosting"):
        score += 40
        reasons.append("VPN/Proxy/Hosting detected")
        cat = "suspicious"

    try:
        addr = ipaddress.ip_address(ip)
        if addr.is_private:
            score   = 5
            cat     = "safe"
            reasons = ["Private RFC1918 address"]
        elif str(addr).startswith(("185.220.", "45.142.", "91.108.")):
            score += 50
            reasons.append("Known Tor exit / C2 range")
            cat = "malware"
    except ValueError:
        pass

    try:
        flag   = "-n" if platform.system() == "Windows" else "-c"
        result = await run_in_threadpool(
            subprocess.run, ["ping", flag, "1", ip],
            capture_output=True, timeout=3
        )
        reachable = result.returncode == 0
    except Exception:
        reachable = False

    return {
        "cat":         cat or "unknown",
        "score":       min(score, 100),
        "reason":      " | ".join(reasons) or "No threat signals",
        "source_node": source_node,
        "country":     geo.get("country", "??"),
        "asn":         geo.get("as", "—"),
        "first":       "—",
        "last":        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "reachable":   reachable,
    }


async def _check_domain(domain: str, source_node: str) -> dict:
    score   = 30
    reasons = []
    cat     = "unknown"

    try:
        r = await http.post(URLHAUS_URL, data={"host": domain})
        rj = r.json()
        if rj.get("query_status") == "is_listed":
            score += 60
            cat    = "malware"
            threat = rj.get("urls", [{}])[0].get("threat", "malware")
            reasons.append(f"URLhaus: {threat}")
    except Exception:
        pass

    try:
        ips = await run_in_threadpool(socket.gethostbyname_ex, domain)
        reasons.append(f"Resolves to: {', '.join(ips[2][:2])}")
    except Exception:
        reasons.append("Does not resolve")
        score += 10

    if re.search(r"paypa[l1]|amaz[o0]n|goog[l1]e|micros0ft", domain, re.I):
        score += 30
        cat    = "phishing"
        reasons.append("Brand impersonation")

    if domain.endswith((".tk", ".ml", ".ga", ".cf", ".ru", ".xyz")):
        score += 15
        reasons.append("Suspicious TLD")

    if not reasons:
        reasons.append("No suspicious patterns found")

    return {
        "cat":         cat if score > 60 else ("suspicious" if score > 40 else "safe"),
        "score":       min(score, 100),
        "reason":      " | ".join(reasons),
        "source_node": source_node,
        "country":     "??",
        "asn":         "—",
        "first":       "—",
        "last":        datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }


async def _check_hash(hash_val: str, hash_type: str, source_node: str) -> dict:
    try:
        r  = await http.post(MALBAZAAR_URL, data={"query": "get_info", "hash": hash_val})
        rj = r.json()
        if rj.get("query_status") == "hash_not_found":
            return {
                "cat": "unknown", "score": 30,
                "reason": "Hash not found in MalwareBazaar — may be clean",
                "source_node": source_node, "country": "—", "asn": "—",
                "first": "—", "last": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
        info = rj.get("data", [{}])[0]
        tags = ", ".join(info.get("tags", ["?"])[:3])
        return {
            "cat":         "malware",
            "score":       95,
            "reason":      f"MalwareBazaar: {info.get('signature','Unknown')} | Tags: {tags}",
            "source_node": source_node,
            "country":     "—",
            "asn":         "—",
            "first":       info.get("first_seen", "—"),
            "last":        info.get("last_seen", "—"),
        }
    except Exception as exc:
        return {
            "cat": "unknown", "score": 50, "reason": f"Lookup failed: {exc}",
            "source_node": source_node, "country": "—", "asn": "—",
            "first": "—", "last": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }


# ========== GOSSIP ENGINE ==========

class GossipEngine:
    TICK_INTERVAL = 2.0
    TRAVEL_DELAY  = 0.8

    def __init__(self):
        self.clients:        list[WebSocket] = []
        self.nodes:          dict[str, dict] = {}
        self.node_index:     list[str]       = []
        self.edges:          list[list]      = []
        self.edge_hops:      dict[str, int]  = {}
        self.firewall_edges: set[str]        = set()
        self.running:        bool            = False
        self.tick_task:      asyncio.Task | None = None
        self.total_reached    = 0
        self.total_immune     = 0
        self.total_quarantine = 0
        self._loop: asyncio.AbstractEventLoop | None = None

    # ── helpers ──────────────────────────────────────────────────────────────

    def _ekey(self, a: str, b: str) -> str:
        return f"{min(a,b)}-{max(a,b)}"

    def _is_firewalled(self, a: str, b: str) -> bool:
        return self._ekey(a, b) in self.firewall_edges

    def _containment_score(self) -> int:
        total = len(self.nodes)
        if total == 0:
            return 100
        immune     = sum(1 for n in self.nodes.values() if n["state"] == "immune")
        quarantine = sum(1 for n in self.nodes.values() if n["state"] == "quarantined")
        clean      = sum(1 for n in self.nodes.values() if n["state"] == "clean")
        score = ((immune * 1.0 + quarantine * 0.5 + clean * 0.8) / total) * 100
        return round(min(score, 100))

    # ── full reset (wipes ALL simulation state) ───────────────────────────────

    def full_reset(self):
        """
        Wipe every piece of simulation state so stale infected/immune
        statuses can never bleed into a fresh Node Manager session.
        Called by the REST endpoint and the WS 'reset' action.
        """
        self.nodes            = {}
        self.node_index       = []
        self.edges            = []
        self.edge_hops        = {}
        self.firewall_edges   = set()
        self.running          = False
        self.total_reached    = 0
        self.total_immune     = 0
        self.total_quarantine = 0
        log.info("GossipEngine: full state reset")

    # ── WS management ────────────────────────────────────────────────────────

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.clients.append(ws)
        self._loop = asyncio.get_event_loop()

        # FIX: Only send node states when a simulation is actively running.
        # Sending stale states to fresh clients was causing newly-registered
        # Node Manager cards to appear infected even before propagation.
        await self._send(ws, {
            "type":           "sync",
            "nodes":          [
                {"lbl": n["lbl"], "state": n["state"], "score": n["score"]}
                for n in self.nodes.values()
            ] if self.running else [],
            "edge_hops":      self.edge_hops if self.running else {},
            "firewall_edges": list(self.firewall_edges),
            "running":        self.running,
            "total_reached":  self.total_reached,
            "total_immune":   self.total_immune,
            "containment":    self._containment_score(),
        })
        log.info("WS connected — total clients: %d", len(self.clients))

    def disconnect(self, ws: WebSocket):
        self.clients = [c for c in self.clients if c != ws]
        log.info("WS disconnected — total clients: %d", len(self.clients))

    async def broadcast(self, msg: dict):
        dead = []
        for ws in self.clients:
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def _send(self, ws: WebSocket, msg: dict):
        try:
            await ws.send_json(msg)
        except Exception:
            pass

    # ── graph ────────────────────────────────────────────────────────────────

    def load_graph(self, node_list: list, edge_list: list):
        self.nodes      = {}
        self.node_index = []
        self.edge_hops  = {}
        self.edges      = edge_list
        self.firewall_edges = set()

        for n in node_list:
            lbl = n["lbl"]
            self.nodes[lbl] = {
                "id": n["id"], "lbl": lbl,
                "state": "clean", "score": 0, "peers": [],
            }
            self.node_index.append(lbl)

        for e in edge_list:
            a = self.node_index[e[0]]
            b = self.node_index[e[1]]
            if b not in self.nodes[a]["peers"]:
                self.nodes[a]["peers"].append(b)
            if a not in self.nodes[b]["peers"]:
                self.nodes[b]["peers"].append(a)
            self.edge_hops[self._ekey(a, b)] = 0

    # ── start ────────────────────────────────────────────────────────────────

    async def start(self, start_lbl: str, threat_score: int,
                    node_list: list, edge_list: list):
        await self.stop()
        self.load_graph(node_list, edge_list)
        self.total_reached    = 1
        self.total_immune     = 0
        self.total_quarantine = 0
        self._loop            = asyncio.get_event_loop()

        seed = self.nodes.get(start_lbl)
        if not seed:
            return {"error": f"Node {start_lbl} not found"}

        seed["state"] = "infected"
        seed["score"] = threat_score

        await self.broadcast({
            "type":       "start",
            "node":       start_lbl,
            "score":      threat_score,
            "node_count": len(self.nodes),
            "edge_count": len(self.edges),
        })
        self.running   = True
        self.tick_task = asyncio.create_task(self._tick_loop())
        log.info("Gossip started at %s | score=%d", start_lbl, threat_score)
        return {"ok": True, "start_node": start_lbl, "score": threat_score}

    async def stop(self):
        self.running = False
        if self.tick_task:
            self.tick_task.cancel()
            try:
                await self.tick_task
            except asyncio.CancelledError:
                pass
            self.tick_task = None

    # ── firewall toggle ───────────────────────────────────────────────────────

    async def toggle_firewall(self, node_a: str, node_b: str):
        key = self._ekey(node_a, node_b)
        if key in self.firewall_edges:
            self.firewall_edges.discard(key)
            action = "removed"
        else:
            self.firewall_edges.add(key)
            action = "added"
            for lbl in [node_a, node_b]:
                node = self.nodes.get(lbl)
                if node and node["state"] == "infected":
                    all_blocked = all(
                        self._is_firewalled(lbl, peer)
                        for peer in node["peers"]
                    )
                    if all_blocked:
                        node["state"] = "quarantined"
                        self.total_quarantine += 1
                        await self.broadcast({
                            "type":        "quarantined",
                            "node":        lbl,
                            "containment": self._containment_score(),
                        })
                        log.info("Gossip: %s quarantined — all edges blocked", lbl)

        await self.broadcast({
            "type":           "firewall",
            "edge":           key,
            "action":         action,
            "firewall_edges": list(self.firewall_edges),
            "containment":    self._containment_score(),
        })
        log.info("Firewall edge %s %s", key, action)

    # ── tick loop ─────────────────────────────────────────────────────────────

    async def _tick_loop(self):
        while self.running:
            await asyncio.sleep(self.TICK_INTERVAL)

            infected = [n for n in self.nodes.values() if n["state"] == "infected"]
            if not infected:
                break

            candidates = []
            for node in infected:
                for peer_lbl in node["peers"]:
                    if self._is_firewalled(node["lbl"], peer_lbl):
                        continue
                    peer = self.nodes[peer_lbl]
                    if peer["state"] != "clean":
                        continue
                    candidates.append((node, peer_lbl))

            for node, peer_lbl in candidates:
                if not self.running:
                    return

                spread_prob  = node["score"] / 100.0
                defense_prob = 1.0 - spread_prob

                key = self._ekey(node["lbl"], peer_lbl)
                self.edge_hops[key] = self.edge_hops.get(key, 0) + 1

                await self.broadcast({
                    "type":      "hop",
                    "from":      node["lbl"],
                    "to":        peer_lbl,
                    "hop_count": self.edge_hops[key],
                    "score":     node["score"],
                })

                await asyncio.sleep(self.TRAVEL_DELAY)

                peer = self.nodes.get(peer_lbl)
                if not peer or peer["state"] != "clean":
                    continue
                if self._is_firewalled(node["lbl"], peer_lbl):
                    continue

                if random.random() < spread_prob:
                    peer["state"] = "infected"
                    peer["score"] = node["score"]
                    self.total_reached += 1
                    await self.broadcast({
                        "type":          "infected",
                        "node":          peer_lbl,
                        "status":        "infected",
                        "score":         node["score"],
                        "total_reached": self.total_reached,
                        "containment":   self._containment_score(),
                    })
                    log.info("Gossip: %s INFECTED by %s", peer_lbl, node["lbl"])
                else:
                    peer["state"] = "immune"
                    self.total_immune += 1
                    await self.broadcast({
                        "type":         "immune",
                        "node":         peer_lbl,
                        "status":       "immune",
                        "defended_by":  node["lbl"],
                        "defense_prob": round(defense_prob * 100),
                        "total_immune": self.total_immune,
                        "containment":  self._containment_score(),
                    })
                    log.info("Gossip: %s IMMUNE — defended against %s", peer_lbl, node["lbl"])

            still_reachable = any(
                self.nodes[p]["state"] == "clean"
                and not self._is_firewalled(n["lbl"], p)
                for n in self.nodes.values()
                if n["state"] == "infected"
                for p in n["peers"]
            )
            if not still_reachable:
                self.running = False
                containment  = self._containment_score()
                await self.broadcast({
                    "type":             "complete",
                    "total_nodes":      len(self.nodes),
                    "total_reached":    self.total_reached,
                    "total_immune":     self.total_immune,
                    "total_quarantine": self.total_quarantine,
                    "containment":      containment,
                    "edge_hops":        self.edge_hops,
                    "timestamp":        datetime.now().isoformat(),
                })
                log.info(
                    "Gossip complete | infected=%d immune=%d quarantine=%d containment=%d",
                    self.total_reached, self.total_immune,
                    self.total_quarantine, containment,
                )
                break


gossip = GossipEngine()


# ========== PACKET MONITOR ==========

def _process_packet(packet):
    """Called from Scapy sniff thread — must NOT use asyncio directly."""
    try:
        from scapy.all import IP as ScapyIP
        if not packet.haslayer(ScapyIP):
            return
        src = packet[ScapyIP].src
        dst = packet[ScapyIP].dst

        with THREAT_LOCK:
            matched_ip = src if src in threat_feed["ips"] else (
                dst if dst in threat_feed["ips"] else None
            )

        if matched_ip and gossip._loop and gossip.nodes:
            log.warning("THREAT DETECTED: %s -> %s (matched: %s)", src, dst, matched_ip)
            start_node = random.choice(list(gossip.nodes.keys()))
            node_list  = [{"id": i, "lbl": k}
                          for i, k in enumerate(gossip.nodes.keys())]
            asyncio.run_coroutine_threadsafe(
                gossip.start(start_node, 90, node_list, []),
                gossip._loop,
            )
    except Exception as exc:
        log.error("Packet processing error: %s", exc)


def _start_packet_monitor():
    try:
        from scapy.all import sniff, conf
        import os

        if platform.system() != "Windows" and os.geteuid() != 0:
            log.warning(
                "Packet monitor requires root privileges — skipping. "
                "Re-run with sudo to enable live packet capture."
            )
            return

        log.info("Packet monitor started")
        sniff(prn=_process_packet, store=False)

    except ImportError:
        log.warning("Scapy not installed — packet monitor disabled. pip install scapy")
    except PermissionError:
        log.warning("Packet monitor: permission denied — run as root/admin to enable")
    except Exception as exc:
        log.error("Packet monitor failed to start: %s", exc)


threading.Thread(target=_start_packet_monitor, daemon=True, name="packet-monitor").start()


# ========== WebSocket endpoint ==========

@app.websocket("/ws/gossip")
async def ws_gossip(ws: WebSocket):
    await gossip.connect(ws)
    try:
        while True:
            msg    = await ws.receive_json()
            action = msg.get("action")

            if action == "pause":
                gossip.running = False
                await gossip.broadcast({"type": "paused"})

            elif action == "resume":
                if not gossip.running and gossip.nodes:
                    gossip.running   = True
                    gossip.tick_task = asyncio.create_task(gossip._tick_loop())
                    await gossip.broadcast({"type": "resumed"})

            elif action == "reset":
                await gossip.stop()
                gossip.full_reset()
                await gossip.broadcast({"type": "reset"})

            elif action == "firewall":
                await gossip.toggle_firewall(
                    msg.get("node_a", ""),
                    msg.get("node_b", ""),
                )

    except WebSocketDisconnect:
        gossip.disconnect(ws)


# ========== CRYPTO TOOLS BACKEND ==========

_crypto_state = {
    "rsa_private_key": None,
    "rsa_public_key":  None,
    "aes_key":         None,
    "last_signature":  None,
    "last_plaintext":  None,
    "last_encrypted":  None,
}

def _get_rsa_keys():
    """Generate or retrieve RSA key pair."""
    if _crypto_state["rsa_private_key"] is None:
        private_key = rsa.generate_private_key(
            public_exponent=65537,
            key_size=2048,
            backend=default_backend()
        )
        _crypto_state["rsa_private_key"] = private_key
        _crypto_state["rsa_public_key"]  = private_key.public_key()
    return _crypto_state["rsa_private_key"], _crypto_state["rsa_public_key"]


@app.post("/api/crypto/sha256")
async def crypto_sha256(data: dict):
    value = str(data.get("text", "") or data.get("value", ""))
    if not value:
        raise HTTPException(status_code=400, detail="Empty input")

    digest = hashes.Hash(hashes.SHA256(), backend=default_backend())
    digest.update(value.encode('utf-8'))
    hash_bytes = digest.finalize()
    hex_hash   = hash_bytes.hex()

    log.info(f"[CRYPTO] SHA-256: '{value[:30]}...' -> {hex_hash[:16]}...")

    return {
        "algorithm":     "SHA-256",
        "input_preview": value[:50] + "..." if len(value) > 50 else value,
        "hash":          hex_hash,
        "bits":          256,
        "bytes":         len(hash_bytes),
    }


@app.post("/api/crypto/rsa/sign")
async def crypto_rsa_sign(data: dict):
    message = str(data.get("message", ""))
    if not message:
        raise HTTPException(status_code=400, detail="Empty message")

    private_key, public_key = _get_rsa_keys()

    signature = private_key.sign(
        message.encode('utf-8'),
        padding.PKCS1v15(),
        hashes.SHA256()
    )

    _crypto_state["last_signature"] = signature
    _crypto_state["last_plaintext"] = message

    pub_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode('utf-8')

    sig_b64 = base64.b64encode(signature).decode('utf-8')

    log.info(f"[CRYPTO] RSA Sign: '{message[:30]}...' -> sig:{len(signature)}bytes")

    return {
        "algorithm":       "RSA-2048",
        "signature":       sig_b64,
        "message":         message,
        "public_key":      pub_pem,
        "key_fingerprint": hashlib.sha256(pub_pem.encode()).hexdigest()[:16],
        "signature_bytes": len(signature),
        "status":          "signed",
    }


@app.post("/api/crypto/rsa/verify")
async def crypto_rsa_verify(data: dict):
    message       = str(data.get("message", ""))
    signature_b64 = data.get("signature", "")

    if not message or not signature_b64:
        raise HTTPException(status_code=400, detail="Message and signature required")

    try:
        signature = base64.b64decode(signature_b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid signature format")

    _, public_key = _get_rsa_keys()

    try:
        public_key.verify(
            signature,
            message.encode('utf-8'),
            padding.PKCS1v15(),
            hashes.SHA256()
        )
        log.info(f"[CRYPTO] RSA Verify: VALID for '{message[:30]}...'")
        return {
            "valid":           True,
            "message_preview": message[:50],
            "algorithm":       "RSA-2048",
            "verification":    "Signature valid",
            "status":          "Signature valid",
        }
    except Exception:
        log.warning(f"[CRYPTO] RSA Verify: INVALID for '{message[:30]}...'")
        return {
            "valid":           False,
            "message_preview": message[:50],
            "algorithm":       "RSA-2048",
            "verification":    "Signature invalid — message tampered or wrong key",
            "status":          "Signature invalid — message tampered or wrong key",
        }


@app.post("/api/crypto/aes/encrypt")
async def crypto_aes_encrypt(data: dict):
    plaintext = str(data.get("text", "") or data.get("plaintext", ""))
    key_hex   = data.get("key", "")

    if not plaintext:
        raise HTTPException(status_code=400, detail="Empty plaintext")

    if key_hex:
        try:
            key = bytes.fromhex(key_hex)
            if len(key) != 32:
                raise ValueError
        except ValueError:
            raise HTTPException(status_code=400, detail="Key must be 64 hex chars (256 bits)")
    else:
        key     = secrets.token_bytes(32)
        key_hex = key.hex()

    iv      = secrets.token_bytes(16)
    pad_len = 16 - (len(plaintext) % 16)
    padded  = plaintext + (chr(pad_len) * pad_len)

    cipher    = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded.encode('utf-8')) + encryptor.finalize()

    _crypto_state["aes_key"]       = key
    _crypto_state["last_encrypted"] = ciphertext
    _crypto_state["last_plaintext"] = plaintext

    combined = iv + ciphertext

    log.info(f"[CRYPTO] AES Encrypt: '{plaintext[:30]}...' -> {len(combined)} bytes")

    return {
        "algorithm":       "AES-256-CBC",
        "ciphertext_hex":  combined.hex(),
        "key":             key_hex,
        "key_preview":     key_hex[:16] + "...",
        "iv":              iv.hex(),
        "original_length": len(plaintext),
        "padded_length":   len(padded),
    }


@app.post("/api/crypto/aes/decrypt")
async def crypto_aes_decrypt(data: dict):
    ciphertext_hex = str(data.get("ciphertext", ""))
    key_hex        = str(data.get("key", ""))

    if not ciphertext_hex or not key_hex:
        raise HTTPException(status_code=400, detail="Ciphertext and key required")

    try:
        key = bytes.fromhex(key_hex)
        if len(key) != 32:
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=400, detail="Key must be 64 hex chars (256 bits)")

    try:
        full_bytes = bytes.fromhex(ciphertext_hex)
        iv         = full_bytes[:16]
        ciphertext = full_bytes[16:]

        cipher    = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        padded_plaintext = decryptor.update(ciphertext) + decryptor.finalize()

        pad_len   = padded_plaintext[-1]
        plaintext = padded_plaintext[:-pad_len].decode('utf-8')

        log.info(f"[CRYPTO] AES Decrypt: SUCCESS -> '{plaintext[:30]}...'")

        return {
            "algorithm":   "AES-256-CBC",
            "plaintext":   plaintext,
            "success":     True,
            "key_preview": key_hex[:16] + "...",
            "status":      "Decrypted successfully",
        }
    except Exception as e:
        log.error(f"[CRYPTO] AES Decrypt: FAILED - {e}")
        return {
            "algorithm": "AES-256-CBC",
            "plaintext": None,
            "success":   False,
            "error":     str(e),
            "status":    "Decryption failed",
        }


@app.get("/api/crypto/status")
def crypto_status():
    return {
        "status": "active",
        "endpoints": {
            "sha256":      "/api/crypto/sha256",
            "rsa_sign":    "/api/crypto/rsa/sign",
            "rsa_verify":  "/api/crypto/rsa/verify",
            "aes_encrypt": "/api/crypto/aes/encrypt",
            "aes_decrypt": "/api/crypto/aes/decrypt",
        },
        "note": "All crypto operations run in Python backend",
    }


# ========== REST: gossip ==========

@app.post("/api/gossip/start")
async def gossip_start(data: dict):
    return await gossip.start(
        data.get("start_node", "N01"),
        int(data.get("threat_score", 50)),
        data.get("nodes", []),
        data.get("edges", []),
    )


@app.get("/api/gossip/state")
def gossip_state():
    """
    FIX: Only expose node states when a simulation is actively running.
    Returning stale infected/immune states while running=False was the
    root cause of Node Manager cards showing wrong status after registration.
    """
    return {
        "running":          gossip.running,
        "total_nodes":      len(gossip.nodes),
        "total_reached":    gossip.total_reached,
        "total_immune":     gossip.total_immune,
        "total_quarantine": gossip.total_quarantine,
        "containment":      gossip._containment_score(),
        "firewall_edges":   list(gossip.firewall_edges),
        "nodes":            [
            {"lbl": n["lbl"], "state": n["state"], "score": n["score"]}
            for n in gossip.nodes.values()
        ] if gossip.running else [],
        "edge_hops":        gossip.edge_hops if gossip.running else {},
    }


@app.post("/api/gossip/reset")
async def gossip_reset():
    """
    NEW ENDPOINT — called by Node Manager before registering fresh nodes.
    Guarantees the engine holds no stale state from previous simulations.
    """
    await gossip.stop()
    gossip.full_reset()
    await gossip.broadcast({"type": "reset"})
    log.info("Gossip engine reset via REST")
    return {"ok": True, "message": "Gossip engine fully reset"}


# ========== Entry point ==========

if __name__ == "__main__":
    log.info("=" * 50)
    log.info(" SENTRA Backend v2.0")
    log.info("=" * 50)
    log.info("API:       http://localhost:8000")
    log.info("Docs:      http://localhost:8000/docs")
    log.info("UI:        http://127.0.0.1:5501")
    log.info("")
    log.info("Auth:      X-API-Key: %s", API_KEY)
    log.info("")
    log.info("Endpoints:")
    log.info("  GET  /api/blockchain")
    log.info("  POST /api/blockchain/mine")
    log.info("  POST /api/threat/check")
    log.info("  GET  /api/threat-feed")
    log.info("  POST /api/gossip/start")
    log.info("  GET  /api/gossip/state")
    log.info("  POST /api/gossip/reset          ← NEW")
    log.info("  WS   /ws/gossip  (pause|resume|reset|firewall)")
    log.info("  --- CRYPTO TOOLS ---")
    log.info("  POST /api/crypto/sha256")
    log.info("  POST /api/crypto/rsa/sign")
    log.info("  POST /api/crypto/rsa/verify")
    log.info("  POST /api/crypto/aes/encrypt")
    log.info("  POST /api/crypto/aes/decrypt")
    log.info("  GET  /api/crypto/status")
    log.info("=" * 50)
    uvicorn.run(app, host="0.0.0.0", port=8000)
