// The exception invoice and the zero-extraction ledger
// for the evidence tenders, as data. Every figure here
// was generated from the published invoice and ledger
// documents, and the generation checks each document
// against itself: the invoice's difference against its
// two prices, its rationale text against the on-chain
// rationale hash, every ledger row's escrow identity,
// and the totals against the rows. Nothing is retyped.

export interface InvoiceFact {
  priceMicro: number;
  seller: string;
  sellerName: string;
}

export const EXCEPTION_INVOICE = {
  "tender": "component_49377a6f26dfb108ca406bbe445551832512aef96c017499c6f2fda5f4970aab",
  "provenLowest": {
    "priceMicro": 14000000,
    "seller": "161b42299db925887a49aed8d30b86b0b9ef80888e311f9376fd20dc4385755a",
    "sellerName": "seller2"
  },
  "pricePaid": {
    "priceMicro": 16000000,
    "seller": "ca4312fd72cb3fb495172aa5b90cb3e46b7ed4f46390aa043e07b8c76fc92770",
    "sellerName": "seller1"
  },
  "differenceMicro": 2000000,
  "proposalId": 1,
  "signers": 2,
  "threshold": 2,
  "executedEpoch": 13161,
  "settledEpoch": 13163,
  "rationaleHash": "5f06ee5e5946d4ee12ce4a16461492a2e3047118fdfd0cdc5382e58e0f4029a8",
  "rationaleText": "Override rationale for season tender 2. The low bid of 14 tari came from seller2, who has not delivered for this circle before. The circle chose seller1 at 16 tari because seller1 delivered the circle's gate tender in full and on time. Price was traded for a proven delivery record.",
  "boundary": "The boundary of the proof, stated plainly: the 14 tari bid is proven the lowest among the bids that were revealed. On this tender every committed bid was revealed (2 commitments, 2 reveals), so no unrevealed bid exists here whose price could differ. The proof makes no claim, here or anywhere, about bids nobody revealed."
} as const;

export interface LedgerRow {
  title: string;
  tender: string;
  state: string;
  escrowIn: number;
  paid: number | null;
  refunded: number;
  inVault: number;
  bondsIn: number;
  lockedForever: number;
  feesMicro: number;
  feesPartial: boolean;
  operatorPaid: number;
}

export const LEDGER = {
  "rows": [
    {
      "title": "The first tender",
      "tender": "component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850",
      "state": "Settled",
      "escrowIn": 20000000,
      "paid": 15000000,
      "refunded": 5000000,
      "inVault": 0,
      "bondsIn": 6000000,
      "lockedForever": 1000000,
      "feesMicro": 94267,
      "feesPartial": false,
      "operatorPaid": 0
    },
    {
      "title": "The tie tender",
      "tender": "component_23f8e02e400ad07858c4435c52685a4143d2711deb356548df2968ae7916a7c4",
      "state": "Settled",
      "escrowIn": 20000000,
      "paid": 14000000,
      "refunded": 6000000,
      "inVault": 0,
      "bondsIn": 6000000,
      "lockedForever": 0,
      "feesMicro": 96840,
      "feesPartial": false,
      "operatorPaid": 0
    },
    {
      "title": "The override tender",
      "tender": "component_49377a6f26dfb108ca406bbe445551832512aef96c017499c6f2fda5f4970aab",
      "state": "Settled",
      "escrowIn": 20000000,
      "paid": 16000000,
      "refunded": 4000000,
      "inVault": 0,
      "bondsIn": 4000000,
      "lockedForever": 0,
      "feesMicro": 98976,
      "feesPartial": false,
      "operatorPaid": 0
    },
    {
      "title": "The dispute tender",
      "tender": "component_2c11937080ed3f26892e378e2b4ad5457ae786ce2ebf187c1c7953020ea8f49f",
      "state": "Settled",
      "escrowIn": 20000000,
      "paid": 15000000,
      "refunded": 5000000,
      "inVault": 0,
      "bondsIn": 4000000,
      "lockedForever": 0,
      "feesMicro": 91766,
      "feesPartial": false,
      "operatorPaid": 0
    },
    {
      "title": "The expiry tender",
      "tender": "component_8997a6b77d91deb9e9d6703fd3e3cc173ab4eec5ba2dedd0b22cf53b3312789a",
      "state": "Expired",
      "escrowIn": 20000000,
      "paid": null,
      "refunded": 20000000,
      "inVault": 0,
      "bondsIn": 2000000,
      "lockedForever": 0,
      "feesMicro": 35977,
      "feesPartial": false,
      "operatorPaid": 0
    },
    {
      "title": "The browser wallet tender",
      "tender": "component_be42cefe86871834d94c7330fd105d198edd7c438b09033ad1aca19b84f2d4a2",
      "state": "Settled",
      "escrowIn": 2000000,
      "paid": 1500000,
      "refunded": 0,
      "inVault": 500000,
      "bondsIn": 500000,
      "lockedForever": 0,
      "feesMicro": 4703,
      "feesPartial": true,
      "operatorPaid": 0
    },
    {
      "title": "The scale tender",
      "tender": "component_d4542df584b5e5682d36c28f39b17c97994eaf4544623b91e7d8fe5b928a8fcc",
      "state": "Settled",
      "escrowIn": 20000000,
      "paid": 11000000,
      "refunded": 9000000,
      "inVault": 0,
      "bondsIn": 20000000,
      "lockedForever": 0,
      "feesMicro": 253990,
      "feesPartial": false,
      "operatorPaid": 0
    }
  ],
  "totals": {
    "escrowIn": 122000000,
    "paid": 72500000,
    "refunded": 49000000,
    "inVault": 500000,
    "bondsIn": 42500000,
    "bondsReturned": 32000000,
    "bondsReturnable": 8500000,
    "forfeitShares": 1000000,
    "lockedForever": 1000000,
    "feesMicro": 676519,
    "operatorPaid": 0
  },
  "discrepancy": {
    "tx": "83f4137fe19c",
    "feeMicro": 3850,
    "originallyWrittenMicro": 3806,
    "resolved": true
  }
} as const;
