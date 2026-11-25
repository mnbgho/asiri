#!/usr/bin/env python3
"""Recorded-record tests for verify.py.

The fixtures are recordings in structure: each FakeSource answer
has exactly the shape the indexer client returns (decoded substate
values, event lists, transaction bodies), built from one coherent
tender story. The story: a circle locks a tender with cap 10000
and bond 100, three sellers commit, two reveal (2140 and 1950),
one stays silent and forfeits, the 1950 bid wins and settles.

Run: python3 -m pytest test_verify.py  (or plain python3, it
falls back to a tiny runner at the bottom.)
"""

import base64
import hashlib
import sys

from asiri_verify import verify as V

# ------------------------------------------------------------ encoder
# Minimal CBOR encoder, only what the fixtures need.


def enc(v):
    if isinstance(v, bool):
        return b"\xf5" if v else b"\xf4"
    if v is None:
        return b"\xf6"
    if isinstance(v, int):
        if v < 0:
            raise ValueError("fixtures use unsigned ints only")
        if v < 24:
            return bytes([v])
        if v < 256:
            return b"\x18" + bytes([v])
        if v < 65536:
            return b"\x19" + v.to_bytes(2, "big")
        if v < 2**32:
            return b"\x1a" + v.to_bytes(4, "big")
        return b"\x1b" + v.to_bytes(8, "big")
    if isinstance(v, bytes):
        return _head(0x40, len(v)) + v
    if isinstance(v, str):
        raw = v.encode()
        return _head(0x60, len(raw)) + raw
    if isinstance(v, list):
        return _head(0x80, len(v)) + b"".join(enc(x) for x in v)
    if isinstance(v, V.Tagged):
        return _head(0xC0, v.tag) + enc(v.value)
    raise TypeError(f"cannot encode {type(v)}")


def _head(major, n):
    if n < 24:
        return bytes([major | n])
    if n < 256:
        return bytes([major | 24, n])
    if n < 65536:
        return bytes([major | 25]) + n.to_bytes(2, "big")
    return bytes([major | 26]) + n.to_bytes(4, "big")


def lit(v):
    return {"Literal": enc(v).hex()}


# ------------------------------------------------------------ the story

CIRCLE = "component_" + "aa" * 32
TENDER = "component_" + "bb" * 32
ESCROW = "vault_" + "cc" * 32
BONDS = "vault_" + "dd" * 32
TEMPLATE = "template_" + "ee" * 32
CIRCLE_TEMPLATE = "template_" + "ff" * 32

APPROVER1 = "11" * 32
APPROVER2 = "22" * 32
APPROVER3 = "33" * 32
SELLER_A = "a1" * 32
SELLER_B = "b2" * 32
SELLER_C = "c3" * 32
IDENT_A = "a9" * 32
IDENT_B = "b9" * 32

SALT_A = bytes(range(32))
SALT_B = bytes(range(32, 64))

RULES = {
    "specification_hash": "07" * 32,
    "budget_cap": 10000,
    "bond_amount": 100,
    "bid_window_epochs": 5,
    "reveal_window_epochs": 5,
    "override_window_epochs": 3,
    "delivery_window_epochs": 5,
    "claim_grace_epochs": 3,
    "dispute_window_epochs": 4,
    "approval_threshold": 2,
    "dispute_threshold": 3,
}
RULES_HASH = hashlib.sha256(V.canonical_rules_bytes(RULES)).hexdigest()

COMMIT_A = hashlib.sha256(V.commitment_bytes(2140, SALT_A, IDENT_A)).hexdigest()
COMMIT_B = hashlib.sha256(V.commitment_bytes(1950, SALT_B, IDENT_B)).hexdigest()
COMMIT_C = hashlib.sha256(b"never revealed").hexdigest()

FAKE_WASM = b"\x00asm" + b"\x01" * 2000
CODE_HASH = hashlib.sha256(FAKE_WASM).hexdigest()


def rules_list(r=RULES):
    return [
        bytes.fromhex(r["specification_hash"]), r["budget_cap"],
        r["bond_amount"], r["bid_window_epochs"], r["reveal_window_epochs"],
        r["override_window_epochs"], r["delivery_window_epochs"],
        r["claim_grace_epochs"], r["dispute_window_epochs"],
        r["approval_threshold"], r["dispute_threshold"],
    ]


def component(template_hex, state):
    return [0, [[ [bytes.fromhex(template_hex), 0], [state] ]]]


def vault(balance):
    return [0, [[V.Tagged(131, bytes.fromhex("01" * 32)), balance]]]


def commitment(seller, digest, revealed, bond_idx):
    return [bytes.fromhex(seller), bytes.fromhex(digest), 10, revealed,
            [bond_idx, []]]


def reveal(seller, price, counter, digest):
    return [bytes.fromhex(seller), price, 12, counter, True,
            bytes.fromhex(digest)]


def tender_state(over=None):
    state = [None] * 36
    state[0] = V.Tagged(128, bytes.fromhex("aa" * 32))
    state[1] = "Uyo Shopkeepers Circle"
    state[2] = True
    state[3] = [bytes.fromhex(k) for k in (APPROVER1, APPROVER2, APPROVER3)]
    state[4] = rules_list()
    state[5] = bytes.fromhex(RULES_HASH)
    state[6] = [5, []]  # Settled
    state[7] = V.Tagged(132, bytes.fromhex("cc" * 32))
    state[8] = V.Tagged(132, bytes.fromhex("dd" * 32))
    state[9] = None
    state[10] = 10
    state[11] = 15
    state[12] = 20
    state[13] = 23
    state[14] = 23
    state[15] = 28
    state[16] = 31
    # On chain the template binds seller, payment identity, and
    # winner to one key, so the fixture uses the identities as the
    # seller keys.
    state[17] = [
        commitment(IDENT_A, COMMIT_A, True, 2),
        commitment(IDENT_B, COMMIT_B, True, 2),
        commitment(SELLER_C, COMMIT_C, False, 3),
    ]
    state[18] = [
        reveal(IDENT_A, 2140, 0, COMMIT_A),
        reveal(IDENT_B, 1950, 1, COMMIT_B),
    ]
    state[19] = 2
    state[20] = [bytes.fromhex(IDENT_B), bytes.fromhex(COMMIT_B), 1950, 3, 2, 25, False]
    state[21] = []
    state[22] = None
    state[23] = [bytes.fromhex(APPROVER1), bytes.fromhex(APPROVER2)]
    state[24] = None
    state[25] = []
    state[26] = [bytes.fromhex(IDENT_B), 1950, 25]
    state[27] = 8050
    state[28] = True
    state[29] = True
    state[30] = 50
    state[31] = 50
    state[32] = True
    state[33] = None
    state[34] = []
    state[35] = 0
    for k, v in (over or {}).items():
        state[k] = v
    return state


