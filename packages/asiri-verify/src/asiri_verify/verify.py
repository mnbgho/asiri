#!/usr/bin/env python3
"""Verify one Asiri tender from public indexer data alone.

Usage:
    asiri-verify <tender component address> [--network esmeralda|mainnet]
                 [--rationale PATH] [--json]
                 [--receipt] [--reveal-history PATH]

    python3 scripts/verify.py <tender component address> [--network esmeralda|mainnet]
                      [--rationale PATH] [--json]
                      [--receipt] [--reveal-history PATH]

The script reads the tender and its circle from the network's
public indexer, plus the tender's transaction history, and checks
the public record end to end:

  1. the component runs the published template code (code hash),
  2. the rules hash recomputes from the displayed rules,
  3. the escrow funding matches the budget cap,
  4. every reveal verifies against its commitment,
  5. the award is the lowest valid revealed price under the
     tie-break, or a threshold-approved override with a rationale
     hash whose published text hashes to the same value,
  6. the settlement equals the award and honours the winning
     commitment's payment identity,
  7. every bond reached a recorded outcome and the bond vault
     reconciles.

It prints one line per check and exits non-zero when any check
fails. A check whose evidence could not be read from any indexer
is reported as could not be read, not as a failure, and the run
still exits non-zero: the tender is not fully verified until
every check has run. "Could not be read" means nothing usable
arrived from the network; bytes that did arrive but cannot be
decoded are the opposite, and the affected check fails. It needs
nothing but Python 3 and network access to the indexer. No wallet,
no account, no keys.
"""

import argparse
import base64
import hashlib
import http.client
import json
import sys
import time
import urllib.error
import urllib.request

# ---------------------------------------------------------------- CBOR

class Tagged:
    def __init__(self, tag, value):
        self.tag = tag
        self.value = value

    def __repr__(self):
        return f"Tagged({self.tag}, {self.value!r})"


def cbor_decode(data: bytes):
    """Decode one CBOR value in the tari_bor dialect."""
    pos = 0

    def take(n):
        nonlocal pos
        chunk = data[pos:pos + n]
        if len(chunk) != n:
            raise ValueError("truncated CBOR")
        pos += n
        return chunk

    def uint(info):
        if info < 24:
            return info
        length = {24: 1, 25: 2, 26: 4, 27: 8}.get(info)
        if length is None:
            raise ValueError(f"unsupported CBOR length {info}")
        return int.from_bytes(take(length), "big")

    def item():
        first = take(1)[0]
        major, info = first >> 5, first & 31
        if major == 0:
            return uint(info)
        if major == 1:
            return -1 - uint(info)
        if major == 2:
            return take(uint(info))
        if major == 3:
            return take(uint(info)).decode("utf-8")
        if major == 4:
            return [item() for _ in range(uint(info))]
        if major == 5:
            return {item(): item() for _ in range(uint(info))}
        if major == 6:
            tag = uint(info)
            value = item()
            if tag == 2 and isinstance(value, bytes):
                return int.from_bytes(value, "big")
            return Tagged(tag, value)
        if major == 7:
            if info == 20:
                return False
            if info == 21:
                return True
            if info in (22, 23):
                return None
            raise ValueError(f"unsupported CBOR simple value {info}")
        raise ValueError("bad CBOR")

    value = item()
    if pos != len(data):
        raise ValueError("trailing bytes in CBOR value")
    return value


# ---------------------------------------------------------------- model

STATES = ["Draft", "Open", "Reveal", "Awarded", "AwaitingDelivery",
          "Settled", "Expired", "Disputed"]
BOND_STATES = ["Held", "Returnable", "Returned", "Forfeited"]


def _arr(v, what):
    if not isinstance(v, list):
        raise ValueError(f"expected an array for {what}")
    return v


def _hex(v, what):
    if not isinstance(v, bytes):
        raise ValueError(f"expected bytes for {what}")
    return v.hex()


def _opt(v, inner):
    return None if v is None else inner(v)


def _addr(v, tag, prefix, what):
    if isinstance(v, Tagged) and v.tag == tag and isinstance(v.value, bytes):
        return prefix + v.value.hex()
    raise ValueError(f"expected a tagged address for {what}")


def _enum(v, names, what):
    parts = _arr(v, what)
    idx = parts[0]
    # bool is an int subclass in Python, so True would read as
    # index 1 without this check.
    if (isinstance(idx, bool) or not isinstance(idx, int)
            or idx < 0 or idx >= len(names)):
        raise ValueError(f"unknown {what} index {idx}")
    return names[idx]


def _bool(v, what):
    if not isinstance(v, bool):
        raise ValueError(f"expected a boolean for {what}, got {v!r}")
    return v


def decode_rules(f):
    if len(f) != 11:
        raise ValueError(f"rules has {len(f)} fields, expected 11")
    return {
        "specification_hash": _hex(f[0], "specification_hash"),
        "budget_cap": f[1],
        "bond_amount": f[2],
        "bid_window_epochs": f[3],
        "reveal_window_epochs": f[4],
        "override_window_epochs": f[5],
        "delivery_window_epochs": f[6],
        "claim_grace_epochs": f[7],
        "dispute_window_epochs": f[8],
        "approval_threshold": f[9],
        "dispute_threshold": f[10],
    }


def canonical_rules_bytes(r):
    out = bytearray()
    out += b"asiri-rules-v1"
    out += bytes.fromhex(r["specification_hash"])
    out += r["budget_cap"].to_bytes(16, "big")
    out += r["bond_amount"].to_bytes(16, "big")
    for key in ("bid_window_epochs", "reveal_window_epochs",
                "override_window_epochs", "delivery_window_epochs",
                "claim_grace_epochs", "dispute_window_epochs"):
        out += r[key].to_bytes(8, "big")
    out += r["approval_threshold"].to_bytes(4, "big")
    out += r["dispute_threshold"].to_bytes(4, "big")
    return bytes(out)


def commitment_bytes(price, salt, identity_hex):
    out = bytearray()
    out += b"asiri-bid-v1"
    out += price.to_bytes(16, "big")
    out += salt
    out += bytes.fromhex(identity_hex)
    return bytes(out)


def split_component(root):
    body = _arr(root, "component substate")[1]
    header, wrapped = _arr(body[0], "component entry")
    template = "template_" + _hex(_arr(header, "header")[0], "template")
    state = _arr(_arr(wrapped, "state wrapper")[0], "component state")
    return template, state


def decode_tender(root):
    template, f = split_component(root)
    # A None receipt_id is omitted from the encoding entirely
    # (measured against tari_bor): 35 fields before a receipt
    # exists, 36 after, with the later fields shifted by one.
    if len(f) == 35:
        f = f[:33] + [None] + f[33:]
    if len(f) != 36:
        raise ValueError(f"tender state has {len(f)} fields, expected 35 or 36")
    t = {
        "template": template,
        "circle": _addr(f[0], 128, "component_", "circle"),
        "circle_name": f[1],
        "bound": f[2],
        "approvers": [_hex(k, "approver") for k in f[3]],
        "rules": decode_rules(f[4]),
        "rules_hash": _opt(f[5], lambda x: _hex(x, "rules_hash")),
        "state": _enum(f[6], STATES, "state"),
        "escrow_vault": _vault(f[7]),
        "bonds_vault": _vault(f[8]),
        "lock_epoch": f[10],
        "bid_deadline": f[11],
        "reveal_deadline": f[12],
        "override_deadline": f[13],
        "delivery_deadline": f[15],
        "claim_deadline": f[16],
        "commitments": [],
        "reveals": [],
        "award": _opt(f[20], _decode_award),
        "override_proposals": [],
        "override_record": _opt(f[22], _decode_override),
        "delivery_signers": [_hex(k, "signer") for k in f[23]],
        "dispute": _opt(f[24], _decode_dispute),
        "dispute_votes": [],
        "settlement": _opt(f[26], _decode_settlement),
        "refund_amount": f[27],
        "refund_claimed": f[28],
        "payout_claimed": f[29],
        "forfeit_for_circle": f[30],
        "forfeit_locked": f[31],
        "forfeits_claimed_by_circle": f[32],
        "receipt_issued": f[33] is not None,
    }
    for c in f[17]:
        g = _arr(c, "commitment")
        if len(g) != 5:
            raise ValueError(f"commitment has {len(g)} fields, expected 5")
        t["commitments"].append({
            "seller": _hex(g[0], "seller"),
            "commitment": _hex(g[1], "commitment"),
            "epoch": g[2],
            "revealed": g[3],
            "bond": _enum(g[4], BOND_STATES, "bond state"),
        })
    for r in f[18]:
        g = _arr(r, "reveal")
        if len(g) != 6:
            raise ValueError(f"reveal has {len(g)} fields, expected 6")
        t["reveals"].append({
            "seller": _hex(g[0], "seller"),
            "price": g[1],
            "epoch": g[2],
            "counter": g[3],
            "valid": g[4],
            "commitment": _hex(g[5], "commitment"),
        })
    for d in f[25]:
        g = _arr(d, "dispute vote")
        if len(g) != 3:
            raise ValueError(f"dispute vote has {len(g)} fields, expected 3")
        t["dispute_votes"].append({
            "signer": _hex(g[0], "signer"),
            "pay_winner": g[1],
            "rationale_hash": _hex(g[2], "rationale_hash"),
        })
    for p in f[21]:
        g = _arr(p, "override proposal")
        if len(g) != 6:
            raise ValueError(
                f"override proposal has {len(g)} fields, expected 6")
        t["override_proposals"].append({
            "id": g[0],
            "chosen": _opt(g[1], lambda x: _hex(x, "chosen")),
            "rationale_hash": _hex(g[2], "rationale_hash"),
            "signers": [_hex(k, "signer") for k in g[3]],
            "executed": g[4],
            "void": g[5],
        })
    return t


