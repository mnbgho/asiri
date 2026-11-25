#!/usr/bin/env python3
"""Attack your own Asiri tender, and watch the chain refuse.

Usage:
    python3 attack.py --tender component_<address>
                      --circle component_<address>
                      --cookie <wallet daemon cookie file>
                      [--network mainnet|esmeralda]
                      [--daemon http://127.0.0.1:5100/json_rpc]
                      [--operator NAME] [--second NAME]
                      [--seller1 NAME] [--seller2 NAME]
                      [--seller3 NAME]
                      [--price1 MICROTARI] [--price2 MICROTARI]
                      [--price3 MICROTARI]
                      [--report PATH]

This tool exists to test your own deployment. It takes one
tender you created for the purpose, on a circle you control,
and drives it through its windows while throwing the attack
classes a sealed tender has to survive at it: bids with the
wrong bond, a duplicate commitment, a rules rewrite after
the lock, a late bid, reveals that do not match their
commitments, an early close, an override with no rationale,
an override for a bid nobody revealed, an override signed
below threshold, and claims by the wrong accounts after
settlement. Every attack is an ordinary call to the tender
template with wrong inputs, wrong timing, or the wrong
actor. The chain is expected to reject every one, and the
tool reports each rejection in the chain's own words. The
same tender then finishes honestly: the lowest valid
revealed bid wins, delivery is confirmed, and the normal
claims land. An attack that is accepted, or an honest step
that is rejected, is a finding: the run stops at once and
the exit code is non-zero.

Run it only against a tender and circle of your own, with
accounts of your own, on a wallet daemon of your own. The
attacks are real transactions: each one that is rejected
still pays its network fee, and the tender's escrow and
bonds are real funds from the operator account. Nothing
here can reach anyone else's tender: every call is signed
by one of your accounts and aimed at the one tender you
named.

Before you run it:

  - Create the test tender in the app, register it in your
    circle, and leave it in draft. This tool locks it and
    runs the test; it does not create tenders.
  - The five account names are accounts in your wallet
    daemon. The defaults are operator, second, seller1,
    seller2, seller3. The operator must be a circle
    approver and its account must hold enough revealed
    balance to escrow the tender's budget cap and pay the
    run's fees. Seller3's bid is committed and never
    revealed on purpose, so its bond forfeits: do not use
    an account whose bond you are not prepared to lose.
  - The daemon is your tari_ootle_walletd. Pass its
    JSON-RPC address with --daemon and its cookie file
    with --cookie (the .cookie file in the daemon's data
    directory for the network profile). The tool reads the
    cookie on each call and never prints it.
  - Prices are in microtari and must sit below the
    tender's budget cap. The defaults are the shape of the
    recorded mainnet run: seller1 wins at 15 tari, seller2
    reveals at 17.5 tari, seller3's sealed bid is 12 tari.

The tool reads the tender's state from the network's
public indexer, through the same read path as
scripts/verify.py, which it loads from its own directory.
It needs Python 3 and nothing else, plus network access to
the indexer and to your daemon. A full run takes as long
as the tender's windows take: it waits for epochs to turn,
checking every few seconds, and it can be left running.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
# The verifier lives in the asiri-verify package; scripts/verify.py
# is only a thin CLI shim into it, with none of the module's names.
spec = importlib.util.spec_from_file_location(
    "asiri_verify",
    HERE / ".." / "packages" / "asiri-verify" / "src" / "asiri_verify"
    / "verify.py")
V = importlib.util.module_from_spec(spec)
spec.loader.exec_module(V)

TARI_TOKEN_BYTES = bytes([1] * 32)
TAG_RESOURCE = 131
TAG_COMPONENT = 128


# ------------------------------------------------------------------ bor
# The small slice of the tari_bor encoding the instruction
# arguments need, mirroring app/src/cbor.ts.

def enc_uint(v):
    v = int(v)
    if v < 0:
        raise ValueError("negative uint")
    if v < 24:
        return bytes([v])
    if v < 256:
        return bytes([0x18, v])
    if v < 65536:
        return b"\x19" + v.to_bytes(2, "big")
    if v < 4294967296:
        return b"\x1a" + v.to_bytes(4, "big")
    return b"\x1b" + v.to_bytes(8, "big")


def enc_bytes(b):
    b = bytes(b)
    if len(b) < 24:
        return bytes([0x40 + len(b)]) + b
    if len(b) < 256:
        return b"\x58" + bytes([len(b)]) + b
    return b"\x59" + len(b).to_bytes(2, "big") + b


def enc_array(items):
    head = (bytes([0x80 + len(items)]) if len(items) < 24
            else b"\x98" + bytes([len(items)]))
    return head + b"".join(items)


def enc_tagged(tag, inner):
    if tag >= 256:
        raise ValueError("tag out of range")
    return b"\xd8" + bytes([tag]) + inner


def enc_null():
    return b"\xf6"


def lit(raw):
    return {"Literal": raw.hex()}


def arg_uint(v):
    return lit(enc_uint(v))


def arg_hash(hex_str):
    return lit(enc_bytes(bytes.fromhex(hex_str)))


def arg_pubkey(hex_str):
    return lit(enc_bytes(bytes.fromhex(hex_str)))


def arg_opt_pubkey(hex_str):
    if hex_str is None:
        return lit(enc_null())
    return lit(enc_bytes(bytes.fromhex(hex_str)))


def arg_component(address):
    raw = bytes.fromhex(address.removeprefix("component_"))
    return lit(enc_tagged(TAG_COMPONENT, enc_bytes(raw)))


def arg_resource_token():
    return lit(enc_tagged(TAG_RESOURCE, enc_bytes(TARI_TOKEN_BYTES)))


def arg_byte_vec(b):
    return lit(enc_array([enc_uint(x) for x in b]))


def arg_rules(r):
    return lit(enc_array([
        enc_bytes(bytes.fromhex(r["specification_hash"])),
        enc_uint(r["budget_cap"]),
        enc_uint(r["bond_amount"]),
        enc_uint(r["bid_window_epochs"]),
        enc_uint(r["reveal_window_epochs"]),
        enc_uint(r["override_window_epochs"]),
        enc_uint(r["delivery_window_epochs"]),
        enc_uint(r["claim_grace_epochs"]),
        enc_uint(r["dispute_window_epochs"]),
        enc_uint(r["approval_threshold"]),
        enc_uint(r["dispute_threshold"]),
    ]))


def workspace(key):
    return {"Workspace": {"id": key, "offset": None}}


# ------------------------------------------------------------- builders
# One builder per action, mirroring app/src/builders.ts.

def call(component, method, args):
    return {"CallMethod": {
        "call": {"Address": component}, "method": method,
        "args": args}}


def keep_output(key):
    return {"PutLastInstructionOutputOnWorkspace": {"key": key}}


def withdraw(account, amount):
    return [call(account, "withdraw",
                 [arg_resource_token(), arg_uint(amount)]),
            keep_output(0)]


def build_lock_and_fund(account, tender, cap):
    return withdraw(account, cap) + [
        call(tender, "lock_and_fund", [workspace(0)])]


def build_commit_bid(account, tender, commitment_hex, bond):
    return withdraw(account, bond) + [
        call(tender, "commit_bid",
             [arg_hash(commitment_hex), workspace(0)])]


def build_reveal_bid(tender, price, salt, identity_hex):
    return [call(tender, "reveal_bid", [
        arg_uint(price), arg_byte_vec(salt),
        arg_pubkey(identity_hex)])]


def build_update_rules(tender, rules):
    return [call(tender, "update_rules", [arg_rules(rules)])]


def build_close_reveal(tender):
    return [call(tender, "close_reveal", [])]


def build_advance_delivery(tender):
    return [call(tender, "advance_delivery", [])]


def build_confirm_delivery(tender):
    return [call(tender, "confirm_delivery", [])]


def build_propose_override(tender, chosen_hex, rationale_hex):
    return [call(tender, "propose_override", [
        arg_opt_pubkey(chosen_hex), arg_hash(rationale_hex)])]


def build_sign_override(tender, proposal_id):
    return [call(tender, "sign_override", [arg_uint(proposal_id)])]


def build_release_refund_direct(tender):
    return [call(tender, "release_refund", [])]


def claim_to(account, tender, method):
    return [call(tender, method, []), keep_output(0),
            call(account, "deposit", [workspace(0)])]


def build_collect(circle, tender, method):
    return [call(circle, method, [arg_component(tender)])]


def commitment_hash(price, salt, identity_hex):
    """Mirror of app/src/hash.ts commitmentHash."""
    if len(salt) != 32:
        raise ValueError("salt must be 32 bytes")
    out = bytearray()
    out += b"asiri-bid-v1"
    out += int(price).to_bytes(16, "big")
    out += salt
    out += bytes.fromhex(identity_hex)
    return hashlib.sha256(bytes(out)).hexdigest()


# --------------------------------------------------------------- daemon

class Daemon:
    def __init__(self, url, cookie_path):
        self.url = url
        self.cookie_path = cookie_path

    def rpc(self, method, params):
        token = Path(self.cookie_path).read_text().strip()
        body = json.dumps({"jsonrpc": "2.0", "method": method,
                           "params": params, "id": 1}).encode()
        req = urllib.request.Request(
            self.url, data=body,
            headers={"Content-Type": "application/json",
                     "Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=300) as resp:
            payload = json.loads(resp.read())
        if "error" in payload:
            raise RuntimeError(f"{method}: {payload['error']}")
        return payload["result"]

    def accounts(self):
        res = self.rpc("accounts.list", {"offset": 0, "limit": 200})
        out = {}
        for row in res.get("accounts", []):
            acct = row["account"]
            out[acct["name"]] = {
                "component": acct["component_address"],
                "public_key": acct["owner_public_key"],
            }
        return out

    def submit(self, instructions, fee_account, max_fee=2_000_000):
        result = self.rpc("transactions.submit_instruction", {
            "instructions": instructions,
            "fee_account": {"Name": fee_account},
            "max_fee": max_fee,
            "override_inputs": True,
        })
        tx = result["transaction_id"]
        final = self.rpc("transactions.wait_result", {
            "transaction_id": tx, "timeout_secs": 300})
        inner = (final.get("result") or {}).get("result") or {}
        return ("Accept" in inner), final, tx


def extract_reason(final):
    """The chain's own failure wording out of a rejected
    transaction result: the longest string in the result
    that carries failure language."""
    found = []

    def walk(x):
        if isinstance(x, str):
            found.append(x)
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(final)
    cands = [s for s in found
             if ("failed" in s or "error" in s.lower()
                 or "panicked" in s or "assert" in s.lower())
             and len(s) > 12]
    if cands:
        return max(cands, key=len)[:500]
    inner = (final.get("result") or {}).get("result") or {}
    return f"rejected: {list(inner.keys())}"[:500]


# ----------------------------------------------------------------- run

def rejection_reason_matches(reason, expected):
    """True when the chain's refusal carries the expected wording.
    A missing reason never matches, and no expected wording means
    no check. The match is a case-insensitive substring, because
    the daemon wraps the template's own wording in its result."""
    if expected is None:
        return True
    if not reason:
        return False
    return expected.lower() in reason.lower()


