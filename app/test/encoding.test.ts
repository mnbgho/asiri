// Byte-for-byte checks of the argument encoders against values
// produced by the pinned Rust crates, and round-trip checks of
// the info decoders against the same fixtures.
import { describe, expect, it } from "vitest";
import { arg } from "../src/args";
import { decode, hexToBytes } from "../src/cbor";
import { decodeCircleInfo, decodeAward, decodeRules, decodeTenderInfo } from "../src/model";
import { FIXTURES, K1, K2, K3, COMP } from "./fixtures";

const lit = (a: unknown) => (a as { Literal: string }).Literal;

const RULES = {
  specificationHash: "07".repeat(32),
  budgetCap: 10000n,
  bondAmount: 100n,
  bidWindowEpochs: 5,
  revealWindowEpochs: 5,
  overrideWindowEpochs: 3,
  deliveryWindowEpochs: 5,
  claimGraceEpochs: 3,
  disputeWindowEpochs: 4,
  approvalThreshold: 2,
  disputeThreshold: 3,
};

describe("argument encodings match tari_bor", () => {
  it("encodes the rules struct", () => {
    expect(lit(arg.rules(RULES))).toBe(FIXTURES.rules);
  });
  it("encodes key vectors and options", () => {
    expect(lit(arg.pubkeys([K1, K2]))).toBe(FIXTURES.keys_vec);
    expect(lit(arg.optPubkey(null))).toBe(FIXTURES.opt_key_none);
    expect(lit(arg.optPubkey(K3))).toBe(FIXTURES.opt_key_some);
  });
  it("encodes addresses with their tags", () => {
    expect(lit(arg.component("component_" + COMP))).toBe(FIXTURES.component);
    expect(lit(arg.components(["component_" + COMP]))).toBe(
      FIXTURES.components_vec,
    );
    expect(lit(arg.resource("resource_" + "01".repeat(32)))).toBe(
      FIXTURES.resource_addr,
    );
    expect(lit(arg.optComponent(null))).toBe(FIXTURES.opt_comp_none);
    expect(lit(arg.optComponent("component_" + COMP))).toBe(
      FIXTURES.opt_comp_some,
    );
  });
  it("encodes template addresses as bare hashes", () => {
    expect(lit(arg.optTemplate(null))).toBe(FIXTURES.opt_template_none);
    expect(lit(arg.optTemplate("template_" + "22".repeat(32)))).toBe(
      FIXTURES.opt_template_some,
    );
  });
  it("encodes scalars", () => {
    expect(lit(arg.hash("05".repeat(32)))).toBe(FIXTURES.hash32);
    expect(lit(arg.amount(0n))).toBe(FIXTURES.amount_0);
    expect(lit(arg.amount(10000n))).toBe(FIXTURES.amount_10000);
    expect(lit(arg.amount(1n << 70n))).toBe(FIXTURES.amount_big);
    expect(lit(arg.bool(true))).toBe(FIXTURES.bool_true);
    expect(lit(arg.bool(false))).toBe(FIXTURES.bool_false);
    expect(lit(arg.uint(2))).toBe(FIXTURES.u32_2);
    expect(lit(arg.uint(5))).toBe(FIXTURES.u64_5);
    expect(lit(arg.text("Uyo Shopkeepers Circle"))).toBe(FIXTURES.string);
  });
  it("encodes a salt as an array of numbers, not bytes", () => {
    const salt = new Uint8Array(32).map((_, i) => i);
    expect(lit(arg.byteVec(salt))).toBe(FIXTURES.salt_vec_u8);
  });
});

describe("info decoders read tari_bor values", () => {
  it("decodes the rules fixture", () => {
    const rules = decodeRules(decode(hexToBytes(FIXTURES.rules)));
    expect(rules).toEqual(RULES);
  });
  it("decodes a draft tender info (22 items, receipt omitted)", () => {
    const info = decodeTenderInfo(decode(hexToBytes(FIXTURES.tender_info_draft)));
    expect(info.circle).toBe("component_" + COMP);
    expect(info.circleName).toBe("Uyo Shopkeepers Circle");
    expect(info.bound).toBe(true);
    expect(info.state).toBe("Draft");
    expect(info.rules).toEqual(RULES);
    expect(info.rulesHash).toBe("08".repeat(32));
    expect(info.approvers).toEqual([K1, K2, K3]);
    expect(info.lockEpoch).toBeNull();
    expect(info.commitmentsCount).toBe(0);
    expect(info.revealsCount).toBe(0);
    expect(info.award).toBeNull();
    expect(info.receiptIssued).toBe(false);
  });
  it("decodes a marked tender info (23 items, receipt present)", () => {
    const info = decodeTenderInfo(decode(hexToBytes(FIXTURES.tender_info_marked)));
    expect(info.state).toBe("Open");
    expect(info.bound).toBe(false);
    expect(info.rulesHash).toBeNull();
    expect(info.approvers).toEqual([]);
    expect(info.lockEpoch).toBe(11);
    expect(info.commitmentsCount).toBe(3);
    expect(info.revealsCount).toBe(2);
    expect(info.receiptResource).toBe("resource_" + "01".repeat(32));
    expect(info.forfeitForCircle).toBe(111n);
    expect(info.forfeitLocked).toBe(222n);
    expect(info.receiptIssued).toBe(true);
  });
  it("decodes a seven-field award record", () => {
    // The on-chain award carries the epoch it was computed at and
    // whether an executed override put it in place, behind the
    // five fields the checks use. Values from the recorded
    // Esmeralda dispute tender.
    const award = decodeAward([
      hexToBytes("ca".repeat(32)),
      hexToBytes("58".repeat(32)),
      15_000_000n,
      2n,
      2n,
      13161n,
      false,
    ]);
    expect(award.winningPrice).toBe(15_000_000n);
    expect(award.commitmentsCount).toBe(2);
    expect(award.revealsCount).toBe(2);
    expect(award.epoch).toBe(13161);
    expect(award.byOverride).toBe(false);
  });

  it("rejects a five-field award record", () => {
    expect(() =>
      decodeAward([
        hexToBytes("ca".repeat(32)),
        hexToBytes("58".repeat(32)),
        15_000_000n,
        2n,
        2n,
      ]),
    ).toThrow("Award has 5 fields");
  });

  it("decodes a circle info", () => {
    const info = decodeCircleInfo(decode(hexToBytes(FIXTURES.circle_info)));
    expect(info.name).toBe("Uyo Shopkeepers Circle");
    expect(info.approvers).toEqual([K1, K2]);
    expect(info.threshold).toBe(2);
    expect(info.auditor).toBeNull();
    expect(info.tenders).toEqual(["component_" + COMP]);
    expect(info.treasuryBalance).toBe(10000n);
  });
});

describe("decoder bounds", () => {
  it("rejects a truncated byte string instead of shortening it", () => {
    expect(() => decode(new Uint8Array([0x43, 0xaa]))).toThrow("truncated");
  });
  it("rejects a truncated array instead of inventing items", () => {
    expect(() => decode(new Uint8Array([0x82, 0x01]))).toThrow("truncated");
  });
  it("rejects a truncated length prefix", () => {
    expect(() => decode(new Uint8Array([0x1a, 0x00]))).toThrow("truncated");
  });
});