def _decode_award(f):
    f = _arr(f, "award")
    # The on-chain award carries seven fields: the five the
    # checks use, plus the epoch it was computed at and whether
    # an executed override put it in place. Measured live on the
    # mainnet gate tender, 2026-11-25. Any other length is a
    # malformed record, not a shorter form.
    if len(f) != 7:
        raise ValueError(f"award has {len(f)} fields, expected 7")
    return {
        "winner": _hex(f[0], "winner"),
        "winning_commitment": _hex(f[1], "winning_commitment"),
        "winning_price": f[2],
        "commitments_count": f[3],
        "reveals_count": f[4],
        "epoch": f[5],
        "by_override": _bool(f[6], "by_override"),
    }


def _decode_override(f):
    f = _arr(f, "override record")
    if len(f) != 3:
        raise ValueError(f"override record has {len(f)} fields, expected 3")
    return {
        "chosen": _opt(f[0], lambda x: _hex(x, "chosen")),
        "rationale_hash": _hex(f[1], "rationale_hash"),
        "epoch": f[2],
    }


def _decode_dispute(f):
    f = _arr(f, "dispute")
    # Trailing empty options are omitted from the encoding, so an
    # unresolved dispute carries only its first three fields; the
    # resolution fields appear as the dispute is resolved. Any
    # other length is a malformed record, not a shorter form.
    if len(f) < 3 or len(f) > 5:
        raise ValueError(f"dispute record has {len(f)} fields")
    f = list(f) + [None] * (5 - len(f))
    return {
        "evidence_hash": _hex(f[0], "evidence_hash"),
        "epoch": f[1],
        "deadline": f[2],
        "resolved_for_winner": _opt(
            f[3], lambda x: _bool(x, "resolved_for_winner")),
        "rationale_hash": _opt(f[4], lambda x: _hex(x, "rationale_hash")),
    }


def _decode_settlement(f):
    f = _arr(f, "settlement")
    if len(f) != 3:
        raise ValueError(f"settlement has {len(f)} fields, expected 3")
    return {"winner": _hex(f[0], "winner"), "price": f[1], "epoch": f[2]}


def _vault(v):
    if isinstance(v, Tagged) and v.tag == 132 and isinstance(v.value, bytes):
        return "vault_" + v.value.hex()
    raise ValueError("unexpected vault encoding")


def decode_vault_balance(root):
    """A vault substate carries its balance; walk to the amount."""
    # Vault value shape: [variant, [[resource, balance]]] in this
    # stack; search the structure for the resource/balance pair so a
    # wrapper change does not silently break the check.
    def find(node):
        if isinstance(node, list):
            # The resource container is [Tagged(131, resource),
            # revealed balance, ...] inside the vault state.
            if (len(node) >= 2 and isinstance(node[0], Tagged)
                    and node[0].tag == 131 and isinstance(node[1], int)):
                return node[1]
            for child in node:
                got = find(child)
                if got is not None:
                    return got
        return None
    return find(root)


def extract_wasm(template_root):
    """Pull the WASM binary out of a template substate value."""
    found = []

    def walk(node):
        if isinstance(node, bytes) and len(node) > 1000 and node[:4] == b"\x00asm":
            found.append(node)
        elif isinstance(node, list):
            for child in node:
                walk(child)
        elif isinstance(node, Tagged):
            walk(node.value)

    walk(template_root)
    if not found:
        raise ValueError("no WASM binary found in the template substate")
    return max(found, key=len)


# ---------------------------------------------------------------- indexer

NETWORKS = {
    "mainnet": {
        "indexer": "https://indexer-a.ootle.tari.com",
        "indexer_fallback": None,
        "circle_template": "template_b86a46241753b8b8e4c2e9571c0db727925d77e1274009175e4f0b0e18cf466b",
        "tender_template": "template_267d1d73da73ec990e8711e492bccb9112076051d396922bdef2b9d667c684eb",
        "circle_code_hash": "72c9bb84c7e77b2cdc724a5619aed6dd5c5be71d1bea9eb685b2bab5e0d4609c",
        "tender_code_hash": "ff672fdced3cccd2c7c7649b4b6107322872ff83d2a347c8a1a30a5461f531e9",
    },
    "esmeralda": {
        "indexer": "https://ootle-indexer-a.tari.com",
        "indexer_fallback": "https://esme-indexer-a.ootle.tari.com",
        "circle_template": "template_d2677930a7e9283c3ead76a54ba9e9cd360ee5dda8a8a56ead8e84a88f45bdd1",
        "tender_template": "template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2",
        "circle_code_hash": "405cadc91fa0a32afa2221833a3110115c4051db60c3a85431b1bc2ef3c92cf0",
        "tender_code_hash": "f6cd9585c8a799caafc781450ca5d50496a8412640bb9de587f49049e0fc0803",
    },
}


class TransportError(urllib.error.URLError):
    """A fetch failed in transit: timeout, reset, truncated read,
    refused connection. Subclassing URLError keeps older callers
    that catch URLError working. Bytes that arrived but cannot be
    decoded are never a TransportError; they are data errors, and
    callers report them as failures, not as unreadable."""


def _is_transport(exc):
    """True when nothing usable arrived from the network."""
    return isinstance(exc, (
        TransportError,
        urllib.error.URLError,
        http.client.HTTPException,
        OSError,
    ))


class MalformedHistory(ValueError):
    """Bytes arrived for the tender's transaction history, but
    they are not shaped like history: the event list is not a
    list, an event entry carries no transaction id, or a
    transaction body cannot be decoded. `stage` names where the
    bad bytes were found: "events" for the event list, or
    "transaction" for one transaction body. A malformed history
    is a failure of the record, never an unreadable read, so
    callers report it as a failure. Subclassing ValueError keeps
    it distinct from transport failures, which _is_transport
    already separates."""

    def __init__(self, stage, detail):
        super().__init__(f"{stage}: {detail}")
        self.stage = stage


