// Verification results for the evidence tenders, captured
// from the standalone verifier's own output. Every check row
// below is copied from a real run against the public indexer;
// nothing here is retyped or recomputed by the app. The data
// is regenerated from a fresh run whenever it is refreshed.

export interface ResultCheck {
  check: string;
  ok: boolean | null;
  detail: string;
}

export interface TenderResult {
  key: string;
  title: string;
  state: string;
  tender: string;
  runError: string | null;
  checks: ResultCheck[];
}

export const RESULTS_META = {
  tool: "scripts/verify.py, asiri working tree",
  runDate: "2026-11-20",
  network: "esmeralda",
  note: "a note on this run: the esmeralda indexers no longer serve the season's transaction bodies, every one answers not known, so the one check that reads the reveal transactions reports that it could not read them instead of failing the records. the five season tenders passed every check when this verifier ran on 2026-11-18, and a live recheck shows the result on the day it runs.",
} as const;

export const TENDER_RESULTS: TenderResult[] = [
  {
    key: "first",
    title: "the first tender",
    state: "settled",
    tender: "component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850",
    runError: null,
    checks: [
      { check: "tender exists", ok: true, detail: "state Settled, circle component_a1dec38cf9e72a702eed7665730507928b10b823750a72f81a6a5c89a66c6181" },
      { check: "template binding", ok: true, detail: "component runs template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2" },
      { check: "template code hash", ok: true, detail: "sha256 of the on-chain code is f6cd9585c8a799caafc781450ca5d50496a8412640bb9de587f49049e0fc0803" },
      { check: "rules hash", ok: true, detail: "recomputed 79391ad2fdff76f0db43aafefff9200c13d81a26c6560d4f4cd75e513b06b618" },
      { check: "escrow funding", ok: true, detail: "escrow 0 + paid out 20000000 of cap 20000000" },
      { check: "record counts", ok: true, detail: "3 commitments, 2 reveals" },
      { check: "reveals verify against commitments", ok: null, detail: "2 of 2 reveals could not be recomputed: their transactions could not be read from any indexer today" },
      { check: "award is the lowest valid revealed price", ok: true, detail: "award 15000000 at counter 1, best valid reveal 15000000" },
      { check: "award counts", ok: true, detail: "award records 3 commitments and 2 reveals" },
      { check: "settlement equals the award", ok: true, detail: "settled 15000000 at epoch 13155, winner matches the award" },
      { check: "delivery confirmed or dispute resolved", ok: true, detail: "2 delivery confirmations, threshold 2" },
      { check: "bond vault reconciles", ok: true, detail: "vault 1000000, expected 1000000 from held 0, returnable 0, locked 1000000" },
      { check: "forfeit split recorded", ok: true, detail: "1 forfeited bonds, locked 1000000, for the circle 1000000" },
    ],
  },
  {
    key: "tie",
    title: "the tie tender",
    state: "settled",
    tender: "component_23f8e02e400ad07858c4435c52685a4143d2711deb356548df2968ae7916a7c4",
    runError: null,
    checks: [
      { check: "tender exists", ok: true, detail: "state Settled, circle component_a1dec38cf9e72a702eed7665730507928b10b823750a72f81a6a5c89a66c6181" },
      { check: "template binding", ok: true, detail: "component runs template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2" },
      { check: "template code hash", ok: true, detail: "sha256 of the on-chain code is f6cd9585c8a799caafc781450ca5d50496a8412640bb9de587f49049e0fc0803" },
      { check: "rules hash", ok: true, detail: "recomputed 2016ebb6596f4af8d40294aef69aa34f183515dd56f53e5615919c474dd4af4d" },
      { check: "escrow funding", ok: true, detail: "escrow 0 + paid out 20000000 of cap 20000000" },
      { check: "record counts", ok: true, detail: "3 commitments, 3 reveals" },
      { check: "reveals verify against commitments", ok: null, detail: "3 of 3 reveals could not be recomputed: their transactions could not be read from any indexer today" },
      { check: "award is the lowest valid revealed price", ok: true, detail: "award 14000000 at counter 1, best valid reveal 14000000" },
      { check: "award counts", ok: true, detail: "award records 3 commitments and 3 reveals" },
      { check: "settlement equals the award", ok: true, detail: "settled 14000000 at epoch 13162, winner matches the award" },
      { check: "delivery confirmed or dispute resolved", ok: true, detail: "2 delivery confirmations, threshold 2" },
      { check: "bond vault reconciles", ok: true, detail: "vault 2000000, expected 2000000 from held 0, returnable 2000000, locked 0" },
      { check: "forfeit split recorded", ok: true, detail: "0 forfeited bonds, locked 0, for the circle 0" },
    ],
  },
  {
    key: "override",
    title: "the override tender",
    state: "settled",
    tender: "component_49377a6f26dfb108ca406bbe445551832512aef96c017499c6f2fda5f4970aab",
    runError: null,
    checks: [
      { check: "tender exists", ok: true, detail: "state Settled, circle component_a1dec38cf9e72a702eed7665730507928b10b823750a72f81a6a5c89a66c6181" },
      { check: "template binding", ok: true, detail: "component runs template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2" },
      { check: "template code hash", ok: true, detail: "sha256 of the on-chain code is f6cd9585c8a799caafc781450ca5d50496a8412640bb9de587f49049e0fc0803" },
      { check: "rules hash", ok: true, detail: "recomputed cf864e3be2fd4371919322a9f401d3065a7bcb05c78d5286392a0cd057e41a3b" },
      { check: "escrow funding", ok: true, detail: "escrow 0 + paid out 20000000 of cap 20000000" },
      { check: "record counts", ok: true, detail: "2 commitments, 2 reveals" },
      { check: "reveals verify against commitments", ok: null, detail: "2 of 2 reveals could not be recomputed: their transactions could not be read from any indexer today" },
      { check: "override threshold and rationale hash", ok: true, detail: "proposal 1 signed by 2 approvers, threshold 2, award follows the override choice" },
      { check: "override choice is a valid revealed bid", ok: true, detail: "chose the bid revealed at 16000000, award matches the chosen bid" },
      { check: "award counts", ok: true, detail: "award records 2 commitments and 2 reveals" },
      { check: "override rationale text", ok: true, detail: "published text hashes to 5f06ee5e5946d4ee12ce4a16461492a2e3047118fdfd0cdc5382e58e0f4029a8" },
      { check: "settlement equals the award", ok: true, detail: "settled 16000000 at epoch 13163, winner matches the award" },
      { check: "delivery confirmed or dispute resolved", ok: true, detail: "2 delivery confirmations, threshold 2" },
      { check: "bond vault reconciles", ok: true, detail: "vault 2000000, expected 2000000 from held 0, returnable 2000000, locked 0" },
      { check: "forfeit split recorded", ok: true, detail: "0 forfeited bonds, locked 0, for the circle 0" },
    ],
  },
  {
    key: "dispute",
    title: "the dispute tender",
    state: "settled",
    tender: "component_2c11937080ed3f26892e378e2b4ad5457ae786ce2ebf187c1c7953020ea8f49f",
    runError: null,
    checks: [
      { check: "tender exists", ok: true, detail: "state Settled, circle component_a1dec38cf9e72a702eed7665730507928b10b823750a72f81a6a5c89a66c6181" },
      { check: "template binding", ok: true, detail: "component runs template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2" },
      { check: "template code hash", ok: true, detail: "sha256 of the on-chain code is f6cd9585c8a799caafc781450ca5d50496a8412640bb9de587f49049e0fc0803" },
      { check: "rules hash", ok: true, detail: "recomputed e537a4361a27eeef17828cacaf58a94fdc5a063a3318884d90cc606ef9000555" },
      { check: "escrow funding", ok: true, detail: "escrow 0 + paid out 20000000 of cap 20000000" },
      { check: "record counts", ok: true, detail: "2 commitments, 2 reveals" },
      { check: "reveals verify against commitments", ok: null, detail: "2 of 2 reveals could not be recomputed: their transactions could not be read from any indexer today" },
      { check: "award is the lowest valid revealed price", ok: true, detail: "award 15000000 at counter 1, best valid reveal 15000000" },
      { check: "award counts", ok: true, detail: "award records 2 commitments and 2 reveals" },
      { check: "settlement equals the award", ok: true, detail: "settled 15000000 at epoch 13165, winner matches the award" },
      { check: "delivery confirmed or dispute resolved", ok: true, detail: "0 delivery confirmations, threshold 2, settled through a dispute resolved for the winner" },
      { check: "bond vault reconciles", ok: true, detail: "vault 2000000, expected 2000000 from held 0, returnable 2000000, locked 0" },
      { check: "forfeit split recorded", ok: true, detail: "0 forfeited bonds, locked 0, for the circle 0" },
    ],
  },
  {
    key: "expiry",
    title: "the expiry tender",
    state: "expired",
    tender: "component_8997a6b77d91deb9e9d6703fd3e3cc173ab4eec5ba2dedd0b22cf53b3312789a",
    runError: null,
    checks: [
      { check: "tender exists", ok: true, detail: "state Expired, circle component_a1dec38cf9e72a702eed7665730507928b10b823750a72f81a6a5c89a66c6181" },
      { check: "template binding", ok: true, detail: "component runs template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2" },
      { check: "template code hash", ok: true, detail: "sha256 of the on-chain code is f6cd9585c8a799caafc781450ca5d50496a8412640bb9de587f49049e0fc0803" },
      { check: "rules hash", ok: true, detail: "recomputed 73665f025f46b59c77ec66d39eb6297d5b8fa2aec3f1879eac44732d850ed910" },
      { check: "escrow funding", ok: true, detail: "escrow 0 + paid out 20000000 of cap 20000000" },
      { check: "record counts", ok: true, detail: "1 commitments, 0 reveals" },
      { check: "reveals verify against commitments", ok: true, detail: "no reveals recorded yet" },
      { check: "award", ok: true, detail: "no award yet" },
      { check: "bond vault reconciles", ok: true, detail: "vault 0, expected 0 from held 0, returnable 0, locked 0" },
      { check: "forfeit split recorded", ok: true, detail: "0 forfeited bonds, locked 0, for the circle 0" },
    ],
  },
  {
    key: "browser-wallet",
    title: "the browser wallet tender",
    state: "settled, claims still open",
    tender: "component_be42cefe86871834d94c7330fd105d198edd7c438b09033ad1aca19b84f2d4a2",
    runError: null,
    checks: [
      { check: "tender exists", ok: true, detail: "state Settled, circle component_4a4a7aee7a9af6f55c8b54da1e3f1405c13ba13364792d96c2170c3bbe5377a8" },
      { check: "template binding", ok: true, detail: "component runs template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2" },
      { check: "template code hash", ok: true, detail: "sha256 of the on-chain code is f6cd9585c8a799caafc781450ca5d50496a8412640bb9de587f49049e0fc0803" },
      { check: "rules hash", ok: true, detail: "recomputed 29a7c5ddcd1dbff79d79435f7b9a1ae526de3e43071aef19319fe8eaa9ca6751" },
      { check: "escrow funding", ok: true, detail: "escrow 500000 + paid out 1500000 of cap 2000000" },
      { check: "record counts", ok: true, detail: "1 commitments, 1 reveals" },
      { check: "reveals verify against commitments", ok: null, detail: "1 of 1 reveals could not be recomputed: their transactions could not be read from any indexer today" },
      { check: "award is the lowest valid revealed price", ok: true, detail: "award 1500000 at counter 1, best valid reveal 1500000" },
      { check: "award counts", ok: true, detail: "award records 1 commitments and 1 reveals" },
      { check: "settlement equals the award", ok: true, detail: "settled 1500000 at epoch 13191, winner matches the award" },
      { check: "delivery confirmed or dispute resolved", ok: true, detail: "1 delivery confirmations, threshold 1" },
      { check: "bond vault reconciles", ok: true, detail: "vault 500000, expected 500000 from held 0, returnable 500000, locked 0" },
      { check: "forfeit split recorded", ok: true, detail: "0 forfeited bonds, locked 0, for the circle 0" },
    ],
  },
  {
    key: "scale",
    title: "the scale tender",
    state: "settled",
    tender: "component_d4542df584b5e5682d36c28f39b17c97994eaf4544623b91e7d8fe5b928a8fcc",
    runError: null,
    checks: [
      { check: "tender exists", ok: true, detail: "state Settled, circle component_a1dec38cf9e72a702eed7665730507928b10b823750a72f81a6a5c89a66c6181" },
      { check: "template binding", ok: true, detail: "component runs template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2" },
      { check: "template code hash", ok: true, detail: "sha256 of the on-chain code is f6cd9585c8a799caafc781450ca5d50496a8412640bb9de587f49049e0fc0803" },
      { check: "rules hash", ok: true, detail: "recomputed c0a2b33019ee0bf34d7fccbc4a836db10b8ca03382475aa2ad9c5240f0cf0910" },
      { check: "escrow funding", ok: true, detail: "escrow 0 + paid out 20000000 of cap 20000000" },
      { check: "record counts", ok: true, detail: "10 commitments, 10 reveals" },
      { check: "reveals verify against commitments", ok: true, detail: "all 10 reveals recompute to their commitments" },
      { check: "award is the lowest valid revealed price", ok: true, detail: "award 11000000 at counter 1, best valid reveal 11000000" },
      { check: "award counts", ok: true, detail: "award records 10 commitments and 10 reveals" },
      { check: "settlement equals the award", ok: true, detail: "settled 11000000 at epoch 13259, winner matches the award" },
      { check: "delivery confirmed or dispute resolved", ok: true, detail: "2 delivery confirmations, threshold 2" },
      { check: "bond vault reconciles", ok: true, detail: "vault 2000000, expected 2000000 from held 0, returnable 2000000, locked 0" },
      { check: "forfeit split recorded", ok: true, detail: "0 forfeited bonds, locked 0, for the circle 0" },
    ],
  },
];