def reveal_tx(tx_id, tender, price, salt, identity):
    return {
        "transaction": {
            "instructions": [
                {"CallMethod": {
                    "call": {"Address": tender},
                    "method": "reveal_bid",
                    "args": [lit(price), lit(list(salt)),
                             lit(bytes.fromhex(identity))],
                }},
            ],
        },
        "_id": tx_id,
    }


class FakeSource:
    def __init__(self, substates, txs=None):
        self._substates = substates
        self._txs = txs or {}

    def substate(self, substate_id, large=False):
        value = self._substates.get(substate_id)
        if value is None:
            raise ValueError(f"no recording for {substate_id}")
        return value

    def events(self, substate_id):
        return [{"transaction_id": tx_id} for tx_id in self._txs]

    def transaction(self, tx_id):
        return self._txs[tx_id]


def settled_source(state_over=None):
    substates = {
        TENDER: component("ee" * 32, tender_state(state_over)),
        ESCROW: vault(0),
        BONDS: vault(50),  # the locked forfeit half stays behind
        TEMPLATE: [0, [[FAKE_WASM]]],
    }
    txs = {
        "tx-reveal-a": reveal_tx("tx-reveal-a", TENDER, 2140, SALT_A, IDENT_A),
        "tx-reveal-b": reveal_tx("tx-reveal-b", TENDER, 1950, SALT_B, IDENT_B),
    }
    return FakeSource(substates, txs)


def patched_network(code_hash=CODE_HASH):
    V.NETWORKS["esmeralda"].update({
        "circle_template": CIRCLE_TEMPLATE,
        "tender_template": TEMPLATE,
        "circle_code_hash": None,
        "tender_code_hash": code_hash,
    })


# ------------------------------------------------------------ tests


def test_settled_tender_passes():
    patched_network()
    rep = V.verify(TENDER, "esmeralda", source=settled_source())
    failed = [r for r in rep.rows if not r["ok"]]
    assert not failed, failed


def test_wrong_code_hash_fails():
    patched_network(code_hash="00" * 32)
    rep = V.verify(TENDER, "esmeralda", source=settled_source())
    row = [r for r in rep.rows if r["check"] == "template code hash"]
    assert row and not row[0]["ok"]


def test_unreadable_template_substate_reports_could_not_read():
    patched_network()
    import urllib.error
    source = settled_source()
    real_substate = source.substate

    def flaky(substate_id, large=False):
        if substate_id == TEMPLATE:
            raise urllib.error.URLError("truncated read")
        return real_substate(substate_id, large=large)

    source.substate = flaky
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = [r for r in rep.rows if r["check"] == "template code hash"]
    assert row and row[0]["ok"] is None
    assert not rep.failed, rep.failed


def test_unreadable_escrow_vault_reports_could_not_read():
    patched_network()
    import urllib.error
    source = settled_source()
    real_substate = source.substate

    def flaky(substate_id, large=False):
        if substate_id == ESCROW:
            raise urllib.error.URLError("truncated read")
        return real_substate(substate_id, large=large)

    source.substate = flaky
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = [r for r in rep.rows if r["check"] == "escrow funding"]
    assert row and row[0]["ok"] is None
    assert not rep.failed, rep.failed


def test_root_fetch_transport_reports_could_not_read():
    # A tender whose record cannot be fetched at all still gets a
    # report, never a crash.
    patched_network()
    import urllib.error
    source = settled_source()
    real_substate = source.substate

    def flaky(substate_id, large=False):
        if substate_id == TENDER:
            raise urllib.error.URLError("connection reset")
        return real_substate(substate_id, large=large)

    source.substate = flaky
    rep = V.verify(TENDER, "esmeralda", source=source)
    assert len(rep.rows) == 1, rep.rows
    row = rep.rows[0]
    assert row["check"] == "tender exists" and row["ok"] is None
    assert not rep.failed, rep.failed
    assert rep.unknown, rep.rows


def test_root_fetch_decode_error_fails():
    # Bytes that arrived but cannot be decoded are a failure of
    # the record, not an unreadable read.
    patched_network()
    source = settled_source()
    real_substate = source.substate

    def flaky(substate_id, large=False):
        if substate_id == TENDER:
            raise ValueError("bad cbor in tender substate")
        return real_substate(substate_id, large=large)

    source.substate = flaky
    rep = V.verify(TENDER, "esmeralda", source=source)
    assert len(rep.rows) == 1, rep.rows
    row = rep.rows[0]
    assert row["check"] == "tender exists" and row["ok"] is False


def test_malformed_tender_record_fails():
    # The template matches, but the state does not decode: the
    # tender record itself is invalid.
    patched_network()
    substates = {TENDER: component("ee" * 32, [None] * 12)}
    rep = V.verify(TENDER, "esmeralda", source=FakeSource(substates))
    assert len(rep.rows) == 1, rep.rows
    row = rep.rows[0]
    assert row["check"] == "tender exists" and row["ok"] is False
    assert "unreadable" in row["detail"], row


def test_template_decode_error_fails():
    patched_network()
    source = settled_source()
    real_substate = source.substate

    def flaky(substate_id, large=False):
        if substate_id == TEMPLATE:
            raise ValueError("bad cbor in template substate")
        return real_substate(substate_id, large=large)

    source.substate = flaky
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = [r for r in rep.rows if r["check"] == "template code hash"]
    assert row and row[0]["ok"] is False


def test_escrow_decode_error_fails():
    patched_network()
    source = settled_source()
    real_substate = source.substate

    def flaky(substate_id, large=False):
        if substate_id == ESCROW:
            raise ValueError("bad cbor in escrow vault")
        return real_substate(substate_id, large=large)

    source.substate = flaky
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = [r for r in rep.rows if r["check"] == "escrow funding"]
    assert row and row[0]["ok"] is False


def test_bond_vault_transport_reports_could_not_read():
    patched_network()
    import urllib.error
    source = settled_source()
    real_substate = source.substate

    def flaky(substate_id, large=False):
        if substate_id == BONDS:
            raise urllib.error.URLError("timed out")
        return real_substate(substate_id, large=large)

    source.substate = flaky
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = [r for r in rep.rows if r["check"] == "bond vault reconciles"]
    assert row and row[0]["ok"] is None
    assert not rep.failed, rep.failed


def test_bond_vault_decode_error_fails():
    patched_network()
    source = settled_source()
    real_substate = source.substate

    def flaky(substate_id, large=False):
        if substate_id == BONDS:
            raise ValueError("bad cbor in bond vault")
        return real_substate(substate_id, large=large)

    source.substate = flaky
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = [r for r in rep.rows if r["check"] == "bond vault reconciles"]
    assert row and row[0]["ok"] is False
    assert BONDS in row[0]["detail"], row


