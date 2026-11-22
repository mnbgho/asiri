// Typical network fees per action, in microtari, measured on
// the esmeralda season record (EVIDENCE.md): each figure is a
// rounded middle of the fees actually paid for that action
// across the season's tenders. The signer pays the fee to the
// network; it never comes out of an escrow or a bond. Fees vary
// with the tender's size and the network's conditions (the
// ten-seller scale tender ran higher on several actions), so
// the app shows these as typical, never exact. The wallet
// shows the exact cost before the user approves.
//
// Actions the record carries no measured fee for are absent
// here, and the app shows no figure for them rather than
// inventing one: depositing to a treasury (only ever submitted
// from a member's own wallet app, never through a recorded
// wallet), approving a withdrawal, and proposing or approving
// an approver change on a circle itself (the tender-side pair
// below is measured; the circle-side pair has never been
// submitted on a recorded wallet).
import { tari } from "./app";

export type FeeAction =
  | "createCircle"
  | "createTender"
  | "registerTender"
  | "lockAndFund"
  | "commitBid"
  | "proposeWithdrawal"
  | "proposeTenderApproverChange"
  | "approveTenderApproverChange"
  | "proposeOverride"
  | "signOverride"
  | "revealBid"
  | "closeReveal"
  | "advanceDelivery"
  | "confirmDelivery"
  | "claimDispute"
  | "resolveDispute"
  | "claimPayment"
  | "claimReceipt"
  | "claimBond"
  | "collectRefund"
  | "collectForfeits"
  | "expire";

export const TYPICAL_FEES: Record<FeeAction, bigint> = {
  createCircle: 3_500n, // measured 3,546
  createTender: 4_900n, // measured 4,588 to 5,198
  registerTender: 5_900n, // measured 5,420 to 6,395
  lockAndFund: 4_800n, // measured 4,596 to 5,207 (one early lock at 2,004)
  commitBid: 5_100n, // measured 3,113 to 6,231
  proposeWithdrawal: 4_000n, // measured 4,045
  proposeTenderApproverChange: 4_500n, // measured 4,456
  approveTenderApproverChange: 4_500n, // measured 4,495 to 4,568
  proposeOverride: 4_700n, // measured 4,665
  signOverride: 4_700n, // measured 2,896 to 5,029
  revealBid: 4_800n, // measured 4,714 to 4,808
  closeReveal: 4_900n, // measured 4,709 to 4,910
  advanceDelivery: 5_000n, // measured 4,760 to 5,012
  confirmDelivery: 5_000n, // measured 4,821 to 5,177
  claimDispute: 4_900n, // measured 4,929
  resolveDispute: 4_900n, // measured 4,756 to 5,211 per vote
  claimPayment: 5_900n, // measured 4,703 to 5,983
  claimReceipt: 8_500n, // measured 8,322 to 8,668
  claimBond: 5_900n, // measured 4,985 to 5,947
  collectRefund: 6_700n, // measured 5,753 to 6,713
  collectForfeits: 3_800n, // measured 3,712 to 3,825
  expire: 4_300n, // measured 4,333
};

/** The fee line shown beside an action before the wallet opens. */
export function feeText(action: FeeAction): string {
  return `typical fee about ${tari(TYPICAL_FEES[action])} tari. the wallet shows the exact cost before you approve.`;
}
