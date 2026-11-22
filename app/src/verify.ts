// The verifier, running in the browser against indexer data.
// The same checks as the standalone script (scripts/verify.py):
// a judge with no wallet can confirm a tender's whole record.
import { bytesToHex, decode, hexToBytes } from "./cbor";
import { commitmentHash, rulesHash, sha256 } from "./hash";
import type { Indexer } from "./indexer";
import {
  decodeTenderState,
  decodeVaultBalance,
  extractWasm,
  splitComponent,
  type TenderComponentState,
} from "./state";

export interface CheckRow {
  check: string;
  // True, false, or null. Null means the check could not be
  // determined because the evidence it reads could not be read
  // from any source. That is not a pass and not a failure, and
  // it must never be silently folded into either. The standalone
  // script (scripts/verify.py) uses the same three states.
  ok: boolean | null;
  detail: string;
}

export class Report {
  rows: CheckRow[] = [];
  add(check: string, ok: boolean | null, detail: string): void {
    this.rows.push({ check, ok, detail });
  }
  get failed(): CheckRow[] {
    return this.rows.filter((r) => r.ok === false);
  }
  get unknown(): CheckRow[] {
    return this.rows.filter((r) => r.ok === null);
  }
}

interface RevealArgs {
  price: bigint;
  salt: Uint8Array;
  identity: string;
}

function findInstructions(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    node.forEach((n) => findInstructions(n, out));
  } else if (node && typeof node === "object") {
    const rec = node as Record<string, unknown>;
    if ("CallMethod" in rec || "CallFunction" in rec) out.push(rec);
    Object.values(rec).forEach((v) => findInstructions(v, out));
  }
}

function literalValue(arg: unknown): unknown {
  const lit = (arg as { Literal?: string })?.Literal;
  if (typeof lit !== "string") return undefined;
  try {
    return decode(hexToBytes(lit));
  } catch {
    return undefined;
  }
}

async function findRevealArgs(
  indexer: Indexer,
  tenderAddress: string,
): Promise<{ found: Map<string, RevealArgs>; unreadable: number; total: number }> {
  // Mirrors find_reveal_args in scripts/verify.py, including the
  // accounting: a reveal whose transaction could not be read is
  // not a reveal that does not exist, and the caller must not
  // report it as one.
  const out = new Map<string, RevealArgs>();
  const events = await indexer.events(tenderAddress);
  const txIds = new Set<string>();
  for (const ev of events) {
    if (ev.txId) txIds.add(ev.txId);
  }
  let unreadable = 0;
  for (const id of txIds) {
    let body: unknown;
    try {
      body = await indexer.transaction(id);
    } catch {
      unreadable++;
      continue;
    }
    const instructions: Record<string, unknown>[] = [];
    findInstructions(body, instructions);
    for (const instr of instructions) {
      const call = instr.CallMethod as
        | { call?: { Address?: string }; method?: string; args?: unknown[] }
        | undefined;
      if (!call || call.method !== "reveal_bid") continue;
      if (call.call?.Address !== tenderAddress) continue;
      const args = call.args ?? [];
      if (args.length !== 3) continue;
      const price = literalValue(args[0]);
      const saltRaw = literalValue(args[1]);
      const identityRaw = literalValue(args[2]);
      if (typeof price !== "bigint") continue;
      if (!(identityRaw instanceof Uint8Array)) continue;
      let salt: Uint8Array | null = null;
      if (Array.isArray(saltRaw) && saltRaw.length === 32)
        salt = new Uint8Array(saltRaw.map((x) => Number(x)));
      else if (saltRaw instanceof Uint8Array && saltRaw.length === 32)
        salt = saltRaw;
      if (!salt) continue;
      const identity = bytesToHex(identityRaw);
      const digest = await commitmentHash(price, salt, identity);
      out.set(digest, { price, salt, identity });
    }
  }
  return { found: out, unreadable, total: txIds.size };
}