def test_bond_vault_without_balance_fails():
    patched_network()
    source = settled_source()
    source._substates[BONDS] = [1, 2]
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = [r for r in rep.rows if r["check"] == "bond vault reconciles"]
    assert row and row[0]["ok"] is False
    assert "no balance" in row[0]["detail"], row


def test_wrong_award_fails():
    patched_network()
    bad_award = [bytes.fromhex(IDENT_A), bytes.fromhex(COMMIT_A), 2140, 3, 2, 25, False]
    rep = V.verify(TENDER, "esmeralda",
                   source=settled_source({20: bad_award}))
    row = [r for r in rep.rows
           if r["check"] == "award is the lowest valid revealed price"]
    assert row and not row[0]["ok"]


def test_settlement_wording_names_a_matching_winner():
    patched_network()
    rep = V.verify(TENDER, "esmeralda", source=settled_source())
    row = [r for r in rep.rows if r["check"] == "settlement equals the award"]
    assert row and row[0]["ok"]
    assert "winner matches the award" in row[0]["detail"]


def test_settlement_wording_names_a_mismatched_winner():
    patched_network()
    bad_settlement = [bytes.fromhex(IDENT_A), 1950, 25]
    rep = V.verify(TENDER, "esmeralda",
                   source=settled_source({26: bad_settlement}))
    row = [r for r in rep.rows if r["check"] == "settlement equals the award"]
    assert row and not row[0]["ok"]
    assert "winner does not match the award" in row[0]["detail"]
    assert "winner matches the award" not in row[0]["detail"]


def override_source():
    rationale = b"the low bidder could not meet the delivery date"
    digest = hashlib.sha256(rationale).hexdigest()
    # On chain the override choice is a seller public key, never a
    # commitment hash: propose_override takes the seller key.
    proposal = [1, bytes.fromhex(IDENT_A), bytes.fromhex(digest),
                [bytes.fromhex(APPROVER1), bytes.fromhex(APPROVER2)],
                True, False]
    record = [bytes.fromhex(IDENT_A), bytes.fromhex(digest), 21]
    award = [bytes.fromhex(IDENT_A), bytes.fromhex(COMMIT_A), 2140, 3, 2, 25, True]
    settlement = [bytes.fromhex(IDENT_A), 2140, 25]
    state = tender_state({
        20: award, 21: [proposal], 22: record, 26: settlement, 27: 7860,
    })
    substates = {
        TENDER: component("ee" * 32, state),
        ESCROW: vault(0),
        BONDS: vault(50),
        TEMPLATE: [0, [[FAKE_WASM]]],
    }
    txs = {
        "tx-reveal-a": reveal_tx("tx-reveal-a", TENDER, 2140, SALT_A, IDENT_A),
        "tx-reveal-b": reveal_tx("tx-reveal-b", TENDER, 1950, SALT_B, IDENT_B),
    }
    return FakeSource(substates, txs), rationale


def test_override_without_published_text_fails_as_unverifiable():
    patched_network()
    source, _rationale = override_source()
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = [r for r in rep.rows if r["check"] == "override rationale text"]
    assert row and not row[0]["ok"]
    assert "unverifiable" in row[0]["detail"]


def test_override_with_published_text_passes():
    patched_network()
    source, rationale = override_source()
    rep = V.verify(TENDER, "esmeralda", rationale_text=rationale,
                   source=source)
    failed = [r for r in rep.rows if not r["ok"]]
    assert not failed, failed


def test_tampered_reveal_price_fails():
    patched_network()
    source = settled_source()
    source._txs["tx-reveal-b"] = reveal_tx(
        "tx-reveal-b", TENDER, 1900, SALT_B, IDENT_B)
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = [r for r in rep.rows
           if r["check"] == "reveals verify against commitments"]
    assert row and not row[0]["ok"]


def test_pair_shaped_events_find_reveals():
    # The live indexer serves events as [transaction id, payload]
    # pairs, not objects. The reveal hunt must read that shape.
    class PairSource(FakeSource):
        def events(self, substate_id):
            return [[tx_id, "payload"] for tx_id in self._txs]

    base = settled_source()
    source = PairSource(base._substates, base._txs)
    rep = V.verify(TENDER, "esmeralda", source=source)
    failed = [r for r in rep.rows if not r["ok"]]
    assert not failed, failed


def test_duplicate_commitment_fails_record_counts():
    patched_network()
    commitments = [
        commitment(IDENT_A, COMMIT_A, True, 2),
        commitment(IDENT_B, COMMIT_B, True, 2),
        commitment(SELLER_C, COMMIT_C, False, 3),
        commitment("d4" * 32, COMMIT_A, True, 2),
    ]
    rep = V.verify(TENDER, "esmeralda",
                   source=settled_source({17: commitments}))
    row = [r for r in rep.rows if r["check"] == "record counts"]
    assert row and not row[0]["ok"]


def test_duplicate_seller_fails_record_counts():
    patched_network()
    other = hashlib.sha256(b"a second commitment").hexdigest()
    commitments = [
        commitment(IDENT_A, COMMIT_A, True, 2),
        commitment(IDENT_B, COMMIT_B, True, 2),
        commitment(SELLER_C, COMMIT_C, False, 3),
        commitment(IDENT_A, other, False, 2),
    ]
    rep = V.verify(TENDER, "esmeralda",
                   source=settled_source({17: commitments}))
    row = [r for r in rep.rows if r["check"] == "record counts"]
    assert row and not row[0]["ok"]


def test_revealed_flag_mismatch_fails_record_counts():
    patched_network()
    commitments = [
        commitment(IDENT_A, COMMIT_A, False, 2),
        commitment(IDENT_B, COMMIT_B, True, 2),
        commitment(SELLER_C, COMMIT_C, False, 3),
    ]
    rep = V.verify(TENDER, "esmeralda",
                   source=settled_source({17: commitments}))
    row = [r for r in rep.rows if r["check"] == "record counts"]
    assert row and not row[0]["ok"]


def test_wrong_winner_fails():
    patched_network()
    bad_award = [bytes.fromhex(IDENT_A), bytes.fromhex(COMMIT_B), 1950, 3, 2, 25, False]
    rep = V.verify(TENDER, "esmeralda",
                   source=settled_source({20: bad_award}))
    row = [r for r in rep.rows
           if r["check"] == "award is the lowest valid revealed price"]
    assert row and not row[0]["ok"]


def test_forfeit_split_fails():
    patched_network()
    rep = V.verify(TENDER, "esmeralda",
                   source=settled_source({30: 60, 31: 40}))
    row = [r for r in rep.rows if r["check"] == "forfeit split recorded"]
    assert row and not row[0]["ok"]


