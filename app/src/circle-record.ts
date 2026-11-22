// The circle record export: one file holding a circle's full
// record, shaped here from values the circle screen read live
// from the indexer at the moment of the export. Nothing in the
// record is invented: a tender whose state could not be read is
// carried as an unreadable entry with the reason, and a tender
// whose verification could not be computed says so, rather than
// either being silently dropped. Amounts are microtari numbers
// where they fit a safe integer, strings beyond that, so no
// figure is ever rounded by the file format.
import type { CircleComponentState, TenderComponentState } from "./state";
import type { Report } from "./verify";

export interface TenderVerificationSummary {
  status: "checked" | "could not be checked";
  pass: number;
  fail: number;
  couldNotRead: number;
  failedChecks: string[];
  unreadableChecks: string[];
  // Set when the verification itself could not run: the plain
  // reason, in the same words the app would show a visitor.
  note: string | null;
}

export type CircleRecordTender =
  | {
      address: string;
      read: "ok";
      state: unknown;
      verification: TenderVerificationSummary;
    }
  | {
      address: string;
      read: "unreadable";
      // Why the state could not be read, in plain words.
      note: string;
      verification: TenderVerificationSummary;
    };

export interface CircleRecordInput {
  networkLabel: string;
  circleAddress: string;
  circle: CircleComponentState;
  // Null when the treasury vault's balance could not be read:
  // the record says so rather than carrying a stale figure.
  treasuryBalance: bigint | null;
  tenders: CircleRecordTender[];
}

/** Summarize a verifier report for the record: counts, and the
 * names of the checks that failed or could not be read, so the
 * summary can be checked against the verify screen's own rows. */
export function summarizeReport(report: Report): TenderVerificationSummary {
  return {
    status: "checked",
    pass: report.rows.filter((r) => r.ok === true).length,
    fail: report.failed.length,
    couldNotRead: report.unknown.length,
    failedChecks: report.failed.map((r) => r.check),
    unreadableChecks: report.unknown.map((r) => r.check),
    note: null,
  };
}

export function uncheckedVerification(note: string): TenderVerificationSummary {
  return {
    status: "could not be checked",
    pass: 0,
    fail: 0,
    couldNotRead: 0,
    failedChecks: [],
    unreadableChecks: [],
    note,
  };
}

function amount(v: bigint): number | string {
  return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= -BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(v)
    : v.toString();
}

/** The tender's decoded state, serialized for the record with
 * amounts as microtari numbers and epochs as recorded. */
export function tenderStateRecord(t: TenderComponentState): Record<string, unknown> {
  return {
    template: t.template,
    circle: t.circle,
    circle_name: t.circleName,
    bound: t.bound,
    approvers: t.approvers,
    rules: {
      specification_hash: t.rules.specificationHash,
      budget_cap_microtari: amount(t.rules.budgetCap),
      bond_amount_microtari: amount(t.rules.bondAmount),
      bid_window_epochs: t.rules.bidWindowEpochs,
      reveal_window_epochs: t.rules.revealWindowEpochs,
      override_window_epochs: t.rules.overrideWindowEpochs,
      delivery_window_epochs: t.rules.deliveryWindowEpochs,
      claim_grace_epochs: t.rules.claimGraceEpochs,
      dispute_window_epochs: t.rules.disputeWindowEpochs,
      approval_threshold: t.rules.approvalThreshold,
      dispute_threshold: t.rules.disputeThreshold,
    },
    rules_hash: t.rulesHash,
    state: t.state,
    escrow_vault: t.escrowVault,
    bonds_vault: t.bondsVault,
    receipt_resource: t.receiptResource,
    epochs: {
      lock: t.lockEpoch,
      bid_deadline: t.bidDeadline,
      reveal_deadline: t.revealDeadline,
      override_deadline: t.overrideDeadline,
      delivery_start: t.deliveryStart,
      delivery_deadline: t.deliveryDeadline,
      claim_deadline: t.claimDeadline,
    },
    commitments: t.commitments.map((c) => ({
      seller: c.seller,
      commitment: c.commitment,
      epoch: c.epoch,
      revealed: c.revealed,
      bond: c.bond,
    })),
    reveals: t.reveals.map((r) => ({
      seller: r.seller,
      price_microtari: amount(r.price),
      epoch: r.epoch,
      counter: r.counter,
      valid: r.valid,
      commitment: r.commitment,
    })),
    award: t.award
      ? {
          winner: t.award.winner,
          winning_commitment: t.award.winningCommitment,
          winning_price_microtari: amount(t.award.winningPrice),
          commitments_count: t.award.commitmentsCount,
          reveals_count: t.award.revealsCount,
        }
      : null,
    override_proposals: t.overrideProposals.map((p) => ({
      id: p.id,
      chosen: p.chosen,
      rationale_hash: p.rationaleHash,
      signers: p.signers,
      executed: p.executed,
      void: p.isVoid,
    })),
    override_record: t.overrideRecord
      ? {
          chosen: t.overrideRecord.chosen,
          rationale_hash: t.overrideRecord.rationaleHash,
          epoch: t.overrideRecord.epoch,
        }
      : null,
    delivery_signers: t.deliverySigners,
    dispute: t.dispute
      ? {
          evidence_hash: t.dispute.evidenceHash,
          epoch: t.dispute.epoch,
          deadline: t.dispute.deadline,
          resolved_for_winner: t.dispute.resolvedForWinner,
          rationale_hash: t.dispute.rationaleHash,
        }
      : null,
    dispute_votes: t.disputeVotes.map((v) => ({
      signer: v.signer,
      pay_winner: v.payWinner,
      rationale_hash: v.rationaleHash,
    })),
    settlement: t.settlement
      ? {
          winner: t.settlement.winner,
          price_microtari: amount(t.settlement.price),
          epoch: t.settlement.epoch,
        }
      : null,
    refund_amount_microtari: t.refundAmount === null ? null : amount(t.refundAmount),
    refund_claimed: t.refundClaimed,
    payout_claimed: t.payoutClaimed,
    forfeit_for_circle_microtari: amount(t.forfeitForCircle),
    forfeit_locked_microtari: amount(t.forfeitLocked),
    forfeits_claimed_by_circle: t.forfeitsClaimedByCircle,
    receipt_issued: t.receiptIssued,
    approver_changes: t.approverChanges.map((p) => ({
      id: p.id,
      new_approvers: p.newApprovers,
      signers: p.signers,
      executed: p.executed,
      void: p.isVoid,
    })),
  };
}