# The chain's own wording for each attack's rejection, as
# recorded in the mainnet attack run (evidence/mainnet.md).
# A rejection that does not carry its step's wording is a
# finding: the chain refused the transaction, but not for the
# reason the attack was testing, so the step proved nothing.
# Keyed by the start of the step label.
EXPECTED_REASONS = {
    "duplicate commitment": "seller has already committed in this tender",
    "commit with too small a bond": "bond must equal the locked bond amount",
    "rewrite the locked rules": "tender is not a draft",
    "commit after the bid deadline": "the bid window has closed",
    "reveal with the wrong salt": "no matching commitment for this reveal",
    "reveal with the wrong price": "no matching commitment for this reveal",
    "reveal of seller1's bid under seller2's identity":
        "no matching commitment for this reveal",
    "reveal of a bid that was never committed":
        "no matching commitment for this reveal",
    "the same bid revealed twice": "no matching commitment for this reveal",
    "close the reveal window before its deadline":
        "the reveal window is still open",
    "advance to delivery inside the override window":
        "the override window is still open",
    "override proposed with an all-zero rationale hash":
        "an override requires a rationale hash",
    "override proposed for a bid nobody revealed":
        "an override can only choose a valid revealed bid",
    "a single approver calls release_refund directly":
        "Access Denied",
    "the loser tries to claim the payment":
        "only the winning payment identity can claim the payment",
    "an account that never bid tries to claim a bond":
        "no returnable bond for this seller",
    "the winner claims the payment a second time":
        "payment already claimed",
    "circle collects the forfeits a second time":
        "forfeits already claimed by the circle",
}