def test_override_chosen_mismatch_fails():
    patched_network()
    rationale = b"the low bidder could not meet the delivery date"
    digest = hashlib.sha256(rationale).hexdigest()
    proposal = [1, bytes.fromhex(IDENT_A), bytes.fromhex(digest),
                [bytes.fromhex(APPROVER1), bytes.fromhex(APPROVER2)],
                True, False]
    record = [bytes.fromhex(IDENT_B), bytes.fromhex(digest), 21]
    award = [bytes.fromhex(IDENT_A), bytes.fromhex(COMMIT_A), 2140, 3, 2, 25, True]
    settlement = [bytes.fromhex(IDENT_A), 2140, 25]
    state = tender_state({
        20: award, 21: [proposal], 22: record, 26: settlement, 27: 7860,
    })
    substates = {
        TENDER: component("ee" * 32, state),
        ESCROW: vault(0),
        BONDS: vault(50),
        TEMPLATE: [0, [[FAKE_WASM]]],
    }
    txs = {
        "tx-reveal-a": reveal_tx("tx-reveal-a", TENDER, 2140, SALT_A, IDENT_A),
        "tx-reveal-b": reveal_tx("tx-reveal-b", TENDER, 1950, SALT_B, IDENT_B),
    }
    rep = V.verify(TENDER, "esmeralda", rationale_text=rationale,
                   source=FakeSource(substates, txs))
    row = [r for r in rep.rows
           if r["check"] == "override threshold and rationale hash"]
    assert row and not row[0]["ok"]
    # The record's chosen seller has a valid reveal, but the award
    # went to the other seller, so the choice check must fail too.
    row = [r for r in rep.rows
           if r["check"] == "override choice is a valid revealed bid"]
    assert row and not row[0]["ok"]


def test_unresolved_dispute_decodes():
    # An unresolved dispute record carries only three fields on
    # chain: the trailing empty options are omitted.
    state = tender_state({
        6: [7, []],  # Disputed
        24: [bytes.fromhex("ef" * 32), 30, 33],
    })
    t = V.decode_tender(component("ee" * 32, state))
    assert t["state"] == "Disputed"
    assert t["dispute"]["evidence_hash"] == "ef" * 32
    assert t["dispute"]["epoch"] == 30
    assert t["dispute"]["deadline"] == 33
    assert t["dispute"]["resolved_for_winner"] is None
    assert t["dispute"]["rationale_hash"] is None


def test_resolved_dispute_decodes():
    state = tender_state({
        6: [7, []],  # Disputed
        24: [bytes.fromhex("ef" * 32), 30, 33, True,
             bytes.fromhex("ab" * 32)],
    })
    t = V.decode_tender(component("ee" * 32, state))
    assert t["dispute"]["resolved_for_winner"] is True
    assert t["dispute"]["rationale_hash"] == "ab" * 32


def test_partly_resolved_dispute_decodes():
    # Four fields: the resolution flag is present, the rationale
    # hash is still empty and omitted.
    state = tender_state({
        6: [7, []],  # Disputed
        24: [bytes.fromhex("ef" * 32), 30, 33, False],
    })
    t = V.decode_tender(component("ee" * 32, state))
    assert t["dispute"]["resolved_for_winner"] is False
    assert t["dispute"]["rationale_hash"] is None


def test_malformed_dispute_lengths_fail():
    for bad in ([bytes.fromhex("ef" * 32), 30],
                [bytes.fromhex("ef" * 32), 30, 33, True,
                 bytes.fromhex("ab" * 32), 99]):
        state = tender_state({6: [7, []], 24: bad})
        try:
            V.decode_tender(component("ee" * 32, state))
        except ValueError:
            continue
        raise AssertionError(f"dispute with {len(bad)} fields decoded")


def test_live_vault_fixture_decodes():
    # Recorded from the first live tender's escrow vault on
    # esmeralda (20 tari). The container is
    # [Tagged(131, resource), revealed balance, 0].
    raw = base64.b64decode(
        "ggKBgoIDg9iDWCABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBARoBMS0AAAA=")
    assert V.decode_vault_balance(V.cbor_decode(raw)) == 20_000_000


# ------------------------------------------------------ indexer reads
# The template substate carries the whole WASM binary and the
# public indexers intermittently stall serving it, so a large
# read retries across both indexers with a long timeout.


class _StubResponse:
    def __init__(self, payload):
        import json as _json

        self._body = _json.dumps(payload).encode()
        self._length = len(self._body)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def info(self):
        return {"Content-Length": str(self._length)}

    def read(self, size=-1):
        if size is None or size < 0:
            out, self._body = self._body, b""
            return out
        out, self._body = self._body[:size], self._body[size:]
        return out

    def read1(self, size=-1):
        # The stub holds the whole body, so read1 and read agree.
        return self.read(size)


def _stub_urlopen(calls, behaviour):
    def fake(req, timeout=None):
        calls.append((req.full_url, timeout))
        outcome = behaviour(req.full_url)
        if isinstance(outcome, Exception):
            raise outcome
        return _StubResponse(outcome)

    return fake


def _with_urlopen(calls, behaviour, fn):
    import urllib.request

    original = urllib.request.urlopen
    urllib.request.urlopen = _stub_urlopen(calls, behaviour)
    try:
        return fn()
    finally:
        urllib.request.urlopen = original


def _up_body(value):
    return {"state": {"up": {"substate": base64.b64encode(enc(value)).decode()}}}


def test_large_substate_falls_back_to_second_indexer():
    import urllib.error

    calls = []

    def behaviour(url):
        if url.startswith("https://primary.example"):
            return urllib.error.URLError("timed out")
        return _up_body(7)

    idx = V.Indexer("https://primary.example", "https://fallback.example")
    result = _with_urlopen(calls, behaviour, lambda: idx.substate("template_x", large=True))
    assert result == 7
    assert [c[0].split("/")[2] for c in calls] == ["primary.example", "fallback.example"]
    assert all(c[1] == 120 for c in calls)


def test_large_substate_raises_after_all_attempts():
    import urllib.error

    calls = []

    def behaviour(url):
        return urllib.error.URLError("timed out")

    idx = V.Indexer("https://primary.example", "https://fallback.example")
    try:
        _with_urlopen(calls, behaviour, lambda: idx.substate("template_x", large=True))
    except urllib.error.URLError:
        pass
    else:
        raise AssertionError("the large read should have raised")
    assert len(calls) == 3


def test_large_substate_down_answer_is_definitive():
    calls = []

    def behaviour(url):
        return {"state": {"down": {"version": 3}}}

    idx = V.Indexer("https://primary.example", "https://fallback.example")
    result = _with_urlopen(calls, behaviour, lambda: idx.substate("template_x", large=True))
    assert result is None
    assert len(calls) == 1


