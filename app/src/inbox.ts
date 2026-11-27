// The personal inbox: what needs the connected key, gathered
// from the records this browser can see. The approvals screen
// covers what waits for an approver's signature; this covers
// what waits for the person as a seller or a winner: a reveal
// that must happen before its window closes, claims that sit
// open on a settled tender, a bond that can come back, and an
// escrow refund a circle's approver can collect. Aggregation
// only: every action itself happens on the screen the row
// links to, where its own checks run again.
import type { NetworkName } from "./indexer";
import type { CircleComponentState, TenderComponentState } from "./state";
import type { SavedBid } from "./screens/seller";
import { deadlineText } from "./time";

// Stated on the screen beside the inbox, because it bounds
// what the inbox can promise: the gathering reaches the
// featured circle, the addresses this browser has opened, and
// what network discovery has found in this browser, and
// nothing beyond them.
export const INBOX_SCOPE_NOTE =
  "This screen gathers from the featured circle, the circles and tenders this browser has opened or saved a bid on, and the circles and tenders network discovery has found in this browser. A circle or tender outside that reach is not gathered here, so an empty list means nothing was found in that reach, not that nothing exists.";

export interface InboxItem {
  kind:
    | "reveal"
    | "claim-payment"
    | "claim-receipt"
    | "claim-bond"
    | "collect-refund"
    | "collect-forfeits";
  title: string;
  detail: string;
  dest: string;
}

export function personalItems(args: {
  me: string | null;
  bids: SavedBid[];
  tenders: ReadonlyMap<string, TenderComponentState>;
  circles: ReadonlyMap<string, CircleComponentState>;
  network: NetworkName;
  epoch: number;
}): InboxItem[] {
  const { me, bids, tenders, circles, network, epoch } = args;
  const items: InboxItem[] = [];
  const name = (t: TenderComponentState) => t.circleName || "A sealed tender";

  // Reveals due: a saved bid whose tender can reveal, with the
  // commitment still sealed. The template accepts a reveal
  // while the tender is Open or Reveal, from the bid deadline
  // up to the reveal deadline, so an Open tender past its bid
  // deadline is due here too: that is the first reveal. An
  // epoch of 0 means the current epoch could not be read, so
  // the state alone decides and the seller screen re-checks
  // the window before any submit. The bid's own identity is
  // the key that must sign the reveal; when a key is
  // connected, only its bids are listed.
  for (const bid of bids) {
    const t = tenders.get(bid.tender);
    if (!t || (t.state !== "Open" && t.state !== "Reveal")) continue;
    if (epoch > 0) {
      if (t.bidDeadline !== null && epoch < t.bidDeadline) continue;
      if (t.revealDeadline !== null && epoch >= t.revealDeadline) continue;
    }
    if (me && bid.identity !== me) continue;
    const commitment = t.commitments.find((c) => c.commitment === bid.commitment);
    if (!commitment || commitment.revealed) continue;
    items.push({
      kind: "reveal",
      title: `${name(t)}: your bid is still sealed`,
      detail:
        t.revealDeadline !== null
          ? `Reveal it from bid and reveal before the window closes, ${deadlineText(network, t.revealDeadline, epoch)}. A bid nobody reveals stays sealed, and its bond is forfeited.`
          : "Reveal it from bid and reveal while the reveal window is open. A bid nobody reveals stays sealed, and its bond is forfeited.",
      dest: "#/app/seller",
    });
  }

  if (me) {
    for (const [addr, t] of tenders) {
      const dest = `#/app/tender/${addr}`;
      if (t.state === "Settled" && t.award && t.award.winner === me) {
        if (!t.payoutClaimed)
          items.push({
            kind: "claim-payment",
            title: `${name(t)}: your payment is waiting`,
            detail: "the tender settled in your favour and the payment has not been claimed. claim it from the tender record.",
            dest,
          });
        if (!t.receiptIssued)
          items.push({
            kind: "claim-receipt",
            title: `${name(t)}: your receipt is waiting`,
            detail: "the tender settled in your favour and no receipt has been issued to you yet. claim it from the tender record.",
            dest,
          });
      }
      if (t.state === "Settled" || t.state === "Expired") {
        const mine = t.commitments.find((c) => c.seller === me);
        if (mine && mine.bond === "Returnable")
          items.push({
            kind: "claim-bond",
            title: `${name(t)}: your bond can come back`,
            detail: "your bond on this tender is returnable and has not been claimed. claim it from the tender record.",
            dest,
          });
      }
    }

    // What finished tenders owe the circles the key approves:
    // the escrow refund, and any forfeits the circle has not
    // collected. Both are collected from the circle screen.
    for (const [cAddr, c] of circles) {
      if (!c.approvers.includes(me)) continue;
      const dest = `#/app/circle/${cAddr}`;
      for (const tAddr of c.tenders) {
        const t = tenders.get(tAddr);
        if (!t) continue;
        if (
          (t.state === "Settled" || t.state === "Expired") &&
          !t.refundClaimed &&
          t.refundAmount !== null &&
          t.refundAmount > 0n
        )
          items.push({
            kind: "collect-refund",
            title: `${c.name}: an escrow refund is collectable`,
            detail: `a finished tender of this circle still holds an escrow refund for the treasury. collect it from the circle screen.`,
            dest,
          });
        if (
          (t.state === "Settled" || t.state === "Expired") &&
          !t.forfeitsClaimedByCircle &&
          t.forfeitForCircle > 0n
        )
          items.push({
            kind: "collect-forfeits",
            title: `${c.name}: forfeits are collectable`,
            detail: "a tender of this circle holds forfeited bond money owed to the treasury. collect it from the circle screen.",
            dest,
          });
      }
    }
  }
  return items;
}
