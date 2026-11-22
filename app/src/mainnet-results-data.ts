// The mainnet season's tender records, generated from the
// season's evidence record: every value below is parsed from
// that record by the generator, which fails if the record's
// own sums do not close. Regenerated whenever the record is
// refreshed.
//
// This data carries the record's structured facts: addresses,
// epochs, amounts, fees, and both verifiers' counts. It does
// not carry the canonical receipt files the esmeralda section
// offers for download: a receipt file is the standalone
// verifier's own output from a live run, and the command
// printed beside each tender here reproduces it.

export interface MainnetTenderRecord {
  key: string;
  title: string;
  state: string;
  tender: string;
  proves: string;
  lockEpoch: number;
  closedEpoch: number;
  capMicro: number;
  paidMicro: number | null;
  paidTo: string | null;
  provenLowestMicro: number | null;
  provenLowestBy: string | null;
  rationaleHash: string | null;
  disputeEvidenceHash: string | null;
  refundMicro: number;
  feesMicro: number;
  commitments: number;
  reveals: number;
  standalonePass: number;
  standaloneTotal: number;
  appPass: number;
  appTotal: number;
}

export const MAINNET_RESULTS_META = {
  "network": "mainnet",
  "circle": "component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71",
  "circleName": "Heartland Provisions Circle",
  "totalFeesMicro": 664908
} as const;

export const MAINNET_TENDER_RECORDS: MainnetTenderRecord[] = [
  {
    key: "gate",
    title: "the gate tender",
    state: "settled",
    tender: "component_84e25948c447c3ee437e783fc29b4bfebf18fb2cc1bee1c0ed41598113ad37f2",
    proves: "the full lifecycle on mainnet. A bid nobody reveals stays sealed and cannot win, its bond splits, half to the circle and half locked in the tender's bond vault unspendable, and the winner is provably the lowest revealed bid under the locked rules.",
    lockEpoch: 39213,
    closedEpoch: 39218,
    capMicro: 20000000,
    paidMicro: 15000000,
    paidTo: "seller1",
    provenLowestMicro: null,
    provenLowestBy: null,
    rationaleHash: null,
    disputeEvidenceHash: null,
    refundMicro: 5000000,
    feesMicro: 85516,
    commitments: 3,
    reveals: 2,
    standalonePass: 13,
    standaloneTotal: 13,
    appPass: 13,
    appTotal: 13,
  },
  {
    key: "tie",
    title: "the tie tender",
    state: "settled",
    tender: "component_7acad78ae79b82e4b13dfcba2191009714dc6091a0cc8c8b6aef64824b81e73b",
    proves: "two sellers revealed the same lowest price and the tie broke by commitment order. The earlier commitment, counter 1, won at the tied price, the tied loser was not penalised, and every bond came back because every bid was revealed.",
    lockEpoch: 39218,
    closedEpoch: 39223,
    capMicro: 20000000,
    paidMicro: 14000000,
    paidTo: "seller1",
    provenLowestMicro: null,
    provenLowestBy: null,
    rationaleHash: null,
    disputeEvidenceHash: null,
    refundMicro: 6000000,
    feesMicro: 97885,
    commitments: 3,
    reveals: 3,
    standalonePass: 13,
    standaloneTotal: 13,
    appPass: 13,
    appTotal: 13,
  },
  {
    key: "override",
    title: "the override tender",
    state: "settled",
    tender: "component_c674fd9f80f02a03c24d4a137aa2e5f72ddad382e83428eacd7afcc29344e593",
    proves: "the lowest revealed bid does not have to win when the circle overrides in the open. The override is public, needs threshold approval, carries a rationale hash on chain whose published text anyone can check, and can only choose among revealed bids. Here it chose the higher revealed bid and paid exactly that price, 2 tari above the proven lowest revealed bid.",
    lockEpoch: 39223,
    closedEpoch: 39228,
    capMicro: 20000000,
    paidMicro: 16000000,
    paidTo: "seller1",
    provenLowestMicro: 14000000,
    provenLowestBy: "seller2",
    rationaleHash: "7a6785a6ceafc693884d01fb8447058dab6034f43824af38d7cabba77677f7f4",
    disputeEvidenceHash: null,
    refundMicro: 4000000,
    feesMicro: 95625,
    commitments: 2,
    reveals: 2,
    standalonePass: 15,
    standaloneTotal: 15,
    appPass: 15,
    appTotal: 15,
  },
  {
    key: "dispute",
    title: "the dispute tender",
    state: "settled",
    tender: "component_78fa0f9830f846f9f865b4e27133781cb716aab4d937ad79c64467ba90b38e11",
    proves: "when delivery is not confirmed, the winner can raise a dispute inside the claim window with an evidence hash on chain, and a higher threshold of approvers than the usual award threshold, 3 against 2, decides it. Here all three approvers resolved the dispute for the winner and the winner was paid in full.",
    lockEpoch: 39228,
    closedEpoch: 39235,
    capMicro: 20000000,
    paidMicro: 15000000,
    paidTo: "seller1",
    provenLowestMicro: null,
    provenLowestBy: null,
    rationaleHash: null,
    disputeEvidenceHash: "67ba00860d59c1205adde2e7e724fe039124e68df9d122b14a7794f4951c86bb",
    refundMicro: 5000000,
    feesMicro: 92767,
    commitments: 2,
    reveals: 2,
    standalonePass: 13,
    standaloneTotal: 13,
    appPass: 13,
    appTotal: 13,
  },
  {
    key: "expiry",
    title: "the expiry tender",
    state: "expired",
    tender: "component_96bcddd81d62af245144ebcff5fcccdcb96a69df880728f90df15bffdaae571c",
    proves: "a tender that gets no valid reveal expires cleanly. The full escrow returns to the circle, and the unrevealed bid's bond comes back whole instead of splitting, the expiry exception to the forfeit rule that the gate tender shows.",
    lockEpoch: 39236,
    closedEpoch: 39240,
    capMicro: 20000000,
    paidMicro: null,
    paidTo: null,
    provenLowestMicro: null,
    provenLowestBy: null,
    rationaleHash: null,
    disputeEvidenceHash: null,
    refundMicro: 20000000,
    feesMicro: 39277,
    commitments: 1,
    reveals: 0,
    standalonePass: 10,
    standaloneTotal: 10,
    appPass: 10,
    appTotal: 10,
  },
  {
    key: "scale",
    title: "the scale tender",
    state: "settled",
    tender: "component_034c69f5ac0c9dd7bdb5cf15433d885f17f4781fb9d20df49f426134d38621ee",
    proves: "the full flow holds at ten sellers. Ten commitments, ten reveals, the lowest revealed price wins, all nine losing bonds come back, and the escrow accounts exactly.",
    lockEpoch: 39240,
    closedEpoch: 39245,
    capMicro: 20000000,
    paidMicro: 11000000,
    paidTo: "seller1",
    provenLowestMicro: null,
    provenLowestBy: null,
    rationaleHash: null,
    disputeEvidenceHash: null,
    refundMicro: 9000000,
    feesMicro: 253838,
    commitments: 10,
    reveals: 10,
    standalonePass: 13,
    standaloneTotal: 13,
    appPass: 13,
    appTotal: 13,
  },
];