def test_small_substate_reads_primary_once_with_short_timeout():
    calls = []

    def behaviour(url):
        return _up_body(11)

    idx = V.Indexer("https://primary.example", "https://fallback.example")
    result = _with_urlopen(calls, behaviour, lambda: idx.substate("component_x"))
    assert result == 11
    assert len(calls) == 1
    assert calls[0][1] == 30


def test_transaction_read_falls_back_to_second_indexer():
    import urllib.error

    calls = []

    def behaviour(url):
        if url.startswith("https://primary.example"):
            return urllib.error.HTTPError(url, 404, "not found", None, None)
        return {"transaction_id": "tx1"}

    idx = V.Indexer("https://primary.example", "https://fallback.example")
    result = _with_urlopen(calls, behaviour, lambda: idx.transaction("tx1"))
    assert result == {"transaction_id": "tx1"}
    assert [c[0].split("/")[2] for c in calls] == ["primary.example", "fallback.example"]


def test_small_substate_falls_back_to_second_indexer():
    import urllib.error

    calls = []

    def behaviour(url):
        if url.startswith("https://primary.example"):
            return urllib.error.URLError("timed out")
        return _up_body(13)

    idx = V.Indexer("https://primary.example", "https://fallback.example")
    result = _with_urlopen(calls, behaviour, lambda: idx.substate("component_x"))
    assert result == 13
    assert [c[0].split("/")[2] for c in calls] == ["primary.example", "fallback.example"]
    assert all(c[1] == 30 for c in calls)


def test_substate_data_error_rescued_by_fallback():
    # A data error on the primary must not stop failover: the
    # fallback may serve good bytes for the same substate.
    calls = []

    def behaviour(url):
        if url.startswith("https://primary.example"):
            return ValueError("bad cbor")
        return _up_body(7)

    idx = V.Indexer("https://primary.example", "https://fallback.example")
    result = _with_urlopen(calls, behaviour, lambda: idx.substate("component_x"))
    assert result == 7
    assert len(calls) == 2


def test_substate_data_error_survives_all_attempts():
    # When every indexer serves bytes that cannot be decoded, the
    # surviving error is the data error, never a transport error:
    # callers must report it as a failure, not as unreadable.
    calls = []

    def behaviour(url):
        return ValueError("bad cbor")

    idx = V.Indexer("https://primary.example", "https://fallback.example")
    try:
        _with_urlopen(calls, behaviour, lambda: idx.substate("component_x"))
    except ValueError:
        pass
    else:
        raise AssertionError("the data error should have raised")
    assert len(calls) == 3


def test_transaction_data_error_survives_all_attempts():
    calls = []

    def behaviour(url):
        return ValueError("malformed json")

    idx = V.Indexer("https://primary.example", "https://fallback.example")
    try:
        _with_urlopen(calls, behaviour, lambda: idx.transaction("tx1"))
    except ValueError:
        pass
    else:
        raise AssertionError("the data error should have raised")
    assert len(calls) == 3


def test_truncated_body_reports_transport_error():
    # A body that ends short of its declared length is a
    # transport failure, not invalid data: read1 returns the
    # partial bytes without raising, so the length check must
    # catch it before the JSON decoder sees a cut body.
    import urllib.request

    class Truncated:
        def __init__(self):
            self._body = b'{"state": {"up": {"substate": "abc'

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read1(self, size=-1):
            out, self._body = self._body, b""
            return out

        def info(self):
            return {"Content-Length": "100000"}

    def fake(req, timeout=None):
        return Truncated()

    original = urllib.request.urlopen
    urllib.request.urlopen = fake
    try:
        idx = V.Indexer("https://primary.example")
        try:
            idx.get("/substates/x", timeout=30)
        except V.TransportError:
            pass
        else:
            raise AssertionError("the truncated body should have raised")
    finally:
        urllib.request.urlopen = original


def test_read_deadline_bounds_a_dribbling_response():
    # A peer that sends a byte every half second never trips the
    # socket timeout, but the read must still end at the deadline.
    import http.server
    import threading
    import time

    class Dribble(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            try:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", "100000")
                self.end_headers()
                for _ in range(20):
                    self.wfile.write(b"x")
                    self.wfile.flush()
                    time.sleep(0.5)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Dribble)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        idx = V.Indexer(f"http://127.0.0.1:{port}")
        start = time.monotonic()
        try:
            idx.get("/x", timeout=2)
        except V.TransportError:
            pass
        else:
            raise AssertionError("the dribbling read should have timed out")
        elapsed = time.monotonic() - start
        assert elapsed < 6, elapsed
    finally:
        server.shutdown()
        server.server_close()


def _reveals_row(rep):
    rows = [r for r in rep.rows
            if r["check"] == "reveals verify against commitments"]
    assert rows, "the reveals row is missing"
    return rows[0]


def test_unreadable_reveal_transactions_report_could_not_read():
    # Every transaction read fails on every indexer (the live
    # esmeralda behaviour of 2026-11-20: the indexers answer 404
    # for the season's transaction bodies). The reveals recorded
    # in the tender state are chain data; what is missing is the
    # corroborating read, so the row is could-not-read, never a
    # failure accusing the record.
    patched_network()

    class RaisingSource(FakeSource):
        def transaction(self, tx_id):
            raise RuntimeError("HTTP Error 404: Not Found")

    base = settled_source()
    source = RaisingSource(base._substates, base._txs)
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = _reveals_row(rep)
    assert row["ok"] is None, row
    assert "could not be read" in row["detail"], row
    assert row not in rep.failed
    assert row in rep.unknown


def test_event_list_failure_reports_reveals_could_not_read():
    # The event list itself cannot be read, so no history was
    # read at all. The reveals are could-not-read, never missing,
    # and verify() returns a report instead of crashing.
    patched_network()

    class NoEventsSource(FakeSource):
        def events(self, substate_id):
            raise RuntimeError("event list timed out")

    base = settled_source()
    source = NoEventsSource(base._substates, base._txs)
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = _reveals_row(rep)
    assert row["ok"] is None, row
    assert not rep.failed, rep.failed


def test_partly_unreadable_reveals_report_could_not_read():
    patched_network()

    class PartlyRaisingSource(FakeSource):
        def transaction(self, tx_id):
            if tx_id == "tx-reveal-b":
                raise RuntimeError("HTTP Error 404: Not Found")
            return self._txs[tx_id]

    base = settled_source()
    source = PartlyRaisingSource(base._substates, base._txs)
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = _reveals_row(rep)
    assert row["ok"] is None, row
    assert "1 of 2 reveals could not be recomputed" in row["detail"], row
    assert "the other 1 recompute" in row["detail"], row