class AttackRun:
    def __init__(self, args):
        cfg = V.NETWORKS[args.network]
        self.cfg = cfg
        self.indexer = V.Indexer(cfg["indexer"],
                                 cfg.get("indexer_fallback"))
        self.daemon = Daemon(args.daemon, args.cookie)
        self.tender = args.tender
        self.circle = args.circle
        self.names = {
            "operator": args.operator,
            "second": args.second,
            "seller1": args.seller1,
            "seller2": args.seller2,
            "seller3": args.seller3,
        }
        self.prices = {"seller1": args.price1,
                       "seller2": args.price2,
                       "seller3": args.price3}
        self.results = []
        self.attempts = {}
        self.salts = {}
        self.commitments = {}

    def log(self, msg):
        line = (f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} "
                f"{msg}")
        print(line, flush=True)

    def epoch(self):
        req = urllib.request.Request(
            self.cfg["indexer"] + "/network",
            headers={"User-Agent":
                     "Mozilla/5.0 (compatible; asiri-attack)"})
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read())["epoch"]

    def read_tender(self):
        return V.decode_tender(self.indexer.substate(self.tender))

    def submit(self, label, instructions, account_name):
        now = self.epoch()
        ok, final, tx = self.daemon.submit(instructions, account_name)
        fee = final.get("final_fee")
        reason = None if ok else extract_reason(final)
        if ok:
            self.log(f"OK {label} tx {tx} fee {fee} epoch {now}")
        else:
            self.log(f"REJECTED {label} tx {tx} fee {fee} "
                     f"epoch {now}: {reason}")
        return ok, final, tx, fee, reason

    # Window conditions over the decoded tender state.
    def in_bid(self, t, n):
        return (t["state"] == "Open" and t["bid_deadline"] is not None
                and n < t["bid_deadline"])

    def in_bid_early(self, t, n):
        # Payload attacks inside the bid window fire only
        # with an epoch to spare, so the rejection they earn
        # is for the payload, not for a window that closed
        # while the transaction was on its way.
        return self.in_bid(t, n) and n + 1 < t["bid_deadline"]

    def after_bid(self, t, n):
        return (t["state"] == "Open" and t["bid_deadline"] is not None
                and n >= t["bid_deadline"] + 1)

    def in_reveal(self, t, n):
        return (t["bid_deadline"] is not None
                and t["reveal_deadline"] is not None
                and t["bid_deadline"] < n < t["reveal_deadline"]
                and t["state"] in ("Open", "Reveal"))

    def in_reveal_early(self, t, n):
        # The same margin as in_bid_early, for the reveal
        # window's payload attacks.
        return self.in_reveal(t, n) and n + 1 < t["reveal_deadline"]

    def override_signed(self, t, n):
        # The lone-signature observation is only meaningful
        # on a read that already shows that signature. Before
        # it shows, the read may simply be stale, so the
        # observation waits instead of passing on old state.
        if not t["override_proposals"]:
            return False
        op_key = self.accounts["operator"]["public_key"]
        s2_key = self.accounts["seller2"]["public_key"]
        return any(p["chosen"] == s2_key
                   and op_key in p["signers"]
                   and not p["executed"]
                   for p in t["override_proposals"])

    def close_ready(self, t, n):
        return (t["reveal_deadline"] is not None
                and n >= t["reveal_deadline"]
                and t["state"] in ("Open", "Reveal"))

    def in_override(self, t, n):
        return (t["state"] == "Awarded"
                and t["override_deadline"] is not None
                and n < t["override_deadline"])

    def awarded_any(self, t, n):
        return t["state"] == "Awarded"

    def past_override(self, t, n):
        return (t["override_deadline"] is not None
                and n >= t["override_deadline"]
                and t["state"] == "Awarded")

    def has_proposals(self, t, n):
        return bool(t["override_proposals"])

    def awaiting(self, t, n):
        return t["state"] == "AwaitingDelivery"

    def settled(self, t, n):
        return t["state"] == "Settled"

    def steps(self, a, rules):
        """The step table: (label, build, account, condition,
        expect, kind, race_ok, miss_ok). Build is a function
        of the run, so payloads carry this run's own salts,
        commitments, and proposal ids."""
        op = self.names["operator"]
        sec = self.names["second"]
        s1 = self.names["seller1"]
        s2 = self.names["seller2"]
        s3 = self.names["seller3"]
        t = self.tender
        bond = rules["bond_amount"]
        small_bond = bond // 2
        wrong_salt = os.urandom(32)
        rationale = hashlib.sha256(
            b"asiri attack test: override rationale").hexdigest()
        zero_hash = "0" * 64
        late_salt = os.urandom(32)
        late_price = (self.prices["seller2"] * 3) // 4
        uncommitted_salt = os.urandom(32)
        uncommitted_price = self.prices["seller1"] // 2

        def commit(role, price, salt, bond_amount):
            identity = a[role]["public_key"]
            commitment = commitment_hash(price, salt, identity)
            return build_commit_bid(a[role]["component"], t,
                                    commitment, bond_amount)

        def sign_lone(run, tender_state):
            props = [p for p in tender_state["override_proposals"]
                     if p["chosen"] == a["seller2"]["public_key"]
                     and not p["executed"]]
            if not props:
                return None
            return build_sign_override(t, props[0]["id"])

        changed_rules = dict(rules)
        changed_rules["budget_cap"] = (
            1_000_000 if rules["budget_cap"] != 1_000_000
            else rules["budget_cap"] + 1)

        return [
            ("duplicate commitment: the same seller commits "
             "the same hash a second time",
             lambda run, ts: commit("seller1",
                                    self.prices["seller1"],
                                    self.salts["seller1"], bond),
             s1, self.in_bid_early, "reject", "attack", False, False),
            ("commit with too small a bond",
             lambda run, ts: commit("seller3",
                                    uncommitted_price,
                                    uncommitted_salt, small_bond),
             s3, self.in_bid_early, "reject", "attack", False, False),
            ("rewrite the locked rules: update_rules after "
             "the lock",
             lambda run, ts: build_update_rules(t, changed_rules),
             op, self.in_bid_early, "reject", "attack", False, False),
            ("commit after the bid deadline",
             lambda run, ts: commit("seller2", late_price,
                                    late_salt, bond),
             s2, self.after_bid, "reject", "attack", False, False),
            ("reveal with the wrong salt",
             lambda run, ts: build_reveal_bid(
                 t, self.prices["seller1"], wrong_salt,
                 a["seller1"]["public_key"]),
             s1, self.in_reveal_early, "reject", "attack", False, False),
            ("reveal with the wrong price",
             lambda run, ts: build_reveal_bid(
                 t, self.prices["seller1"] - 1_000_000,
                 self.salts["seller1"],
                 a["seller1"]["public_key"]),
             s1, self.in_reveal_early, "reject", "attack", False, False),
            ("reveal of seller1's bid under seller2's identity",
             lambda run, ts: build_reveal_bid(
                 t, self.prices["seller1"], self.salts["seller1"],
                 a["seller2"]["public_key"]),
             s2, self.in_reveal_early, "reject", "attack", False, False),
            ("reveal of a bid that was never committed, by an "
             "account that never bid",
             lambda run, ts: build_reveal_bid(
                 t, uncommitted_price, uncommitted_salt,
                 a["second"]["public_key"]),
             sec, self.in_reveal_early, "reject", "attack", False, False),
            ("honest reveal, seller1",
             lambda run, ts: build_reveal_bid(
                 t, self.prices["seller1"], self.salts["seller1"],
                 a["seller1"]["public_key"]),
             s1, self.in_reveal, "accept", "honest", False, False),
            ("honest reveal, seller2",
             lambda run, ts: build_reveal_bid(
                 t, self.prices["seller2"], self.salts["seller2"],
                 a["seller2"]["public_key"]),
             s2, self.in_reveal, "accept", "honest", False, False),
            ("the same bid revealed twice",
             lambda run, ts: build_reveal_bid(
                 t, self.prices["seller1"], self.salts["seller1"],
                 a["seller1"]["public_key"]),
             s1, self.in_reveal_early, "reject", "attack", False, False),
            ("close the reveal window before its deadline",
             lambda run, ts: build_close_reveal(t),
             op, self.in_reveal_early, "reject", "attack", False, False),
            ("close the reveal window",
             lambda run, ts: build_close_reveal(t),
             op, self.close_ready, "accept", "honest", True, False),
            ("advance to delivery inside the override window",
             lambda run, ts: build_advance_delivery(t),
             op, self.in_override, "reject", "attack", False, True),
            ("override proposed for seller2 with a real rationale",
             lambda run, ts: build_propose_override(
                 t, a["seller2"]["public_key"], rationale),
             op, self.in_override, "accept", "design", False, False),
            ("a single approver signs the override",
             sign_lone,
             op, self.has_proposals, "accept", "design", False, False),
            ("override proposed with an all-zero rationale hash",
             lambda run, ts: build_propose_override(
                 t, a["seller2"]["public_key"], zero_hash),
             op, self.awarded_any, "reject", "attack", False, False),
            ("override proposed for a bid nobody revealed",
             lambda run, ts: build_propose_override(
                 t, a["seller3"]["public_key"], rationale),
             op, self.awarded_any, "reject", "attack", False, False),
            ("observe: a lone signature must not move the award",
             None, None, self.override_signed, "observe", "observe",
             False, False),
            ("advance to delivery after the override window",
             lambda run, ts: build_advance_delivery(t),
             op, self.past_override, "accept", "honest", True, False),
            ("delivery confirmed by operator",
             lambda run, ts: build_confirm_delivery(t),
             op, self.awaiting, "accept", "honest", False, False),
            ("delivery confirmed by second",
             lambda run, ts: build_confirm_delivery(t),
             sec, self.awaiting, "accept", "honest", False, False),
            ("a single approver calls release_refund directly "
             "on the tender",
             lambda run, ts: build_release_refund_direct(t),
             op, self.settled, "reject", "attack", False, False),
            ("the loser tries to claim the payment",
             lambda run, ts: claim_to(a["seller2"]["component"],
                                      t, "claim_payment"),
             s2, self.settled, "reject", "attack", False, False),
            ("an account that never bid tries to claim a bond",
             lambda run, ts: claim_to(a["second"]["component"],
                                      t, "claim_bond"),
             sec, self.settled, "reject", "attack", False, False),
            ("winner claims the payment",
             lambda run, ts: claim_to(a["seller1"]["component"],
                                      t, "claim_payment"),
             s1, self.settled, "accept", "honest", False, False),
            ("the winner claims the payment a second time",
             lambda run, ts: claim_to(a["seller1"]["component"],
                                      t, "claim_payment"),
             s1, self.settled, "reject", "attack", False, False),
            ("winner claims the receipt",
             lambda run, ts: claim_to(a["seller1"]["component"],
                                      t, "claim_receipt"),
             s1, self.settled, "accept", "honest", False, False),
            ("loser claims the bond back",
             lambda run, ts: claim_to(a["seller2"]["component"],
                                      t, "claim_bond"),
             s2, self.settled, "accept", "honest", False, False),
            ("circle collects the refund",
             lambda run, ts: build_collect(
                 self.circle, t, "collect_tender_refund"),
             op, self.settled, "accept", "honest", False, False),
            ("circle collects the forfeits",
             lambda run, ts: build_collect(
                 self.circle, t, "collect_tender_forfeits"),
             op, self.settled, "accept", "honest", False, False),
            ("circle collects the forfeits a second time, with "
             "none left",
             lambda run, ts: build_collect(
                 self.circle, t, "collect_tender_forfeits"),
             op, self.settled, "reject", "attack", False, False),
        ]

    def already_revealed(self, t, account_key):
        return any(c["seller"] == account_key and c["revealed"]
                   for c in t["commitments"])

    def run(self):
        accounts = self.daemon.accounts()
        for role, name in self.names.items():
            if name not in accounts:
                print(f"attack: account {name!r} for role {role} "
                      f"not found in the wallet daemon")
                return 1
        a = {role: accounts[name]
             for role, name in self.names.items()}
        self.accounts = a
        t0 = self.read_tender()
        if t0["state"] != "Draft":
            print(f"attack: tender is {t0['state']}, not Draft; "
                  f"the test needs a fresh draft tender")
            return 1
        if t0["circle"] != self.circle:
            print(f"attack: tender is bound to {t0['circle']}, "
                  f"not the circle named on the command line")
            return 1
        rules = t0["rules"]
        cap = rules["budget_cap"]
        bond = rules["bond_amount"]
        for role, price in self.prices.items():
            if not 0 < price < cap:
                print(f"attack: price for {role} ({price}) must "
                      f"sit below the budget cap ({cap})")
                return 1
        if bond // 2 == bond or bond // 2 == 0:
            print("attack: bond too small to halve for the "
                  "small-bond attack")
            return 1
        for role in ("seller1", "seller2", "seller3"):
            self.salts[role] = os.urandom(32)

        self.log(f"attack: locking tender {self.tender} on "
                 f"circle {self.circle}")
        ok, final, tx, fee, reason = self.submit(
            "attack/lock-tender",
            build_lock_and_fund(a["operator"]["component"],
                                self.tender, cap),
            self.names["operator"])
        if not ok:
            self.log(f"attack: lock rejected ({reason}); stopped")
            return 1
        for role in ("seller1", "seller2", "seller3"):
            price = self.prices[role]
            commitment = commitment_hash(
                price, self.salts[role], a[role]["public_key"])
            self.commitments[role] = commitment
            ok, final, tx, fee, reason = self.submit(
                f"attack/commit-{role}",
                build_commit_bid(a[role]["component"], self.tender,
                                 commitment, bond),
                self.names[role])
            if not ok:
                self.log(f"attack: honest commit for {role} "
                         f"rejected ({reason}); stopped")
                return 1
            time.sleep(8)

        steps = self.steps(a, rules)
        done = 0
        seen_since = {}
        while done < len(steps):
            (label, build, account, cond, expect, kind,
             race_ok, miss_ok) = steps[done]
            try:
                info = self.read_tender()
                now = self.epoch()
            except Exception as exc:  # noqa: BLE001
                self.log(f"attack: read failed ({exc}); "
                         f"retrying in 30s")
                time.sleep(30)
                continue
            if done not in seen_since:
                seen_since[done] = now
            if now - seen_since[done] > 6:
                self.log(f"attack: STOPPED at step {done}: "
                         f"{label}; condition unmet for 6 epochs")
                return 1
            if miss_ok and self.past_override(info, now):
                self.results.append({
                    "step": label, "kind": kind, "expect": expect,
                    "got": "missed",
                    "detail": "the override window closed before "
                              "the attempt could be submitted",
                    "finding": False})
                self.log(f"MISSED {label}: override window "
                         f"closed first")
                done += 1
                continue
            if not cond(info, now):
                time.sleep(15)
                continue
            if expect == "observe":
                award = info.get("award") or {}
                moved = (
                    award.get("winner") != a["seller1"]["public_key"]
                    or info.get("override_record") is not None)
                self.results.append({
                    "step": label, "kind": "observe",
                    "expect": "award stays with seller1",
                    "observed_winner": award.get("winner"),
                    "override_record": info.get("override_record"),
                    "finding": moved})
                self.log(f"OBSERVE {label}: winner "
                         f"{award.get('winner')} "
                         f"{'FINDING: award moved' if moved else 'as expected'}")
                if moved:
                    return 1
                done += 1
                time.sleep(5)
                continue
            instructions = build(self, info)
            if instructions is None:
                time.sleep(15)
                continue
            if expect == "accept" and kind == "honest" \
                    and label.startswith("honest reveal"):
                role = ("seller1"
                        if account == self.names["seller1"]
                        else "seller2")
                if self.already_revealed(info, a[role]["public_key"]):
                    self.log(f"attack: {label} already on chain; "
                             f"marking done")
                    done += 1
                    continue
            ok, final, tx, fee, reason = self.submit(
                label, instructions, account)
            if (final.get("result") or {}).get("timed_out"):
                self.log(f"attack: STOPPED at step {done}: "
                         f"{label}; transaction timed out, "
                         f"outcome unknown")
                return 1
            got = "accept" if ok else "reject"
            entry = {"step": label, "kind": kind, "account": account,
                     "tx": tx, "expect": expect, "got": got,
                     "fee": fee, "epoch_at_submit": self.epoch(),
                     "reason": reason, "finding": got != expect}
            # Only a boundary wording earns the one identical
            # resubmission: the window the step was waiting on
            # had not turned yet, in the chain's own words.
            # Anything else is a real rejection and stands.
            window_phrases = ("still open", "has not closed",
                              "has not opened", "not yet closed",
                              "not yet open")
            if got != expect and race_ok and not ok \
                    and self.attempts.get(done, 0) == 0 \
                    and reason and any(p in reason.lower()
                                       for p in window_phrases):
                entry["finding"] = False
                entry["race_attempt"] = True
                self.results.append(entry)
                self.attempts[done] = 1
                self.log(f"attack: boundary race on {label}; "
                         f"waiting one epoch and resubmitting "
                         f"identically, once")
                turn = self.epoch()
                while self.epoch() <= turn:
                    time.sleep(20)
                continue
            self.results.append(entry)
            # A rejection is only the tested refusal when the
            # chain refused it for the tested reason. Anything
            # else (a window that turned, a wrong account, a
            # stale read) is a finding, not a pass, and the run
            # stops here the same way a wrong outcome stops it.
            if not ok and expect == "reject":
                expected_reason = next(
                    (r for p, r in EXPECTED_REASONS.items()
                     if label.startswith(p)), None)
                if not rejection_reason_matches(reason, expected_reason):
                    entry["finding"] = True
                    entry["reason_expected"] = expected_reason
                    self.log(f"attack: FINDING at step {done}: {label} "
                             f"(rejected, but not with the expected reason: "
                             f"expected {expected_reason!r}, got {reason!r})")
                    return 1
            if got != expect:
                self.log(f"attack: FINDING at step {done}: "
                         f"{label} (expected {expect}, got {got})")
                return 1
            done += 1
            time.sleep(5)
        findings = [r for r in self.results if r.get("finding")]
        rejected = [r for r in self.results
                    if r.get("got") == "reject"]
        self.log(f"attack: finished. {len(rejected)} attacks "
                 f"rejected by the chain, {len(findings)} "
                 f"findings.")
        return 1 if findings else 0