export async function verifyTender(
  indexer: Indexer,
  tenderAddress: string,
  opts: { rationaleText?: string; templateDigest?: string | null } = {},
): Promise<{ report: Report; tender: TenderComponentState | null }> {
  const rep = new Report();
  const cfg = indexer.cfg;
  const sub = await indexer.substate(tenderAddress);
  if (!sub) {
    rep.add("tender exists", false, "the tender substate is down");
    return { report: rep, tender: null };
  }
  // Name the common mistake plainly, as the standalone script
  // does: a circle address handed to the verifier used to
  // surface as a decoder complaint about field counts.
  if (cfg.tenderTemplate) {
    let actual: string | null = null;
    try {
      actual = splitComponent(sub.value).template;
    } catch {
      actual = null;
    }
    if (actual && actual !== cfg.tenderTemplate) {
      rep.add(
        "tender exists",
        false,
        "that component does not run the tender template. check the address: it belongs to a different kind of component.",
      );
      return { report: rep, tender: null };
    }
  }
  const tender = decodeTenderState(sub.value);
  rep.add(
    "tender exists",
    true,
    `state ${tender.state}, circle ${tender.circle}`,
  );

  // template binding and code
  if (cfg.tenderTemplate) {
    rep.add(
      "template binding",
      tender.template === cfg.tenderTemplate,
      `component runs ${tender.template}`,
    );
    if (opts.templateDigest !== undefined) {
      // The caller already read the template's code once for a
      // whole run of tenders (the circle record export does, so
      // one export reads the large template substate once, not
      // once per tender). The check itself is unchanged: the
      // same comparison against the recorded hash. A null
      // digest means that one read could not be completed, so
      // the check honestly could not be run.
      if (opts.templateDigest === null) {
        rep.add(
          "template code hash",
          null,
          "the template's code could not be read from any indexer, so this check could not be run",
        );
      } else {
        rep.add(
          "template code hash",
          cfg.tenderCodeHash === null || opts.templateDigest === cfg.tenderCodeHash,
          `sha256 of the on-chain code is ${opts.templateDigest}`,
        );
      }
    } else {
      try {
        const troot = await indexer.substate(cfg.tenderTemplate, { large: true });
        if (!troot) throw new Error("template substate is down");
        const digest = bytesToHex(await sha256(extractWasm(troot.value)));
        rep.add(
          "template code hash",
          cfg.tenderCodeHash === null || digest === cfg.tenderCodeHash,
          `sha256 of the on-chain code is ${digest}`,
        );
      } catch (e) {
        rep.add("template code hash", false, e instanceof Error ? e.message : String(e));
      }
    }
  } else {
    rep.add(
      "template binding",
      false,
      `no published template recorded for ${cfg.label} in this app yet`,
    );
  }

  // rules hash
  if (tender.rulesHash !== null) {
    const digest = await rulesHash(tender.rules);
    rep.add("rules hash", digest === tender.rulesHash, `recomputed ${digest}`);
  } else {
    rep.add("rules hash", tender.state === "Draft", "no rules hash yet (tender not locked)");
  }

  // escrow funding
  try {
    const escrowSub = await indexer.substate(tender.escrowVault);
    if (!escrowSub) throw new Error("escrow vault is down");
    const escrow = decodeVaultBalance(escrowSub.value);
    let accounted = escrow;
    if (tender.payoutClaimed && tender.settlement)
      accounted += tender.settlement.price;
    if (tender.refundClaimed && tender.refundAmount)
      accounted += tender.refundAmount;
    rep.add(
      "escrow funding",
      accounted === tender.rules.budgetCap,
      `escrow ${escrow} + paid out ${accounted - escrow} of cap ${tender.rules.budgetCap}`,
    );
  } catch (e) {
    rep.add("escrow funding", false, e instanceof Error ? e.message : String(e));
  }

  // reveals
  const commitmentHashes = tender.commitments.map((c) => c.commitment);
  const commitmentSellers = tender.commitments.map((c) => c.seller);
  const flaggedRevealed = new Set(
    tender.commitments.filter((c) => c.revealed).map((c) => c.commitment),
  );
  const recordedReveals = new Set(tender.reveals.map((r) => r.commitment));
  const consistent =
    new Set(commitmentHashes).size === commitmentHashes.length &&
    new Set(commitmentSellers).size === commitmentSellers.length &&
    flaggedRevealed.size === recordedReveals.size &&
    [...flaggedRevealed].every((h) => recordedReveals.has(h));
  rep.add(
    "record counts",
    tender.commitments.length >= tender.reveals.length && consistent,
    `${tender.commitments.length} commitments, ${tender.reveals.length} reveals` +
      (consistent ? "" : "; commitment records are inconsistent"),
  );
  if (tender.reveals.length > 0) {
    const { found, unreadable, total } = await findRevealArgs(indexer, tenderAddress);
    const commitments = new Map(tender.commitments.map((c) => [c.commitment, c]));
    const failures: string[] = [];
    const couldNotRead: string[] = [];
    const digests = tender.reveals.map((r) => r.commitment);
    if (new Set(digests).size !== digests.length) {
      failures.push("duplicate reveals for one commitment");
    }
    const counters = tender.reveals.map((r) => r.counter);
    if (new Set(counters).size !== counters.length) {
      failures.push("duplicate reveal counters");
    }
    for (const record of tender.reveals) {
      const entry = found.get(record.commitment);
      if (!entry) {
        // A missing reveal is a finding only when the transaction
        // hunt actually read the history. When some of it could
        // not be read from any indexer, or none of it could, the
        // honest verdict is that this reveal could not be checked,
        // not that its transaction does not exist.
        if (unreadable > 0 || total === 0) {
          couldNotRead.push(record.commitment);
        } else {
          failures.push(`no reveal transaction found for ${record.commitment.slice(0, 12)}`);
        }
        continue;
      }
      if (entry.price !== record.price) {
        failures.push(`price mismatch for ${record.commitment.slice(0, 12)}`);
      }
      const commitment = commitments.get(record.commitment);
      if (!commitment) {
        failures.push(`reveal without commitment ${record.commitment.slice(0, 12)}`);
      } else if (commitment.seller !== record.seller) {
        failures.push(
          `reveal seller differs from the commitment seller for ${record.commitment.slice(0, 12)}`,
        );
      }
    }
    const totalReveals = tender.reveals.length;
    if (failures.length) {
      let detail = failures.join("; ");
      if (couldNotRead.length) {
        detail += `; ${couldNotRead.length} more could not be checked, their transactions could not be read from any indexer`;
      }
      rep.add("reveals verify against commitments", false, detail);
    } else if (couldNotRead.length) {
      rep.add(
        "reveals verify against commitments",
        null,
        `${couldNotRead.length} of ${totalReveals} reveals could not be recomputed: their transactions could not be read from any indexer today` +
          (couldNotRead.length < totalReveals
            ? `. the other ${totalReveals - couldNotRead.length} recompute to their commitments`
            : ""),
      );
    } else {
      rep.add(
        "reveals verify against commitments",
        true,
        `all ${totalReveals} reveals recompute to their commitments`,
      );
    }
  } else {
    rep.add(
      "reveals verify against commitments",
      ["Draft", "Open", "Expired"].includes(tender.state),
      "no reveals recorded yet",
    );
  }

  // award or override
  const award = tender.award;
  const override = tender.overrideRecord;
  if (override) {
    const executed = tender.overrideProposals.filter(
      (p) =>
        p.executed &&
        !p.isVoid &&
        p.chosen === override.chosen &&
        p.rationaleHash === override.rationaleHash,
    );
    let ok = executed.length > 0;
    let detail = "no executed override proposal matches the record";
    if (executed.length) {
      const p = executed[executed.length - 1];
      const signers = new Set(p.signers);
      const approvers = new Set(tender.approvers);
      const threshold = tender.rules.approvalThreshold;
      ok =
        signers.size >= threshold &&
        [...signers].every((s) => approvers.has(s)) &&
        p.rationaleHash !== "00".repeat(32);
      detail = `proposal ${p.id} signed by ${signers.size} approvers, threshold ${threshold}`;
      if (award) {
        ok = ok && award.winner === override.chosen;
        detail += ", award follows the override choice";
      }
    }
    rep.add("override threshold and rationale hash", ok, detail);
    const chosen = tender.reveals.filter((r) => r.seller === override.chosen);
    let choiceOk =
      chosen.length === 1 &&
      chosen[0].valid &&
      chosen[0].price <= tender.rules.budgetCap;
    let choiceDetail = "the chosen seller never revealed a bid";
    if (chosen.length) {
      choiceDetail = `chose the bid revealed at ${chosen[0].price}`;
      if (award) {
        choiceOk =
          choiceOk &&
          award.winner === chosen[0].seller &&
          award.winningPrice === chosen[0].price;
        choiceDetail += ", award matches the chosen bid";
      }
    }
    rep.add("override choice is a valid revealed bid", choiceOk, choiceDetail);
    if (award) {
      rep.add(
        "award counts",
        award.commitmentsCount === tender.commitments.length &&
          award.revealsCount === tender.reveals.length,
        `award records ${award.commitmentsCount} commitments and ${award.revealsCount} reveals`,
      );
    }
    if (opts.rationaleText !== undefined) {
      const digest = bytesToHex(
        await sha256(new TextEncoder().encode(opts.rationaleText)),
      );
      rep.add(
        "override rationale text",
        digest === override.rationaleHash,
        `published text hashes to ${digest}`,
      );
    } else {
      rep.add(
        "override rationale text",
        false,
        "unverifiable: the rationale text was never published with this run (paste it above)",
      );
    }
  } else if (award) {
    // Validity is recomputed from the locked cap, not taken
    // from the record's own flag alone.
    const valid = tender.reveals.filter(
      (r) => r.valid && r.price <= tender.rules.budgetCap,
    );
    const flagsOk = tender.reveals.every(
      (r) => r.valid === (r.price <= tender.rules.budgetCap),
    );
    if (valid.length) {
      const best = valid.reduce((a, b) =>
        b.price < a.price || (b.price === a.price && b.counter < a.counter) ? b : a,
      );
      rep.add(
        "award is the lowest valid revealed price",
        flagsOk &&
          award.winningPrice === best.price &&
          award.winningCommitment === best.commitment &&
          award.winner === best.seller,
        `award ${award.winningPrice}, best valid reveal ${best.price} at counter ${best.counter}`,
      );
    } else {
      rep.add(
        "award is the lowest valid revealed price",
        false,
        "an award exists but no valid reveal does",
      );
    }
    rep.add(
      "award counts",
      award.commitmentsCount === tender.commitments.length &&
        award.revealsCount === tender.reveals.length,
      `award records ${award.commitmentsCount} commitments and ${award.revealsCount} reveals`,
    );
  } else {
    rep.add(
      "award",
      ["Draft", "Open", "Reveal", "Expired"].includes(tender.state),
      "no award yet",
    );
  }

  // settlement
  const settled = tender.settlement;
  if (settled) {
    let ok = award !== null && settled.price === award.winningPrice;
    let detail = `settled ${settled.price} at epoch ${settled.epoch}`;
    if (award !== null) {
      const winnerMatches = settled.winner === award.winner;
      ok = ok && winnerMatches;
      detail += winnerMatches
        ? ", winner matches the award"
        : ", winner does not match the award";
    }
    rep.add("settlement equals the award", ok, detail);
    // Settlement is promised only after delivery confirmation at
    // the approval threshold, or after a dispute the circle
    // resolved for the winner at the dispute threshold.
    const approvers = new Set(tender.approvers);
    const signers = new Set(tender.deliverySigners);
    const delivered =
      signers.size >= tender.rules.approvalThreshold &&
      [...signers].every((s) => approvers.has(s));
    let resolved = false;
    if (tender.dispute?.resolvedForWinner) {
      const votes = new Set(
        tender.disputeVotes
          .filter(
            (v) =>
              v.payWinner &&
              v.rationaleHash === tender.dispute?.rationaleHash &&
              approvers.has(v.signer),
          )
          .map((v) => v.signer),
      );
      resolved = votes.size >= tender.rules.disputeThreshold;
    }
    rep.add(
      "delivery confirmed or dispute resolved",
      delivered || resolved,
      `${signers.size} delivery confirmations, threshold ${tender.rules.approvalThreshold}` +
        (resolved && !delivered
          ? ", settled through a dispute resolved for the winner"
          : ""),
    );
  } else if (tender.state === "Settled") {
    rep.add(
      "settlement equals the award",
      false,
      "state is Settled but no settlement record exists",
    );
  }

  // bonds
  try {
    const bondsSub = await indexer.substate(tender.bondsVault);
    if (!bondsSub) throw new Error("bonds vault is down");
    const balance = decodeVaultBalance(bondsSub.value);
    const bond = tender.rules.bondAmount;
    const held = tender.commitments
      .filter((c) => c.bond === "Held")
      .reduce((n) => n + bond, 0n);
    const returnable = tender.commitments
      .filter((c) => c.bond === "Returnable")
      .reduce((n) => n + bond, 0n);
    let expected = held + returnable + tender.forfeitLocked;
    if (!tender.forfeitsClaimedByCircle) expected += tender.forfeitForCircle;
    rep.add(
      "bond vault reconciles",
      balance === expected,
      `vault ${balance}, expected ${expected} from held ${held}, returnable ${returnable}, locked ${tender.forfeitLocked}`,
    );
    const forfeited = tender.commitments.filter((c) => c.bond === "Forfeited").length;
    // The template splits each forfeited bond with the locked
    // half rounded down and the circle keeping the rest.
    const lockedEach = bond / 2n;
    const circleEach = bond - lockedEach;
    rep.add(
      "forfeit split recorded",
      tender.forfeitLocked === BigInt(forfeited) * lockedEach &&
        tender.forfeitForCircle === BigInt(forfeited) * circleEach,
      `${forfeited} forfeited bonds, locked ${tender.forfeitLocked}, for the circle ${tender.forfeitForCircle}`,
    );
  } catch (e) {
    rep.add("bond vault reconciles", false, e instanceof Error ? e.message : String(e));
  }

  return { report: rep, tender };
}