def test_missing_reveal_with_readable_history_still_fails():
    # The history read fine and holds no reveal for the recorded
    # reveals: that is a genuine finding and stays a failure with
    # the original wording.
    patched_network()
    base = settled_source()
    source = FakeSource(base._substates,
                        {"tx-other": {"transaction": {"instructions": []}}})
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = _reveals_row(rep)
    assert row["ok"] is False, row
    assert "no reveal transaction found" in row["detail"], row


def test_genuine_defect_dominates_unreadable_reads():
    # A state record whose price disagrees with its readable
    # reveal transaction fails the check even when another
    # reveal's transaction cannot be read at all.
    patched_network()

    class MixedSource(FakeSource):
        def transaction(self, tx_id):
            if tx_id == "tx-reveal-a":
                raise RuntimeError("HTTP Error 404: Not Found")
            return self._txs[tx_id]

    reveals = [
        reveal(IDENT_A, 2140, 0, COMMIT_A),
        reveal(IDENT_B, 1900, 1, COMMIT_B),
    ]
    base = settled_source({18: reveals})
    source = MixedSource(base._substates, base._txs)
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = _reveals_row(rep)
    assert row["ok"] is False, row
    assert "price mismatch" in row["detail"], row


def test_circle_address_is_named_not_a_tender():
    # Handing the verifier a component that runs a different
    # template (a circle is the common case) must say so in
    # plain words, not surface a decoder field-count complaint.
    patched_network()
    substates = {TENDER: component("dd" * 32, [None] * 12)}
    rep = V.verify(TENDER, "esmeralda", source=FakeSource(substates))
    assert len(rep.rows) == 1, rep.rows
    row = rep.rows[0]
    assert row["check"] == "tender exists" and row["ok"] is False
    assert "does not run the tender template" in row["detail"], row


def test_missing_rationale_file_is_a_clean_error():
    # A rationale path that does not exist must print one clear
    # line and exit 1, never a traceback.
    rc = V.main([TENDER, "--network", "esmeralda",
                 "--rationale", "/nonexistent-rationale.txt"])
    assert rc == 1


def test_reveal_history_serves_plain_check_run():
    # A history file must serve the ordinary check run, not only
    # a receipt: with the indexer bodies lost and the wallet
    # history holding them, the reveals recompute and pass.
    import contextlib
    import io
    import json
    import tempfile
    patched_network()
    base = settled_source()

    class RaisingSource(FakeSource):
        def transaction(self, tx_id):
            raise RuntimeError("HTTP Error 404: Not Found")

    source = RaisingSource(base._substates, base._txs)
    original = V.Indexer
    V.Indexer = lambda *args, **kwargs: source
    try:
        with tempfile.TemporaryDirectory() as tmp:
            path = tmp + "/history.json"
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(_wallet_records(), fh)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = V.main([TENDER, "--network", "esmeralda",
                             "--reveal-history", path])
    finally:
        V.Indexer = original
    assert rc == 0, buf.getvalue()
    out = buf.getvalue()
    assert "preserved history" in out, out
    assert "[PASS] reveals verify against commitments" in out, out


def test_reveal_history_json_names_the_file():
    import contextlib
    import io
    import json
    import tempfile
    patched_network()
    base = settled_source()

    class RaisingSource(FakeSource):
        def transaction(self, tx_id):
            raise RuntimeError("HTTP Error 404: Not Found")

    source = RaisingSource(base._substates, base._txs)
    original = V.Indexer
    V.Indexer = lambda *args, **kwargs: source
    try:
        with tempfile.TemporaryDirectory() as tmp:
            path = tmp + "/history.json"
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(_wallet_records(), fh)
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                rc = V.main([TENDER, "--network", "esmeralda",
                             "--reveal-history", path, "--json"])
    finally:
        V.Indexer = original
    assert rc == 0, buf.getvalue()
    out = json.loads(buf.getvalue())
    assert out["reveal_history"] == path
    assert out["ok"] is True


def test_reveal_history_missing_file_is_a_clean_error():
    # A history path that does not exist fails fast with one
    # clear line, in the plain run as well as in a receipt run.
    import contextlib
    import io
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = V.main([TENDER, "--network", "esmeralda",
                     "--reveal-history", "/nonexistent-history.json"])
    assert rc == 1
    assert "could not read the reveal history" in buf.getvalue()


# ------------------------------------------------------------ receipts


def _wallet_records():
    # Daemon-dump shape: each record carries its id and the same
    # instruction tree the indexer body carries.
    records = []
    for tx_id, price, salt, ident in (
            ("tx-reveal-a", 2140, SALT_A, IDENT_A),
            ("tx-reveal-b", 1950, SALT_B, IDENT_B)):
        rec = reveal_tx(tx_id, TENDER, price, salt, ident)
        rec["id"] = tx_id
        records.append(rec)
    return records


def test_receipt_for_settled_tender():
    patched_network()
    receipt = V.build_receipt(TENDER, "esmeralda",
                              source=settled_source())
    assert receipt["receipt_version"] == V.RECEIPT_VERSION
    summary = receipt["checks_summary"]
    assert summary["fail"] == 0 and summary["could_not_read"] == 0, summary
    assert receipt["rules"]["rules_hash_matches"] is True
    award = receipt["award"]
    assert award["matches_recorded"] is True
    assert award["recomputed"]["winner"] == IDENT_B
    assert award["recomputed"]["winning_price"] == 1950
    for row in receipt["reveals"]:
        rec = row["recomputation"]
        assert rec["status"] == "recomputed", row
        assert rec["digest_matches_commitment"] is True
        assert rec["price_matches_record"] is True
        assert rec["arguments_source"] == "indexer transaction body"
    assert receipt["escrow"]["reconciles"] is True
    locked = receipt["bonds"]["locked_forever"]
    assert locked and locked["amount_microtari"] == 50, locked
    assert "not burned" in locked["note"]
    assert receipt["exclusion"]["passed_over_revealed_bids"] == []
    assert receipt["limits"]["unrevealed"] == 1
    assert "no claim" in receipt["limits"]["note"]
    assert receipt["exception"] is None


