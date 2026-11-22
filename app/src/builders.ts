// One builder per template action. Each returns the exact
// instruction list the wallet is asked to sign, so the tests can
// pin the request shape for every flow without a wallet.
import { arg, TARI_TOKEN, type Arg } from "./args";
import type { TenderRules } from "./model";
import type { Instruction } from "./wallet";

const call = (component: string, method: string, args: Arg[]): Instruction => ({
  CallMethod: { call: { Address: component }, method, args },
});

const callFn = (template: string, fn: string, args: Arg[]): Instruction => ({
  CallFunction: {
    address: template.replace(/^template_/, ""),
    function: fn,
    args,
  },
});

const keepOutput = (key: number): Instruction => ({
  PutLastInstructionOutputOnWorkspace: { key },
});

/** Withdraw native tokens from the account into workspace slot 0. */
const withdraw = (account: string, amount: bigint): Instruction[] => [
  call(account, "withdraw", [arg.resource(TARI_TOKEN), arg.amount(amount)]),
  keepOutput(0),
];

// ---------- circle ----------

export const buildCreateCircle = (
  circleTemplate: string,
  name: string,
  approvers: string[],
  threshold: number,
  auditor: string | null,
  tenderTemplate: string | null,
): Instruction[] => [
  callFn(circleTemplate, "new", [
    arg.text(name),
    arg.pubkeys(approvers),
    arg.uint(threshold),
    arg.optPubkey(auditor),
    arg.optTemplate(tenderTemplate),
  ]),
];

export const buildDepositTreasury = (
  account: string,
  circle: string,
  amount: bigint,
): Instruction[] => [
  ...withdraw(account, amount),
  call(circle, "deposit_treasury", [arg.workspace(0)]),
];

export const buildProposeWithdrawal = (
  circle: string,
  amount: bigint,
  to: string,
): Instruction[] => [
  call(circle, "propose_withdrawal", [arg.amount(amount), arg.component(to)]),
];

export const buildApproveWithdrawal = (circle: string, id: number): Instruction[] => [
  call(circle, "approve_withdrawal", [arg.uint(id)]),
];

export const buildCircleApproverChange = (
  circle: string,
  newApprovers: string[],
  newThreshold: number,
): Instruction[] => [
  call(circle, "propose_approver_change", [
    arg.pubkeys(newApprovers),
    arg.uint(newThreshold),
  ]),
];

export const buildCircleApproveApproverChange = (
  circle: string,
  id: number,
): Instruction[] => [call(circle, "approve_approver_change", [arg.uint(id)])];

export const buildRegisterTender = (circle: string, tender: string): Instruction[] => [
  call(circle, "register_tender", [arg.component(tender)]),
];

export const buildCollectRefund = (circle: string, tender: string): Instruction[] => [
  call(circle, "collect_tender_refund", [arg.component(tender)]),
];

export const buildCollectForfeits = (circle: string, tender: string): Instruction[] => [
  call(circle, "collect_tender_forfeits", [arg.component(tender)]),
];

// ---------- tender ----------

export const buildCreateTender = (
  tenderTemplate: string,
  circle: string,
  rules: TenderRules,
): Instruction[] => [
  callFn(tenderTemplate, "new", [arg.component(circle), arg.rules(rules)]),
];

export const buildUpdateRules = (tender: string, rules: TenderRules): Instruction[] => [
  call(tender, "update_rules", [arg.rules(rules)]),
];

export const buildTenderApproverChange = (
  tender: string,
  newApprovers: string[],
): Instruction[] => [
  call(tender, "propose_approver_change", [arg.pubkeys(newApprovers)]),
];

export const buildTenderApproveApproverChange = (
  tender: string,
  id: number,
): Instruction[] => [call(tender, "approve_approver_change", [arg.uint(id)])];

export const buildLockAndFund = (
  account: string,
  tender: string,
  cap: bigint,
): Instruction[] => [
  ...withdraw(account, cap),
  call(tender, "lock_and_fund", [arg.workspace(0)]),
];

export const buildCommitBid = (
  account: string,
  tender: string,
  commitmentHex: string,
  bond: bigint,
): Instruction[] => [
  ...withdraw(account, bond),
  call(tender, "commit_bid", [arg.hash(commitmentHex), arg.workspace(0)]),
];

export const buildRevealBid = (
  tender: string,
  price: bigint,
  salt: Uint8Array,
  paymentIdentityHex: string,
): Instruction[] => [
  call(tender, "reveal_bid", [
    arg.amount(price),
    arg.byteVec(salt),
    arg.pubkey(paymentIdentityHex),
  ]),
];

export const buildCloseReveal = (tender: string): Instruction[] => [
  call(tender, "close_reveal", []),
];

export const buildProposeOverride = (
  tender: string,
  chosen: string | null,
  rationaleHashHex: string,
): Instruction[] => [
  call(tender, "propose_override", [
    arg.optPubkey(chosen),
    arg.hash(rationaleHashHex),
  ]),
];

export const buildSignOverride = (tender: string, id: number): Instruction[] => [
  call(tender, "sign_override", [arg.uint(id)]),
];

export const buildAdvanceDelivery = (tender: string): Instruction[] => [
  call(tender, "advance_delivery", []),
];

export const buildConfirmDelivery = (tender: string): Instruction[] => [
  call(tender, "confirm_delivery", []),
];

export const buildClaimDispute = (
  tender: string,
  evidenceHashHex: string,
): Instruction[] => [call(tender, "claim_dispute", [arg.hash(evidenceHashHex)])];

export const buildResolveDispute = (
  tender: string,
  payWinner: boolean,
  rationaleHashHex: string,
): Instruction[] => [
  call(tender, "resolve_dispute", [arg.bool(payWinner), arg.hash(rationaleHashHex)]),
];

export const buildExpire = (tender: string): Instruction[] => [
  call(tender, "expire", []),
];

/** Claim a bucket-returning tender method and deposit it. */
const claimTo = (account: string, tender: string, method: string): Instruction[] => [
  call(tender, method, []),
  keepOutput(0),
  call(account, "deposit", [arg.workspace(0)]),
];

export const buildClaimPayment = (account: string, tender: string): Instruction[] =>
  claimTo(account, tender, "claim_payment");

export const buildClaimReceipt = (account: string, tender: string): Instruction[] =>
  claimTo(account, tender, "claim_receipt");

export const buildClaimBond = (account: string, tender: string): Instruction[] =>
  claimTo(account, tender, "claim_bond");