class Indexer:
    def __init__(self, base, fallback=None):
        self.base = base
        self.fallback = fallback

    def get(self, path, timeout=30, base=None):
        # The public indexers refuse the default python user agent
        # with a 403, so send an ordinary one.
        req = urllib.request.Request(
            (base or self.base) + path,
            headers={"Accept": "application/json",
                     "User-Agent": "Mozilla/5.0 (compatible; asiri-verify)"})
        # The socket timeout bounds one stalled operation, not the
        # whole read: a peer that keeps sending bytes can hold a
        # large read open indefinitely. Read in chunks against a
        # monotonic deadline so every fetch is bounded in wall
        # clock, and wrap transport failures so callers can tell
        # "nothing arrived" from "bytes arrived but are invalid".
        # The bound is the deadline plus one socket timeout: a
        # read that starts just before the deadline can still
        # block for the socket timeout, so the deadline is checked
        # before every read and never after a read has started.
        deadline = time.monotonic() + timeout
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                chunks = []
                # read1 returns as soon as any bytes arrive; plain
                # read would wait for the full chunk while a slow
                # peer dribbles, and the deadline would never be
                # checked. Fall back to read for responses without
                # read1.
                read_some = getattr(res, "read1", None) or res.read
                expected = res.info().get("Content-Length")
                while True:
                    if time.monotonic() > deadline:
                        raise TransportError(
                            "read deadline exceeded "
                            f"({timeout}s) for {path}")
                    chunk = read_some(65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
                raw = b"".join(chunks)
                # read1 does not raise when the connection closes
                # short of the declared length, so a truncated body
                # would otherwise reach the JSON decoder and read
                # as invalid data. A short body is a transport
                # failure, and the caller must report it that way.
                if expected is not None and len(raw) != int(expected):
                    raise TransportError(
                        f"truncated read for {path}: got {len(raw)} "
                        f"of {expected} bytes")
        except TransportError:
            raise
        except Exception as exc:
            if _is_transport(exc):
                raise TransportError(str(exc)) from exc
            raise
        return json.loads(raw.decode("utf-8"))

    def _substate(self, base, substate_id, timeout):
        body = self.get(f"/substates/{substate_id}", timeout=timeout, base=base)
        state = body.get("state") or {}
        if state.get("down"):
            return None
        raw = (state.get("up") or {}).get("substate")
        if not raw:
            raise ValueError(f"substate {substate_id} has no live value")
        # validate=True: a base64 string with stray characters is
        # malformed delivered data, not a value to decode loosely.
        return cbor_decode(base64.b64decode(raw, validate=True))

    def substate(self, substate_id, large=False):
        # The public indexers intermittently stall, sometimes on
        # any read and sometimes only on the template substate,
        # which carries the whole WASM binary. Every substate
        # read retries across both indexers before giving up; a
        # large read gets a long timeout per attempt, a small one
        # the usual 30 seconds. A down answer is definitive and
        # returns at once. Failover can rescue a read, so every
        # attempt is tried whatever the previous failure was, but
        # the error that survives is chosen by what it means: if
        # any indexer served bytes that could not be decoded, that
        # is evidence the record is invalid and it wins; only when
        # every attempt failed in transit is the failure a
        # transport error and the read reported as unreadable.
        timeout = 120 if large else 30
        attempts = [self.base]
        if self.fallback:
            attempts.append(self.fallback)
        attempts.append(self.base)
        last_transport = None
        first_data_error = None
        for base in attempts:
            try:
                return self._substate(base, substate_id, timeout)
            except Exception as exc:
                if _is_transport(exc):
                    last_transport = exc
                elif first_data_error is None:
                    first_data_error = exc
        if first_data_error is not None:
            raise first_data_error
        raise last_transport

    def _get_json(self, path):
        # The same failover as the substate reads: the public
        # indexers intermittently stall or answer a transient
        # error, and a verification makes many of these reads.
        # The surviving error follows the same rule as substate:
        # served-but-invalid data wins over transport failures.
        attempts = [self.base]
        if self.fallback:
            attempts.append(self.fallback)
        attempts.append(self.base)
        last_transport = None
        first_data_error = None
        for base in attempts:
            try:
                return self.get(path, base=base)
            except Exception as exc:
                if _is_transport(exc):
                    last_transport = exc
                elif first_data_error is None:
                    first_data_error = exc
        if first_data_error is not None:
            raise first_data_error
        raise last_transport

    def events(self, substate_id):
        body = self._get_json(f"/transactions/events?substate_id={substate_id}")
        if isinstance(body, list):
            return body
        if isinstance(body, dict):
            if "events" not in body:
                # An empty object reads as no events. The failure
                # mode stays safe: the reveal check reports the
                # reveals as could not be checked when nothing was
                # read, never as missing or passed.
                return []
            found = body["events"]
            if isinstance(found, list):
                return found
            raise MalformedHistory(
                "events",
                f"the event list is not a list: {found!r:.80}")
        raise MalformedHistory(
            "events", f"the event list is not a list or an object: {body!r:.80}")

    def transaction(self, tx_id):
        return self._get_json(f"/transactions/{tx_id}")


def _event_tx_ids(source, tender_address):
    """The tender's transaction ids, in event order, deduped."""
    tx_ids = []
    for ev in source.events(tender_address):
        # The indexer serves events as [transaction id, payload]
        # pairs; accept plain objects too. Anything else is
        # malformed delivered data: it cannot be read as an event
        # list with fewer transactions, because a skipped entry
        # could be the one carrying a reveal.
        if isinstance(ev, (list, tuple)):
            if (not ev or not isinstance(ev[0], str) or not ev[0]):
                raise MalformedHistory(
                    "events", f"malformed event entry: {ev!r:.80}")
            tx = ev[0]
        elif isinstance(ev, dict):
            tx = ev.get("transaction_id") or ev.get("tx_id") or ""
            if not isinstance(tx, str) or not tx:
                raise MalformedHistory(
                    "events", f"malformed event entry: {ev!r:.80}")
        else:
            raise MalformedHistory(
                "events", f"malformed event entry: {ev!r:.80}")
        if tx and tx not in tx_ids:
            tx_ids.append(tx)
    return tx_ids


def find_reveal_args(indexer, tender_address, tender):
    """Collect reveal_bid arguments from the tender's transactions.

    Returns (found, unreadable, total): found maps commitment hex
    to (price, salt_bytes, identity_hex); total is the number of
    event transactions the hunt tried to read; unreadable is how
    many of them no indexer would serve. The distinction matters:
    a reveal whose transaction could not be read is not a reveal
    that does not exist, and the caller must not report it as one.
    Reveal transactions are found through the tender's events; each
    transaction body carries its instructions with literal args.
    """
    out = {}
    try:
        tx_ids = _event_tx_ids(indexer, tender_address)
    except ValueError:
        # Bytes arrived but the history is not shaped like
        # history. That is a failure of the record, not a read
        # that failed, so it propagates: the caller reports it as
        # a failure, never as unreadable. Any other failure means
        # the list itself could not be read, and the caller
        # reports the reveals as could not be checked.
        raise
    except Exception:
        # The event list itself could not be read, so no history
        # was read at all. Returning zero transactions makes the
        # caller report the reveals as could not be read, never as
        # missing; verify() must not crash without a report. The
        # receipt path already handles this the same way.
        return {}, 0, 0
    unreadable = 0
    for tx_id in tx_ids:
        try:
            body = indexer.transaction(tx_id)
        except ValueError as exc:
            # A body the indexer served but cannot be decoded is
            # malformed delivered data, not a body that could not
            # be read. It propagates the same way.
            raise MalformedHistory(
                "transaction",
                f"transaction {tx_id} could not be decoded: {exc}"
            ) from exc
        except Exception:
            unreadable += 1
            continue
        for instr in _instructions(body):
            call = instr.get("CallMethod")
            if not call or call.get("method") != "reveal_bid":
                continue
            if (call.get("call") or {}).get("Address") != tender_address:
                continue
            args = call.get("args") or []
            if len(args) != 3:
                continue
            price = _literal_int(args[0])
            salt = _literal_salt(args[1])
            identity = _literal_hex(args[2])
            if price is None or salt is None or identity is None:
                continue
            digest = hashlib.sha256(
                commitment_bytes(price, salt, identity)).hexdigest()
            out[digest] = (price, salt, identity)
    return out, unreadable, len(tx_ids)


class WalletHistory:
    """Transaction records preserved from a wallet daemon dump.

    The public indexers can lose transaction bodies (on Esmeralda
    they pruned the season's bodies in November 2026 while states
    and events survived). A wallet that submitted the transactions
    keeps its own copies. This class serves those copies by
    transaction id, in the same shape the daemon recorded them:
    the instruction walk finds the same CallMethod literals in
    either source.
    """

    def __init__(self, records):
        self._txs = {}
        for rec in records:
            if isinstance(rec, dict) and rec.get("id"):
                self._txs[rec["id"]] = rec

    @classmethod
    def load(cls, path):
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            data = data.get("transactions") or []
        return cls(data)

    def __contains__(self, tx_id):
        return tx_id in self._txs

    def transaction(self, tx_id):
        return self._txs[tx_id]


class ProvenanceSource:
    """A source that records where each transaction came from.

    Substates and events delegate to the primary source (the
    indexer). A transaction is served from the preserved wallet
    history when the history holds it, and from the primary
    source otherwise; every served transaction is recorded in
    served_by as "wallet-history" or "indexer", so a receipt can
    state the provenance of its recomputation plainly instead of
    implying the public record still holds what it has lost.
    """

    def __init__(self, primary, wallet=None):
        self.primary = primary
        self.wallet = wallet
        self.served_by = {}

    def substate(self, substate_id, large=False):
        return self.primary.substate(substate_id, large=large)

    def events(self, substate_id):
        return self.primary.events(substate_id)

    def transaction(self, tx_id):
        if self.wallet is not None and tx_id in self.wallet:
            self.served_by[tx_id] = "wallet-history"
            return self.wallet.transaction(tx_id)
        body = self.primary.transaction(tx_id)
        self.served_by[tx_id] = "indexer"
        return body


def find_reveal_args_detailed(source, tender_address):
    """The reveal hunt with per-reveal provenance kept.

    Returns (found, unreadable, total): found maps commitment hex
    to {"price", "salt", "identity", "tx_id", "served_by"}, where
    served_by is "wallet-history" or "indexer" when the source
    tracks it (ProvenanceSource), else "indexer". unreadable and
    total mean what they mean in find_reveal_args.
    """
    out = {}
    tx_ids = _event_tx_ids(source, tender_address)
    unreadable = 0
    for tx_id in tx_ids:
        try:
            body = source.transaction(tx_id)
        except ValueError as exc:
            # As in find_reveal_args: a served body that cannot be
            # decoded is malformed delivered data, not an unreadable
            # read. The receipt reports it as a failed recomputation.
            raise MalformedHistory(
                "transaction",
                f"transaction {tx_id} could not be decoded: {exc}"
            ) from exc
        except Exception:
            unreadable += 1
            continue
        served_by = getattr(source, "served_by", {}).get(
            tx_id, "indexer")
        for instr in _instructions(body):
            call = instr.get("CallMethod")
            if not call or call.get("method") != "reveal_bid":
                continue
            if (call.get("call") or {}).get("Address") != tender_address:
                continue
            args = call.get("args") or []
            if len(args) != 3:
                continue
            price = _literal_int(args[0])
            salt = _literal_salt(args[1])
            identity = _literal_hex(args[2])
            if price is None or salt is None or identity is None:
                continue
            digest = hashlib.sha256(
                commitment_bytes(price, salt, identity)).hexdigest()
            out[digest] = {
                "price": price, "salt": salt, "identity": identity,
                "tx_id": tx_id, "served_by": served_by,
            }
    return out, unreadable, len(tx_ids)


def _instructions(node):
    found = []
    if isinstance(node, dict):
        if "CallMethod" in node or "CallFunction" in node:
            found.append(node)
        for v in node.values():
            found += _instructions(v)
    elif isinstance(node, list):
        for v in node:
            found += _instructions(v)
    return found


def _literal_bytes(arg):
    lit = (arg or {}).get("Literal")
    if not isinstance(lit, str):
        return None
    try:
        return cbor_decode(bytes.fromhex(lit))
    except Exception:
        return None


def _literal_int(arg):
    v = _literal_bytes(arg)
    return v if isinstance(v, int) else None


def _literal_hex(arg):
    v = _literal_bytes(arg)
    return v.hex() if isinstance(v, bytes) else None


def _literal_salt(arg):
    v = _literal_bytes(arg)
    if isinstance(v, list) and len(v) == 32 and all(
            isinstance(x, int) for x in v):
        return bytes(v)
    if isinstance(v, bytes) and len(v) == 32:
        return v
    return None


# ---------------------------------------------------------------- checks

class Report:
    def __init__(self):
        self.rows = []

    def check(self, name, ok, detail):
        # ok is True, False, or None. None means the check could
        # not be determined because the evidence it reads could
        # not be read from any source. That is not a pass and not
        # a failure, and it must never be silently folded into
        # either.
        self.rows.append({
            "check": name,
            "ok": None if ok is None else bool(ok),
            "detail": detail,
        })

    @property
    def failed(self):
        return [r for r in self.rows if r["ok"] is False]

    @property
    def unknown(self):
        return [r for r in self.rows if r["ok"] is None]


def verify(tender_address, network, rationale_text=None, source=None):
    """Run every check. `source` is an Indexer-like object; tests
    inject recorded responses through it."""
    cfg = NETWORKS[network]
    idx = source or Indexer(cfg["indexer"], cfg.get("indexer_fallback"))
    rep = Report()

    try:
        root = idx.substate(tender_address)
    except Exception as exc:
        # A tender whose record cannot be fetched at all still
        # gets a report, never a crash: no evidence either way.
        # Bytes that arrived but cannot be decoded are the
        # opposite, a failure of the record itself.
        if _is_transport(exc):
            rep.check("tender exists", None,
                      f"the tender substate could not be read: {exc}")
        else:
            rep.check("tender exists", False,
                      f"the tender substate is unreadable: {exc}")
        return rep
    if root is None:
        rep.check("tender exists", False, "the tender substate is down")
        return rep
    # Name the common mistake plainly: a circle address (or any
    # other component) handed to the verifier used to surface as
    # a decoder complaint about field counts. The component's
    # template is readable before any state decoding, so check
    # it first and say what the address actually is.
    try:
        expected_template = cfg["tender_template"]
        if expected_template:
            actual_template, _state = split_component(root)
            if actual_template != expected_template:
                rep.check("tender exists", False,
                          "that component does not run the tender "
                          "template. check the address: it belongs to "
                          "a different kind of component.")
                return rep
        tender = decode_tender(root)
    except Exception as exc:
        rep.check("tender exists", False,
                  f"the tender record is unreadable: {exc}")
        return rep
    rep.check("tender exists", True,
              f"state {tender['state']}, circle {tender['circle']}")

    # 1. template code
    expected_template = cfg["tender_template"]
    if expected_template:
        rep.check(
            "template binding",
            tender["template"] == expected_template,
            f"component runs {tender['template']}")
        try:
            troot = idx.substate(expected_template, large=True)
        except Exception as exc:
            # A read that fails is not evidence the code is wrong.
            # The template substate carries the whole WASM binary,
            # and a truncated read must report as unreadable, the
            # same way an unreadable reveal does, never as a fail.
            # Bytes that did arrive but cannot be decoded are the
            # opposite: the on-chain record is invalid, and that
            # is a failure of the check.
            if _is_transport(exc):
                rep.check("template code hash", None,
                          f"could not read the template substate: {exc}")
            else:
                rep.check("template code hash", False,
                          f"template substate unreadable: {exc}")
        else:
            try:
                digest = hashlib.sha256(extract_wasm(troot)).hexdigest()
            except Exception as exc:
                rep.check("template code hash", False,
                          f"template code unreadable: {exc}")
            else:
                expected_hash = cfg["tender_code_hash"]
                rep.check(
                    "template code hash",
                    expected_hash is None or digest == expected_hash,
                    f"sha256 of the on-chain code is {digest}")
    else:
        rep.check("template binding", False,
                  f"no published template recorded for {network} in this script")

    # 2. rules hash
    rules = tender["rules"]
    if tender["rules_hash"] is not None:
        digest = hashlib.sha256(canonical_rules_bytes(rules)).hexdigest()
        rep.check("rules hash", digest == tender["rules_hash"],
                  f"recomputed {digest}")
    else:
        rep.check("rules hash", tender["state"] == "Draft",
                  "no rules hash yet (tender not locked)")

    # 3. escrow funding against the cap
    escrow_recorded = False
    try:
        escrow_vault = idx.substate(tender["escrow_vault"])
    except Exception as exc:
        escrow = None
        escrow_recorded = True
        if _is_transport(exc):
            rep.check("escrow funding", None,
                      f"escrow vault could not be read: {exc}")
        else:
            rep.check("escrow funding", False,
                      f"escrow vault unreadable: {exc}")
    else:
        try:
            escrow = decode_vault_balance(escrow_vault)
        except Exception as exc:
            escrow = None
            escrow_recorded = True
            rep.check("escrow funding", False,
                      f"escrow vault unreadable: {exc}")
    if escrow is not None:
        cap = rules["budget_cap"]
        settled = tender["settlement"]
        accounted = escrow
        if tender["payout_claimed"] and settled:
            accounted += settled["price"]
        if tender["refund_claimed"] and tender["refund_amount"]:
            accounted += tender["refund_amount"]
        rep.check("escrow funding", accounted == cap,
                  f"escrow {escrow} + paid out {accounted - escrow} of cap {cap}")
    elif not escrow_recorded:
        rep.check("escrow funding", False,
                  "the escrow vault balance could not be read")

    # 4. reveals against commitments
    reveals_by_commitment = {
        r["commitment"]: r for r in tender["reveals"]}
    commitments = {c["commitment"]: c for c in tender["commitments"]}
    commitment_hashes = [c["commitment"] for c in tender["commitments"]]
    commitment_sellers = [c["seller"] for c in tender["commitments"]]
    flagged_revealed = {c["commitment"] for c in tender["commitments"]
                        if c["revealed"]}
    recorded_reveals = {r["commitment"] for r in tender["reveals"]}
    consistent = (
        len(set(commitment_hashes)) == len(commitment_hashes)
        and len(set(commitment_sellers)) == len(commitment_sellers)
        and flagged_revealed == recorded_reveals)
    rep.check("record counts",
              len(tender["commitments"]) >= len(tender["reveals"])
              and consistent,
              f"{len(tender['commitments'])} commitments, "
              f"{len(tender['reveals'])} reveals"
              + ("" if consistent
                 else "; commitment records are inconsistent"))
    if tender["reveals"]:
        history_malformed = None
        try:
            found, unreadable, total_tx = find_reveal_args(
                idx, tender_address, tender)
        except ValueError as exc:
            # The history arrived but is not shaped like history.
            # That is a failure of the record, reported once here,
            # never folded into could-not-read.
            history_malformed = str(exc)
            found, unreadable, total_tx = {}, 0, 0
        failures = []
        could_not_read = []
        digests = [r["commitment"] for r in tender["reveals"]]
        if len(set(digests)) != len(digests):
            failures.append("duplicate reveals for one commitment")
        counters = [r["counter"] for r in tender["reveals"]]
        if len(set(counters)) != len(counters):
            failures.append("duplicate reveal counters")
        for digest, record in reveals_by_commitment.items():
            entry = found.get(digest)
            if entry is None:
                # A missing reveal is a finding only when the
                # transaction hunt actually read the history. When
                # some of it could not be read from any indexer,
                # or none of it could, the honest verdict is that
                # this reveal could not be checked, not that its
                # transaction does not exist.
                if unreadable or not total_tx:
                    could_not_read.append(digest)
                else:
                    failures.append(
                        f"no reveal transaction found for {digest[:12]}")
                continue
            price, _salt, _identity = entry
            if price != record["price"]:
                failures.append(f"price mismatch for {digest[:12]}")
            if digest not in commitments:
                failures.append(f"reveal without commitment {digest[:12]}")
            elif commitments[digest]["seller"] != record["seller"]:
                failures.append(f"reveal seller differs from the "
                                f"commitment seller for {digest[:12]}")
        total = len(reveals_by_commitment)
        if history_malformed is not None:
            rep.check("reveals verify against commitments", False,
                      "the tender's transaction history is malformed: "
                      f"{history_malformed}")
        elif failures:
            detail = "; ".join(failures)
            if could_not_read:
                detail += (f"; {len(could_not_read)} more could not be "
                           "checked, their transactions could not be "
                           "read from any indexer")
            rep.check("reveals verify against commitments", False, detail)
        elif could_not_read:
            rep.check(
                "reveals verify against commitments", None,
                f"{len(could_not_read)} of {total} reveals could not "
                "be recomputed: their transactions could not be read "
                "from any indexer today"
                + (f". the other {total - len(could_not_read)} recompute "
                   "to their commitments"
                   if len(could_not_read) < total else ""))
        else:
            rep.check("reveals verify against commitments", True,
                      f"all {total} reveals recompute "
                      "to their commitments")
    else:
        rep.check("reveals verify against commitments",
                  tender["state"] in ("Draft", "Open", "Expired"),
                  "no reveals recorded yet")

    # 5. award or override
    award = tender["award"]
    override = tender["override_record"]
    if override is not None:
        proposals = {p["id"]: p for p in tender["override_proposals"]}
        executed = [p for p in proposals.values()
                    if p["executed"] and not p["void"]
                    and p["chosen"] == override["chosen"]
                    and p["rationale_hash"] == override["rationale_hash"]]
        ok = bool(executed)
        detail = "no executed override proposal matches the record"
        if executed:
            p = executed[-1]
            signers = set(p["signers"])
            approvers = set(tender["approvers"])
            threshold = rules["approval_threshold"]
            ok = (len(signers) >= threshold and signers <= approvers
                  and p["rationale_hash"] != "00" * 32)
            detail = (f"proposal {p['id']} signed by {len(signers)} "
                      f"approvers, threshold {threshold}")
            if award is not None:
                ok = ok and award["winner"] == override["chosen"]
                detail += ", award follows the override choice"
        rep.check("override threshold and rationale hash", ok, detail)
        chosen = [r for r in tender["reveals"]
                  if r["seller"] == override["chosen"]]
        choice_ok = (len(chosen) == 1 and chosen[0]["valid"]
                     and chosen[0]["price"] <= rules["budget_cap"])
        choice_detail = "the chosen seller never revealed a bid"
        if chosen:
            choice_detail = (f"chose the bid revealed at "
                             f"{chosen[0]['price']}")
            if award is not None:
                choice_ok = (choice_ok
                             and award["winner"] == chosen[0]["seller"]
                             and award["winning_price"] == chosen[0]["price"])
                choice_detail += ", award matches the chosen bid"
        rep.check("override choice is a valid revealed bid",
                  choice_ok, choice_detail)
        if award is not None:
            rep.check("award counts",
                      award["commitments_count"] == len(tender["commitments"])
                      and award["reveals_count"] == len(tender["reveals"]),
                      f"award records {award['commitments_count']} "
                      f"commitments and {award['reveals_count']} reveals")
        if rationale_text is not None:
            digest = hashlib.sha256(rationale_text).hexdigest()
            rep.check("override rationale text",
                      digest == override["rationale_hash"],
                      f"published text hashes to {digest}")
        else:
            rep.check("override rationale text", False,
                      "unverifiable: the rationale text was never "
                      "published with this run (pass --rationale)")
    elif award is not None:
        # Validity is recomputed from the locked cap, not taken
        # from the record's own flag alone.
        valid = [r for r in tender["reveals"]
                 if r["valid"] and r["price"] <= rules["budget_cap"]]
        flags_ok = all(r["valid"] == (r["price"] <= rules["budget_cap"])
                       for r in tender["reveals"])
        if valid:
            best = min(valid, key=lambda r: (r["price"], r["counter"]))
            ok = (flags_ok
                  and award["winning_price"] == best["price"]
                  and award["winning_commitment"] == best["commitment"]
                  and award["winner"] == best["seller"])
            rep.check("award is the lowest valid revealed price", ok,
                      f"award {award['winning_price']} at counter "
                      f"{best['counter']}, best valid reveal "
                      f"{best['price']}")
        else:
            rep.check("award is the lowest valid revealed price", False,
                      "an award exists but no valid reveal does")
        rep.check("award counts",
                  award["commitments_count"] == len(tender["commitments"])
                  and award["reveals_count"] == len(tender["reveals"]),
                  f"award records {award['commitments_count']} commitments "
                  f"and {award['reveals_count']} reveals")
    else:
        rep.check("award", tender["state"] in ("Draft", "Open", "Reveal",
                                                "Expired"),
                  "no award yet")

    # 6. settlement
    settled = tender["settlement"]
    if settled is not None:
        expected_price = award["winning_price"] if award else None
        ok = expected_price is not None and settled["price"] == expected_price
        detail = f"settled {settled['price']} at epoch {settled['epoch']}"
        if award is not None:
            winner_matches = settled["winner"] == award["winner"]
            ok = ok and winner_matches
            detail += (", winner matches the award" if winner_matches
                       else ", winner does not match the award")
        rep.check("settlement equals the award", ok, detail)
        # Settlement is promised only after delivery confirmation at
        # the approval threshold, or after a dispute the circle
        # resolved for the winner at the dispute threshold.
        approvers = set(tender["approvers"])
        signers = set(tender["delivery_signers"])
        delivered = (len(signers) >= rules["approval_threshold"]
                     and signers <= approvers)
        dispute = tender["dispute"]
        resolved = False
        if dispute is not None and dispute["resolved_for_winner"]:
            votes = [v for v in tender["dispute_votes"]
                     if v["pay_winner"]
                     and v["rationale_hash"] == dispute["rationale_hash"]
                     and v["signer"] in approvers]
            resolved = len({v["signer"] for v in votes}) >= \
                rules["dispute_threshold"]
        rep.check("delivery confirmed or dispute resolved",
                  delivered or resolved,
                  f"{len(signers)} delivery confirmations, threshold "
                  f"{rules['approval_threshold']}"
                  + (", settled through a dispute resolved for the "
                     "winner" if resolved and not delivered else ""))
    elif tender["state"] == "Settled":
        rep.check("settlement equals the award", False,
                  "state is Settled but no settlement record exists")

    # 7. bonds
    bond = rules["bond_amount"]
    bonds_balance = None
    try:
        bonds_vault = idx.substate(tender["bonds_vault"])
    except Exception as exc:
        # A vault that cannot be fetched is unreadable, never a
        # failed reconciliation; a vault whose bytes cannot be
        # decoded is invalid data, and that is a failure.
        if _is_transport(exc):
            rep.check("bond vault reconciles", None,
                      f"the bond vault {tender['bonds_vault']} "
                      f"could not be read: {exc}")
        else:
            rep.check("bond vault reconciles", False,
                      f"the bond vault {tender['bonds_vault']} "
                      f"is unreadable: {exc}")
    else:
        try:
            bonds_balance = decode_vault_balance(bonds_vault)
        except Exception as exc:
            rep.check("bond vault reconciles", False,
                      f"the bond vault {tender['bonds_vault']} "
                      f"is unreadable: {exc}")
        else:
            if bonds_balance is None:
                rep.check("bond vault reconciles", False,
                          f"the bond vault {tender['bonds_vault']} "
                          f"carries no balance")
    if bonds_balance is not None:
        held = sum(bond for c in tender["commitments"] if c["bond"] == "Held")
        returnable = sum(bond for c in tender["commitments"]
                          if c["bond"] == "Returnable")
        expected = held + returnable + tender["forfeit_locked"]
        if not tender["forfeits_claimed_by_circle"]:
            expected += tender["forfeit_for_circle"]
        rep.check("bond vault reconciles", bonds_balance == expected,
                  f"vault {bonds_balance}, expected {expected} from "
                  f"held {held}, returnable {returnable}, locked "
                  f"{tender['forfeit_locked']}")
        forfeited = [c for c in tender["commitments"]
                     if c["bond"] == "Forfeited"]
        # The template splits each forfeited bond with the locked
        # half rounded down and the circle keeping the rest.
        locked_each = bond // 2
        circle_each = bond - locked_each
        rep.check("forfeit split recorded",
                  tender["forfeit_locked"] == locked_each * len(forfeited)
                  and tender["forfeit_for_circle"]
                  == circle_each * len(forfeited),
                  f"{len(forfeited)} forfeited bonds, locked "
                  f"{tender['forfeit_locked']}, for the circle "
                  f"{tender['forfeit_for_circle']}")
    # When the balance could not be read or decoded, the check was
    # already reported above; nothing further is emitted here.
    return rep


# ---------------------------------------------------------------- receipts

RECEIPT_VERSION = "asiri-receipt-1"

WALLET_PROVENANCE_NOTE = (
    "recomputed from the operating wallet's preserved history, "
    "archived 2026-11-20, after the public indexers pruned the "
    "transaction bodies")

# The provenance a receipt may claim for a wallet history the
# caller does not further identify: a history was supplied and
# used, nothing more. The specific note above (which wallet,
# archived when) is a claim about a particular archive, so it is
# used only when the caller passes it in explicitly.
WALLET_PROVENANCE_NOTE_GENERIC = (
    "recomputed from a preserved wallet history supplied with "
    "this run, after the public indexers pruned the transaction "
    "bodies")

WALLET_SOURCE_LABEL = "preserved wallet history"
WALLET_SOURCE_LABEL_OPERATING = (
    "operating wallet preserved history")

INDEXER_PRUNING_NOTE = (
    "on 2026-11-20 both public esmeralda indexers answered 404 "
    "for this season's transaction bodies: the bodies were pruned "
    "or lost on the indexer side, while component states, vault "
    "states, and event lists still read normally. a reveal that "
    "can be recomputed only from a transaction body therefore "
    "depends on a preserved copy of that body, and this receipt "
    "says which copy each recomputation used.")


def _tari(micro):
    """An exact decimal tari string for a microtari amount."""
    whole, frac = divmod(int(micro), 1_000_000)
    if frac == 0:
        return str(whole)
    return f"{whole}.{frac:06d}".rstrip("0")


def build_receipt(tender_address, network, rationale_text=None,
                  source=None, wallet_history=None, label=None,
                  notes=None,
                  wallet_source_label=WALLET_SOURCE_LABEL,
                  wallet_provenance_note=WALLET_PROVENANCE_NOTE_GENERIC):
    """One canonical receipt for a tender, as a JSON-ready dict.

    The check list is the ordinary verify() run, made through a
    ProvenanceSource so reveal transactions preserved in a wallet
    history can serve where the indexer has lost them, with the
    serving source recorded per transaction. Every other section
    is recomputed here from the decoded record: the rules hash,
    each reveal against its commitment, the award under the
    locked rules (or the override that replaced it), the escrow
    and bond accounting, and the limits of what the record can
    prove. A field that cannot be recomputed says so in place;
    nothing is omitted and nothing is passed silently.

    The provenance wording for wallet-served reveals defaults to
    the generic claim (a preserved history was supplied with
    this run). A caller who knows which archive the history is
    passes wallet_source_label and wallet_provenance_note to
    say so; the receipt never names a wallet or an archive date
    the caller did not supply.
    """
    cfg = NETWORKS[network]
    primary = source or Indexer(cfg["indexer"], cfg.get("indexer_fallback"))
    prov = ProvenanceSource(primary, wallet_history)
    rep = verify(tender_address, network,
                 rationale_text=rationale_text, source=prov)
    receipt = {
        "receipt_version": RECEIPT_VERSION,
        "tender": tender_address,
        "network": network,
        "label": label,
        "checks": rep.rows,
        "checks_summary": {
            "pass": sum(1 for r in rep.rows if r["ok"] is True),
            "fail": sum(1 for r in rep.rows if r["ok"] is False),
            "could_not_read": sum(1 for r in rep.rows
                                  if r["ok"] is None),
        },
    }
    try:
        root = prov.substate(tender_address)
        tender = decode_tender(root)
    except Exception as exc:
        receipt["record"] = None
        receipt["record_error"] = str(exc)
        # The same transport-versus-decode rule as the check run:
        # a fetch that failed in transit is not evidence the record
        # is invalid, and bytes that arrived but cannot be decoded
        # are not an unreadable read.
        receipt["record_error_kind"] = (
            "could-not-read" if _is_transport(exc) else "record-invalid")
        return receipt

    rules = tender["rules"]
    rules_hash_recomputed = hashlib.sha256(
        canonical_rules_bytes(rules)).hexdigest()
    receipt["state"] = tender["state"]
    receipt["circle"] = {"address": tender["circle"],
                         "name": tender["circle_name"]}
    receipt["template"] = tender["template"]
    receipt["approvers"] = tender["approvers"]
    receipt["rules"] = dict(
        rules,
        rules_hash_recorded=tender["rules_hash"],
        rules_hash_recomputed=rules_hash_recomputed,
        rules_hash_matches=(
            tender["rules_hash"] is not None
            and rules_hash_recomputed == tender["rules_hash"]),
        source="component state, read live from the indexer")
    receipt["epochs"] = {
        "lock": tender["lock_epoch"],
        "bid_deadline": tender["bid_deadline"],
        "reveal_deadline": tender["reveal_deadline"],
        "override_deadline": tender["override_deadline"],
        "delivery_deadline": tender["delivery_deadline"],
        "claim_deadline": tender["claim_deadline"],
    }
    receipt["commitments"] = [
        dict(c, source="component state, read live from the indexer")
        for c in tender["commitments"]]

    # Reveals, each recomputed against its commitment from the
    # transaction arguments, with the serving source named.
    found, unreadable, total_tx = ({}, 0, 0)
    events_unreadable = False
    events_malformed = None
    if tender["reveals"]:
        try:
            found, unreadable, total_tx = find_reveal_args_detailed(
                prov, tender_address)
        except MalformedHistory as exc:
            # The history arrived but is not shaped like history.
            # The check list above already reported this as a
            # failure; the receipt's recomputation fails the same
            # way instead of calling it could-not-read.
            events_malformed = exc.stage
        except ValueError:
            # A decode failure from the event-list read itself (a
            # JSON body that does not parse) is the same malformed
            # history, at the event-list stage.
            events_malformed = "events"
        except Exception:
            # The check list above already ran its own hunt; this
            # second read of the event list can still stall out
            # on a bad indexer day. The receipt then reports the
            # per-reveal recomputation as could-not-read rather
            # than dying with the read.
            events_unreadable = True
    commitments = {c["commitment"]: c for c in tender["commitments"]}
    reveal_rows = []
    for rec in tender["reveals"]:
        entry = found.get(rec["commitment"])
        row = {
            "seller": rec["seller"],
            "price_microtari": rec["price"],
            "price_tari": _tari(rec["price"]),
            "epoch": rec["epoch"],
            "counter": rec["counter"],
            "valid": rec["valid"],
            "commitment": rec["commitment"],
        }
        if entry is None:
            if events_malformed is not None:
                recompute_status = "failed"
                recompute_note = (
                    "the tender's event list arrived but is not "
                    "shaped like an event list, so the reveal "
                    "transactions could not be located"
                    if events_malformed == "events" else
                    "a reveal transaction body the indexer served "
                    "could not be decoded, so the reveal could not "
                    "be recomputed")
            elif events_unreadable:
                recompute_status = "could-not-read"
                recompute_note = (
                    "the tender's event list could not be read "
                    "from any indexer in this run, so the reveal "
                    "transactions could not be located")
            else:
                recompute_status = "could-not-read"
                recompute_note = (
                    "the reveal transaction could not be read from "
                    "the indexer or from any preserved history "
                    "available to this run")
            row["recomputation"] = {
                "status": recompute_status,
                "digest_matches_commitment": None,
                "price_matches_record": None,
                "seller_matches_commitment": None,
                "transaction_id": None,
                "arguments_source": None,
                "provenance_note": recompute_note,
            }
        else:
            from_wallet = entry["served_by"] == "wallet-history"
            row["recomputation"] = {
                "status": "recomputed",
                "digest_matches_commitment": True,
                "price_matches_record": entry["price"] == rec["price"],
                "seller_matches_commitment": (
                    rec["commitment"] in commitments
                    and commitments[rec["commitment"]]["seller"]
                    == rec["seller"]
                    and entry["identity"] == rec["seller"]),
                "transaction_id": entry["tx_id"],
                "arguments_source": (
                    wallet_source_label if from_wallet
                    else "indexer transaction body"),
                "provenance_note": (
                    wallet_provenance_note if from_wallet else
                    "read from the transaction body the indexer "
                    "still serves"),
            }
        reveal_rows.append(row)
    receipt["reveals"] = reveal_rows

    # The award, recomputed from the reveals under the locked
    # rules, and compared with the recorded award.
    valid = [r for r in tender["reveals"]
             if r["valid"] and r["price"] <= rules["budget_cap"]]
    best = (min(valid, key=lambda r: (r["price"], r["counter"]))
            if valid else None)
    override = tender["override_record"]
    award = tender["award"]
    recomputed = None
    method = None
    if override is not None:
        method = ("override: the award follows the executed "
                  "override choice, not the computed lowest price")
        chosen = [r for r in tender["reveals"]
                  if r["seller"] == override["chosen"]]
        if chosen:
            recomputed = {"winner": chosen[0]["seller"],
                          "winning_price": chosen[0]["price"],
                          "winning_commitment": chosen[0]["commitment"]}
    elif best is not None:
        method = ("lowest valid revealed price; the earlier "
                  "reveal counter wins a tie")
        recomputed = {"winner": best["seller"],
                      "winning_price": best["price"],
                      "winning_commitment": best["commitment"]}
    matches = None
    if award is not None and recomputed is not None:
        matches = (
            award["winner"] == recomputed["winner"]
            and award["winning_price"] == recomputed["winning_price"]
            and award["winning_commitment"]
            == recomputed["winning_commitment"])
    receipt["award"] = {
        "recorded": award,
        "recomputed": recomputed,
        "matches_recorded": matches,
        "method": method,
        "source": "recomputed from the recorded reveals and the "
                  "locked rules in the component state",
    }

    # The override record, where one exists, with its threshold
    # evidence and the exception arithmetic: what the rules
    # computed, what was actually paid, and the difference.
    if override is not None:
        executed = [p for p in tender["override_proposals"]
                    if p["executed"] and not p["void"]
                    and p["chosen"] == override["chosen"]
                    and p["rationale_hash"] == override["rationale_hash"]]
        prop = executed[-1] if executed else None
        settled = tender["settlement"]
        paid_price = (settled["price"] if settled
                      else award["winning_price"] if award else None)
        receipt["override"] = {
            "record": override,
            "proposals": tender["override_proposals"],
            "threshold": {
                "proposal_id": prop["id"] if prop else None,
                "signers": prop["signers"] if prop else [],
                "signer_count": len(prop["signers"]) if prop else 0,
                "required": rules["approval_threshold"],
                "met": bool(prop) and len(prop["signers"])
                       >= rules["approval_threshold"],
            },
            "rationale_text_check": (
                "not run: no rationale text was supplied"
                if rationale_text is None else
                "the supplied text hashes to the recorded "
                "rationale hash"
                if hashlib.sha256(rationale_text).hexdigest()
                == override["rationale_hash"] else
                "the supplied text does not hash to the recorded "
                "rationale hash"),
            "source": "component state, read live from the indexer",
        }
        if best is not None and paid_price is not None:
            receipt["exception"] = {
                "proven_lowest_revealed": {
                    "seller": best["seller"],
                    "price_microtari": best["price"],
                    "price_tari": _tari(best["price"]),
                },
                "price_paid": {
                    "seller": (settled["winner"] if settled
                               else award["winner"] if award else None),
                    "price_microtari": paid_price,
                    "price_tari": _tari(paid_price),
                },
                "difference_microtari": paid_price - best["price"],
                "difference_tari": _tari(paid_price - best["price"]),
                "rationale_hash": override["rationale_hash"],
                "note": ("the difference is the measured price of "
                         "the circle's recorded decision, not a "
                         "loss figure: the proven winner under the "
                         "locked rules, the winner the threshold "
                         "chose, and the difference are three "
                         "separate checked facts"),
            }
    else:
        receipt["override"] = None
        receipt["exception"] = None

    dispute = tender["dispute"]
    if dispute is not None:
        votes = tender["dispute_votes"]
        pay_votes = {v["signer"] for v in votes
                     if v["pay_winner"]
                     and v["rationale_hash"] == dispute["rationale_hash"]
                     and v["signer"] in set(tender["approvers"])}
        receipt["dispute"] = {
            "record": dispute,
            "votes": votes,
            "threshold": {
                "pay_winner_votes": len(pay_votes),
                "required": rules["dispute_threshold"],
                "met": len(pay_votes) >= rules["dispute_threshold"],
            },
            "source": "component state, read live from the indexer",
        }
    else:
        receipt["dispute"] = None

    receipt["settlement"] = tender["settlement"]
    receipt["delivery"] = {
        "signers": tender["delivery_signers"],
        "count": len(tender["delivery_signers"]),
        "threshold": rules["approval_threshold"],
        "confirmed": len(set(tender["delivery_signers"]))
                     >= rules["approval_threshold"],
    }
    receipt["receipt_issued"] = tender["receipt_issued"]

    # Escrow and bonds, from the state fields and the live vault
    # balances, with the locked remainder named and located.
    def vault_balance(vault_id):
        """(balance, read_status): "read", "could-not-read" when
        the vault could not be fetched, "record-invalid" when the
        bytes arrived but do not decode to a vault balance."""
        try:
            value = prov.substate(vault_id)
        except Exception as exc:
            return None, ("could-not-read" if _is_transport(exc)
                          else "record-invalid")
        try:
            balance = decode_vault_balance(value)
        except Exception:
            return None, "record-invalid"
        if balance is None:
            # The bytes decoded, but no resource/balance pair is
            # in them: the vault record is not shaped like a vault.
            return None, "record-invalid"
        return balance, "read"

    escrow_balance, escrow_read = vault_balance(tender["escrow_vault"])
    bonds_balance, bonds_read = vault_balance(tender["bonds_vault"])
    settled = tender["settlement"]
    accounted = escrow_balance
    if accounted is not None:
        if tender["payout_claimed"] and settled:
            accounted += settled["price"]
        if tender["refund_claimed"] and tender["refund_amount"]:
            accounted += tender["refund_amount"]
    receipt["escrow"] = {
        "vault": tender["escrow_vault"],
        "balance_microtari": escrow_balance,
        "budget_cap_microtari": rules["budget_cap"],
        "payout_claimed": tender["payout_claimed"],
        "payout_microtari": (settled["price"]
                             if settled and tender["payout_claimed"]
                             else 0),
        "refund_amount_microtari": tender["refund_amount"],
        "refund_claimed": tender["refund_claimed"],
        "accounted_microtari": accounted,
        # An unreadable vault cannot reconcile: the field is null,
        # not false, so no reader mistakes an unreadable vault for
        # a vault that fails to add up.
        "reconciles": (None if accounted is None
                       else accounted == rules["budget_cap"]),
        "read_status": escrow_read,
        "source": "vault balance read live from the indexer; "
                  "payout and refund from the component state",
    }
    bond = rules["bond_amount"]
    by_state = {}
    for c in tender["commitments"]:
        by_state[c["bond"]] = by_state.get(c["bond"], 0) + bond
    locked = tender["forfeit_locked"]
    receipt["bonds"] = {
        "vault": tender["bonds_vault"],
        "balance_microtari": bonds_balance,
        "bond_amount_microtari": bond,
        "by_state_microtari": by_state,
        "forfeit_for_circle_microtari": tender["forfeit_for_circle"],
        "forfeits_claimed_by_circle":
            tender["forfeits_claimed_by_circle"],
        "forfeit_locked_microtari": locked,
        "read_status": bonds_read,
        "locked_forever": (
            {"amount_microtari": locked,
             "amount_tari": _tari(locked),
             "location": ("the tender's bond vault, "
                          + tender["bonds_vault"]),
             "note": ("the locked half of the forfeited bond "
                      "money. it stays in the tender forever and "
                      "is unspendable; it is not burned, and no "
                      "recorded path moves it.")}
            if locked else None),
        "source": "vault balance read live from the indexer; "
                  "bond states from the component state",
    }

    # Exclusion: which valid revealed bid below the paid price
    # was passed over, and by what recorded mechanism.
    paid = (settled["price"] if settled
            else award["winning_price"] if award else None)
    passed_over = []
    if paid is not None:
        for r in valid:
            if r["price"] < paid:
                passed_over.append({
                    "seller": r["seller"],
                    "price_microtari": r["price"],
                    "price_tari": _tari(r["price"]),
                    "commitment": r["commitment"],
                    "passed_over_by": (
                        "the executed override, proposal "
                        f"{receipt['override']['threshold']['proposal_id']}"
                        if override is not None else
                        "no recorded mechanism: this would be a "
                        "defect in the award"),
                })
    receipt["exclusion"] = {
        "passed_over_revealed_bids": passed_over,
        "note": ("every valid revealed bid priced below the "
                 "price paid is listed here with the recorded "
                 "mechanism that passed it over. in a tender with "
                 "no override the list is empty, because the "
                 "award is the lowest valid revealed price."),
    }

    unrevealed = [c for c in tender["commitments"] if not c["revealed"]]
    receipt["limits"] = {
        "commitments": len(tender["commitments"]),
        "reveals": len(tender["reveals"]),
        "unrevealed": len(unrevealed),
        "note": (
            f"{len(unrevealed)} of {len(tender['commitments'])} "
            "committed bids were never revealed. their prices are "
            "in no record and cannot be known. this receipt proves "
            "the winner is the lowest price among the bids that "
            "were revealed, under the rules locked before bidding; "
            "it makes no claim about any bid nobody revealed."),
    }

    served = {row["recomputation"]["arguments_source"]
              for row in reveal_rows
              if row["recomputation"]["status"] == "recomputed"}
    if not tender["reveals"]:
        reveal_prov = "no reveals were recorded on this tender"
    elif events_malformed is not None:
        reveal_prov = ("failed in this run: the tender's transaction "
                       "history arrived but is not shaped like history"
                       + (" (the event list)"
                          if events_malformed == "events" else
                          " (a transaction body)"))
    elif events_unreadable:
        reveal_prov = ("could not be read in this run: the "
                       "tender's event list could not be read "
                       "from any indexer, so the reveal "
                       "transactions could not be located")
    elif any(row["recomputation"]["status"] == "could-not-read"
             for row in reveal_rows):
        reveal_prov = ("could not be read: neither the indexer "
                       "nor a preserved history available to this "
                       "run holds the reveal transactions")
    elif wallet_source_label in served:
        reveal_prov = wallet_provenance_note
    else:
        reveal_prov = "indexer transaction bodies"
    if events_unreadable:
        state_events = ("component state and vault states read live "
                        f"from the public {network} indexers; the event "
                        "list could not be read in this run")
    elif events_malformed is not None:
        state_events = ("component state and vault states read live "
                        f"from the public {network} indexers; the event "
                        "list arrived but is not shaped like history")
    else:
        state_events = ("component state, vault states, and event list "
                        f"read live from the public {network} indexers")
    receipt["provenance"] = {
        "state_and_events": state_events,
        "reveal_transactions": reveal_prov,
        # The pruning note records a dated observation about the
        # Esmeralda indexers, so it belongs only in Esmeralda
        # receipts. A mainnet receipt asserting it would claim
        # history about a network this run never touched.
        "indexer_note": (INDEXER_PRUNING_NOTE
                         if network == "esmeralda" else None),
        "notes": list(notes or []),
    }
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tender", help="tender component address")
    parser.add_argument("--network", default="mainnet",
                        choices=sorted(NETWORKS))
    parser.add_argument("--rationale", help="path to the published "
                        "override rationale text")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--receipt", action="store_true",
                        help="emit the canonical receipt for the "
                        "tender as JSON instead of the check list")
    parser.add_argument("--reveal-history",
                        help="path to a preserved wallet history "
                        "(a daemon transactions dump) that may serve "
                        "reveal transactions the indexer has lost, "
                        "in the check run and in a receipt; a receipt "
                        "records this provenance")
    args = parser.parse_args(argv)

    rationale = None
    if args.rationale:
        try:
            with open(args.rationale, "rb") as fh:
                rationale = fh.read()
        except OSError as exc:
            print(f"could not read the rationale file: {exc}")
            return 1
    wallet = None
    if args.reveal_history:
        # Loaded and validated before either branch: a history
        # file must serve the ordinary check run too, never be
        # silently ignored when --receipt is not given.
        try:
            wallet = WalletHistory.load(args.reveal_history)
        except (OSError, ValueError) as exc:
            print(f"could not read the reveal history: {exc}")
            return 1
    if args.receipt:
        try:
            receipt = build_receipt(args.tender, args.network,
                                    rationale_text=rationale,
                                    wallet_history=wallet)
        except Exception as exc:
            print(f"receipt could not be built: {exc}")
            return 1
        print(json.dumps(receipt, indent=2))
        summary = receipt["checks_summary"]
        return 1 if summary["fail"] or summary["could_not_read"] else 0
    source = None
    if wallet is not None:
        cfg = NETWORKS[args.network]
        source = ProvenanceSource(
            Indexer(cfg["indexer"], cfg.get("indexer_fallback")), wallet)
    try:
        rep = verify(args.tender, args.network, rationale_text=rationale,
                     source=source)
    except Exception as exc:
        # A wrong address, a non-tender component, or an indexer
        # outage must read as a failed verification, not a crash.
        if isinstance(exc, urllib.error.HTTPError) and exc.code == 404:
            print(f"verification could not run: the indexer found "
                  f"nothing at {args.tender} on {args.network} "
                  "(404). check the address and the --network flag; "
                  "the default network is mainnet.")
        else:
            print(f"verification could not run: {exc}")
        return 1
    if args.json:
        out = {"tender": args.tender, "network": args.network,
               "checks": rep.rows,
               "ok": not rep.failed and not rep.unknown}
        if wallet is not None:
            out["reveal_history"] = args.reveal_history
        print(json.dumps(out, indent=2))
    else:
        if wallet is not None:
            print(f"reveal transactions may be served from the "
                  f"preserved history at {args.reveal_history}")
        for row in rep.rows:
            if row["ok"] is None:
                mark = "COULD NOT BE READ"
            elif row["ok"]:
                mark = "PASS"
            else:
                mark = "FAIL"
            print(f"[{mark}] {row['check']}: {row['detail']}")
        passed = sum(1 for r in rep.rows if r["ok"])
        summary = f"{passed}/{len(rep.rows)} checks passed"
        if rep.unknown:
            summary += f", {len(rep.unknown)} could not be read"
        print(summary)
    return 1 if rep.failed or rep.unknown else 0


if __name__ == "__main__":
    sys.exit(main())