def test_receipt_reveal_from_wallet_history():
    # The indexer has lost the bodies (every transaction read
    # raises), but the operating wallet's preserved history holds
    # them: the receipt recomputes from the history and says so.
    patched_network()

    class RaisingSource(FakeSource):
        def transaction(self, tx_id):
            raise RuntimeError("HTTP Error 404: Not Found")

    base = settled_source()
    source = RaisingSource(base._substates, base._txs)
    wallet = V.WalletHistory(_wallet_records())
    # The generator that produced the season receipts names the
    # archive it used; the receipt then carries that claim.
    receipt = V.build_receipt(
        TENDER, "esmeralda", source=source, wallet_history=wallet,
        wallet_source_label=V.WALLET_SOURCE_LABEL_OPERATING,
        wallet_provenance_note=V.WALLET_PROVENANCE_NOTE)
    for row in receipt["reveals"]:
        rec = row["recomputation"]
        assert rec["status"] == "recomputed", row
        assert rec["arguments_source"] == \
            "operating wallet preserved history"
        assert "preserved history" in rec["provenance_note"]
    row = _reveals_row(type("R", (), {"rows": receipt["checks"]})())
    assert row["ok"] is True, row
    assert "preserved history" in \
        receipt["provenance"]["reveal_transactions"]
    # Without the caller naming the archive, the same build
    # claims only that a preserved history was supplied: no
    # wallet identity and no archive date.
    receipt = V.build_receipt(TENDER, "esmeralda", source=source,
                              wallet_history=wallet)
    for row in receipt["reveals"]:
        rec = row["recomputation"]
        assert rec["status"] == "recomputed", row
        assert rec["arguments_source"] == "preserved wallet history"
        assert "operating wallet" not in rec["provenance_note"]
        assert "2026-11-20" not in rec["provenance_note"]
    assert "operating wallet" not in \
        receipt["provenance"]["reveal_transactions"]


def test_receipt_reveal_could_not_read_without_history():
    patched_network()

    class RaisingSource(FakeSource):
        def transaction(self, tx_id):
            raise RuntimeError("HTTP Error 404: Not Found")

    base = settled_source()
    source = RaisingSource(base._substates, base._txs)
    receipt = V.build_receipt(TENDER, "esmeralda", source=source)
    for row in receipt["reveals"]:
        rec = row["recomputation"]
        assert rec["status"] == "could-not-read", row
        assert rec["digest_matches_commitment"] is None
    assert receipt["checks_summary"]["could_not_read"] == 1
    assert receipt["provenance"]["reveal_transactions"].startswith(
        "could not be read")


def test_receipt_survives_a_failed_second_event_read():
    # The receipt's detailed reveal hunt re-reads the event list
    # after verify() has already run its own hunt. When that
    # second read stalls out on every indexer, the receipt must
    # still be produced, with the per-reveal recomputation
    # reported as could-not-read, not a crash.
    patched_network()

    class FlakyEventsSource(FakeSource):
        def __init__(self, substates, txs=None):
            super().__init__(substates, txs)
            self.event_calls = 0

        def events(self, substate_id):
            self.event_calls += 1
            if self.event_calls > 1:
                raise RuntimeError("The read operation timed out")
            return super().events(substate_id)

    base = settled_source()
    source = FlakyEventsSource(base._substates, base._txs)
    receipt = V.build_receipt(TENDER, "esmeralda", source=source)
    assert receipt["checks_summary"]["fail"] == 0
    for row in receipt["reveals"]:
        rec = row["recomputation"]
        assert rec["status"] == "could-not-read", row
        assert "event list" in rec["provenance_note"]
    assert "event list" in receipt["provenance"]["reveal_transactions"]


def test_receipt_override_exception():
    patched_network()
    source, rationale = override_source()
    receipt = V.build_receipt(TENDER, "esmeralda",
                              rationale_text=rationale, source=source)
    exc = receipt["exception"]
    assert exc is not None
    assert exc["proven_lowest_revealed"]["seller"] == IDENT_B
    assert exc["proven_lowest_revealed"]["price_microtari"] == 1950
    assert exc["price_paid"]["seller"] == IDENT_A
    assert exc["price_paid"]["price_microtari"] == 2140
    assert exc["difference_microtari"] == 190
    ov = receipt["override"]
    assert ov["threshold"]["met"] is True
    assert ov["threshold"]["signer_count"] == 2
    assert ov["threshold"]["required"] == 2
    assert "hashes to the recorded" in ov["rationale_text_check"]
    passed = receipt["exclusion"]["passed_over_revealed_bids"]
    assert len(passed) == 1 and passed[0]["seller"] == IDENT_B
    assert "override" in passed[0]["passed_over_by"]


def test_award_requires_seven_fields():
    # The on-chain award carries epoch and by_override behind the
    # five fields the checks use (measured live on the mainnet gate
    # tender, 2026-11-25). A five-field award, or an eight-field
    # one, is a malformed record, not a shorter form.
    for bad in (
        [bytes.fromhex(IDENT_B), bytes.fromhex(COMMIT_B), 1950, 3, 2],
        [bytes.fromhex(IDENT_B), bytes.fromhex(COMMIT_B), 1950, 3, 2, 25, False, 99],
    ):
        state = tender_state({20: bad})
        try:
            V.decode_tender(component("ee" * 32, state))
        except ValueError:
            continue
        raise AssertionError(f"award with {len(bad)} fields decoded")


def test_award_decodes_epoch_and_by_override():
    t = V.decode_tender(component("ee" * 32, tender_state()))
    assert t["award"]["epoch"] == 25
    assert t["award"]["by_override"] is False


def test_state_enum_rejects_bool():
    # bool is an int subclass, so a True state index would read as
    # index 1 without the explicit check.
    state = tender_state({6: [True, []]})
    try:
        V.decode_tender(component("ee" * 32, state))
    except ValueError:
        return
    raise AssertionError("bool state index decoded")


def test_dispute_resolved_flag_must_be_bool():
    state = tender_state({
        6: [7, []],
        24: [bytes.fromhex("ef" * 32), 30, 33, 1, bytes.fromhex("ab" * 32)],
    })
    try:
        V.decode_tender(component("ee" * 32, state))
    except ValueError:
        return
    raise AssertionError("non-bool resolved flag decoded")


def test_trailing_fields_fail_on_subrecords():
    cases = {
        17: [[bytes.fromhex(IDENT_A), bytes.fromhex(COMMIT_A), 10,
              True, [2, []], 99]],
        18: [[bytes.fromhex(IDENT_A), 2140, 12, 0, True,
              bytes.fromhex(COMMIT_A), 99]],
        21: [[1, bytes.fromhex(IDENT_A), bytes.fromhex("ab" * 32),
              [], True, False, 99]],
        22: [bytes.fromhex(IDENT_A), bytes.fromhex("ab" * 32), 21, 99],
        25: [[bytes.fromhex(APPROVER1), True, bytes.fromhex("ab" * 32), 99]],
        26: [bytes.fromhex(IDENT_A), 1950, 25, 99],
    }
    for field, bad in cases.items():
        state = tender_state({field: bad})
        try:
            V.decode_tender(component("ee" * 32, state))
        except ValueError:
            continue
        raise AssertionError(
            f"field {field} with trailing fields decoded")