def main():
    p = argparse.ArgumentParser(
        description="Attack your own Asiri tender and report "
                    "the chain's rejections.")
    p.add_argument("--tender", required=True,
                   help="the test tender's component address")
    p.add_argument("--circle", required=True,
                   help="the circle the tender is bound to")
    p.add_argument("--cookie", required=True,
                   help="path to the wallet daemon's .cookie file")
    p.add_argument("--network", default="mainnet",
                   choices=sorted(V.NETWORKS),
                   help="network the tender lives on (default mainnet)")
    p.add_argument("--daemon", default="http://127.0.0.1:5100/json_rpc",
                   help="the wallet daemon's JSON-RPC address")
    p.add_argument("--operator", default="operator",
                   help="daemon account name for the operator")
    p.add_argument("--second", default="second",
                   help="daemon account name for the second approver")
    p.add_argument("--seller1", default="seller1",
                   help="daemon account name for the winning seller")
    p.add_argument("--seller2", default="seller2",
                   help="daemon account name for the losing seller")
    p.add_argument("--seller3", default="seller3",
                   help="daemon account name for the sealed-bid seller")
    p.add_argument("--price1", type=int, default=15_000_000,
                   help="seller1's price in microtari")
    p.add_argument("--price2", type=int, default=17_500_000,
                   help="seller2's price in microtari")
    p.add_argument("--price3", type=int, default=12_000_000,
                   help="seller3's sealed price in microtari")
    p.add_argument("--report",
                   help="write the run's results as JSON to this path")
    args = p.parse_args()
    run = AttackRun(args)
    code = run.run()
    if args.report:
        Path(args.report).write_text(
            json.dumps(run.results, indent=2), encoding="utf-8")
    return code


if __name__ == "__main__":
    sys.exit(main())
