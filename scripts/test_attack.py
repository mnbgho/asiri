#!/usr/bin/env python3
"""Unit tests for the attack harness's refusal checks.

These run with the standard library only, against stubbed
daemon and indexer reads: no live run, no real tender, no
real funds. Run with: python3 -m unittest test_attack -v
from this directory.
"""

import argparse
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import attack


class ReasonMatchTests(unittest.TestCase):
    def test_exact_wording_matches(self):
        self.assertTrue(attack.rejection_reason_matches(
            "seller has already committed in this tender",
            "seller has already committed in this tender"))

    def test_wrapped_wording_matches(self):
        self.assertTrue(attack.rejection_reason_matches(
            "transaction failed: seller has already committed "
            "in this tender",
            "seller has already committed in this tender"))

    def test_case_does_not_matter(self):
        self.assertTrue(attack.rejection_reason_matches(
            "ACCESS DENIED: call component method 'release_refund'",
            "Access Denied"))

    def test_wrong_reason_does_not_match(self):
        self.assertFalse(attack.rejection_reason_matches(
            "transaction failed: the bid window has closed",
            "seller has already committed in this tender"))

    def test_missing_reason_does_not_match(self):
        self.assertFalse(attack.rejection_reason_matches(
            None, "seller has already committed in this tender"))
        self.assertFalse(attack.rejection_reason_matches(
            "", "seller has already committed in this tender"))

    def test_no_expected_wording_means_no_check(self):
        self.assertTrue(attack.rejection_reason_matches(
            "anything at all", None))
        self.assertTrue(attack.rejection_reason_matches(None, None))


def _args():
    return argparse.Namespace(
        tender="component_" + "aa" * 32,
        circle="component_" + "bb" * 32,
        cookie="/nonexistent/.cookie",
        network="mainnet",
        daemon="http://127.0.0.1:5100/json_rpc",
        operator="operator", second="second",
        seller1="seller1", seller2="seller2", seller3="seller3",
        price1=15_000_000, price2=17_500_000, price3=12_000_000,
        report=None)


def _accounts():
    out = {}
    for i, name in enumerate(
            ["operator", "second", "seller1", "seller2", "seller3"]):
        out[name] = {
            "component": "component_" + ("%02x" % (0xC0 + i)) * 32,
            "public_key": ("%02x" % (0xD0 + i)) * 32,
        }
    return out


def _tender(circle):
    return {
        "state": "Draft",
        "circle": circle,
        "rules": {"budget_cap": 20_000_000, "bond_amount": 2_000_000},
    }


class RunReasonTests(unittest.TestCase):
    """Drive run() with stubbed reads through one attack step."""

    def setUp(self):
        self._real_sleep = attack.time.sleep
        attack.time.sleep = lambda s: None

    def tearDown(self):
        attack.time.sleep = self._real_sleep

    def _run_one_step(self, reason_text):
        run = attack.AttackRun(_args())
        accounts = _accounts()
        run.daemon.accounts = lambda: accounts
        run.read_tender = lambda: _tender(_args().circle)
        run.epoch = lambda: 100
        calls = {"n": 0}

        def submit(instructions, fee_account, max_fee=2_000_000):
            calls["n"] += 1
            if calls["n"] <= 4:
                # lock, then the three honest commits.
                return True, {"result": {"result": {"Accept": {}}}}, "tx-ok"
            return False, {"result": {"result": {
                "Reject": f"transaction failed: {reason_text}"}}}, "tx-attack"

        run.daemon.submit = submit
        run.steps = lambda a, rules: [(
            "duplicate commitment: the same seller commits "
            "the same hash a second time",
            lambda r, ts: [],
            "seller1",
            lambda info, now: True,
            "reject", "attack", False, False)]
        return run.run(), run

    def test_wrong_reason_is_a_finding_and_stops_the_run(self):
        code, run = self._run_one_step("the bid window has closed")
        self.assertEqual(code, 1)
        self.assertEqual(len(run.results), 1)
        entry = run.results[0]
        self.assertTrue(entry["finding"])
        self.assertEqual(
            entry["reason_expected"],
            "seller has already committed in this tender")

    def test_right_reason_passes_the_step(self):
        code, run = self._run_one_step(
            "seller has already committed in this tender")
        self.assertEqual(code, 0)
        self.assertEqual(len(run.results), 1)
        entry = run.results[0]
        self.assertFalse(entry["finding"])
        self.assertEqual(entry["got"], "reject")


if __name__ == "__main__":
    unittest.main()