def test_indexer_events_rejects_malformed_shapes():
    idx = V.Indexer("https://example.invalid")
    for bad in ({"events": "not a list"}, {"events": 42}, "nope", 42):
        idx._get_json = lambda path, bad=bad: bad
        try:
            idx.events("component_" + "bb" * 32)
        except V.MalformedHistory as exc:
            assert exc.stage == "events"
            continue
        raise AssertionError(f"malformed event list {bad!r} accepted")


def test_indexer_events_empty_object_reads_empty():
    idx = V.Indexer("https://example.invalid")
    idx._get_json = lambda path: {}
    assert idx.events("component_" + "bb" * 32) == []


def test_event_tx_ids_rejects_malformed_entries():
    class BadSource:
        def __init__(self, events):
            self._events = events

        def events(self, substate_id):
            return self._events

    for bad in ([42], [[]], [[""]], [[123, "x"]], [{"nope": 1}],
                [{"transaction_id": ""}], [{"transaction_id": 42}],
                ["tx-1", 42]):
        try:
            V._event_tx_ids(BadSource(bad), TENDER)
        except V.MalformedHistory as exc:
            assert exc.stage == "events"
            continue
        raise AssertionError(f"malformed entry {bad!r} accepted")
    good = V._event_tx_ids(
        BadSource([["tx-1", "payload"], {"transaction_id": "tx-2"}]),
        TENDER)
    assert good == ["tx-1", "tx-2"]


def test_malformed_event_list_fails_the_reveals_check():
    # Bytes arrived for the event list, but they are not a list:
    # the reveals check fails, it must not report could-not-read.
    patched_network()

    class BadEventsSource(FakeSource):
        def events(self, substate_id):
            return {"events": "not a list"}

    base = settled_source()
    source = BadEventsSource(base._substates, base._txs)
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = _reveals_row(rep)
    assert row["ok"] is False, row
    assert "malformed" in row["detail"], row
    assert not rep.unknown, rep.unknown


def test_malformed_transaction_body_fails_the_reveals_check():
    patched_network()

    class BadTxSource(FakeSource):
        def transaction(self, tx_id):
            raise ValueError("Expecting value: line 1 column 1 (char 0)")

    base = settled_source()
    source = BadTxSource(base._substates, base._txs)
    rep = V.verify(TENDER, "esmeralda", source=source)
    row = _reveals_row(rep)
    assert row["ok"] is False, row
    assert "malformed" in row["detail"], row


def test_base64_with_stray_characters_is_invalid():
    idx = V.Indexer("https://example.invalid")
    idx.get = lambda path, timeout=30, base=None: {
        "state": {"up": {"substate": "!!!!not-base64!!!!"}}
    }
    try:
        idx._substate("https://example.invalid",
                      "component_" + "bb" * 32, 30)
    except ValueError:
        return
    raise AssertionError("invalid base64 decoded")


def test_receipt_vault_unreadable_reconciles_null():
    # An escrow vault the indexer would not serve cannot
    # reconcile: the receipt says null, not false.
    patched_network()

    class NoVaultSource(FakeSource):
        def substate(self, substate_id, large=False):
            if substate_id == ESCROW:
                raise V.TransportError("the read operation timed out")
            return super().substate(substate_id, large=large)

    base = settled_source()
    source = NoVaultSource(base._substates, base._txs)
    receipt = V.build_receipt(TENDER, "esmeralda", source=source)
    escrow = receipt["escrow"]
    assert escrow["balance_microtari"] is None
    assert escrow["reconciles"] is None, escrow
    assert escrow["read_status"] == "could-not-read", escrow
    assert receipt["bonds"]["read_status"] == "read"


def test_receipt_vault_invalid_reconciles_null():
    # Bytes arrived for the escrow vault but do not decode to a
    # balance: the receipt names the record invalid, not unreadable.
    patched_network()

    class BadVaultSource(FakeSource):
        def substate(self, substate_id, large=False):
            if substate_id == ESCROW:
                return [1, 2]
            return super().substate(substate_id, large=large)

    base = settled_source()
    source = BadVaultSource(base._substates, base._txs)
    receipt = V.build_receipt(TENDER, "esmeralda", source=source)
    escrow = receipt["escrow"]
    assert escrow["balance_microtari"] is None
    assert escrow["reconciles"] is None, escrow
    assert escrow["read_status"] == "record-invalid", escrow


def test_receipt_malformed_events_fails_reveals():
    patched_network()

    class BadEventsSource(FakeSource):
        def events(self, substate_id):
            return {"events": "not a list"}

    base = settled_source()
    source = BadEventsSource(base._substates, base._txs)
    receipt = V.build_receipt(TENDER, "esmeralda", source=source)
    assert receipt["checks_summary"]["fail"] == 1, receipt["checks_summary"]
    for row in receipt["reveals"]:
        rec = row["recomputation"]
        assert rec["status"] == "failed", row
        assert "not shaped like" in rec["provenance_note"], row
    assert receipt["provenance"]["reveal_transactions"].startswith("failed")


def test_receipt_pruning_note_only_for_esmeralda():
    patched_network()
    esme = V.build_receipt(TENDER, "esmeralda", source=settled_source())
    assert esme["provenance"]["indexer_note"] is not None
    assert "2026-11-20" in esme["provenance"]["indexer_note"]
    assert "esmeralda" in esme["provenance"]["state_and_events"]
    main = V.build_receipt(TENDER, "mainnet", source=settled_source())
    assert main["provenance"]["indexer_note"] is None
    assert "mainnet" in main["provenance"]["state_and_events"]
    assert "esmeralda" not in main["provenance"]["state_and_events"]


def test_receipt_record_error_kind():
    # A root fetch that fails in transit is not evidence the
    # record is invalid; bytes that arrive but do not decode are.
    patched_network()

    class NoTenderSource(FakeSource):
        def substate(self, substate_id, large=False):
            if substate_id == TENDER:
                raise V.TransportError("the read operation timed out")
            return super().substate(substate_id, large=large)

    base = settled_source()
    receipt = V.build_receipt(TENDER, "esmeralda",
                              source=NoTenderSource(base._substates, base._txs))
    assert receipt["record"] is None
    assert receipt["record_error_kind"] == "could-not-read", receipt

    class BadTenderSource(FakeSource):
        def substate(self, substate_id, large=False):
            if substate_id == TENDER:
                return [1, 2]
            return super().substate(substate_id, large=large)

    receipt = V.build_receipt(TENDER, "esmeralda",
                              source=BadTenderSource(base._substates, base._txs))
    assert receipt["record"] is None
    assert receipt["record_error_kind"] == "record-invalid", receipt


if __name__ == "__main__":
    tests = [(name, fn) for name, fn in sorted(globals().items())
             if name.startswith("test_") and callable(fn)]
    failures = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except Exception as exc:
            failures += 1
            print(f"FAIL {name}: {exc}")
    sys.exit(1 if failures else 0)