/** Shape the whole record. Pure: the screen gathers, this
 * shapes, so the shape is pinned by tests against fixtures. */
export function buildCircleRecord(input: CircleRecordInput): Record<string, unknown> {
  const c = input.circle;
  const unreadable = input.tenders.filter((t) => t.read === "unreadable").length;
  const unchecked = input.tenders.filter(
    (t) => t.verification.status === "could not be checked",
  ).length;
  const notes: string[] = [
    "every value in this record was read from the public indexer at export time and decoded from the component states. nothing was taken from the circle's or a tender's own claims about itself.",
  ];
  if (input.treasuryBalance === null)
    notes.push("the treasury balance could not be read at export time, and is recorded as unreadable rather than as a figure.");
  if (unreadable)
    notes.push(
      `${unreadable} of this circle's tenders could not be read at export time. each is carried below as an unreadable entry with the reason, not dropped.`,
    );
  if (unchecked)
    notes.push(
      `${unchecked} of this circle's tenders carry no verification summary, because the checks could not be computed at export time. the reason stands with each tender.`,
    );
  notes.push(
    "a verification summary counts the same checks the verify screen runs. a check that could not be read is counted as could not be read: it is not a pass and not a failure, and it is never folded into either.",
  );
  return {
    record_version: "asiri-circle-record-1",
    network: input.networkLabel,
    exported_from:
      "the asiri app, from live reads of the public indexer. this file is a record of what the chain held at export time, not a claim by the circle.",
    circle: {
      address: input.circleAddress,
      name: c.name,
      template: c.template,
      members: c.members,
      approvers: c.approvers,
      threshold: c.threshold,
      auditor: c.auditor,
      treasury_vault: c.treasuryVault,
      treasury_balance_microtari:
        input.treasuryBalance === null ? null : amount(input.treasuryBalance),
      treasury_balance_read:
        input.treasuryBalance === null ? "unreadable" : "read at export time",
      tenders: c.tenders,
      withdrawals: c.withdrawals.map((w) => ({
        id: w.id,
        amount_microtari: amount(w.amount),
        to: w.to,
        signers: w.signers,
        executed: w.executed,
        void: w.isVoid,
      })),
      approver_changes: c.approverChanges.map((p) => ({
        id: p.id,
        new_approvers: p.newApprovers,
        new_threshold: p.newThreshold,
        signers: p.signers,
        executed: p.executed,
        void: p.isVoid,
      })),
    },
    tenders: input.tenders,
    notes,
  };
}
