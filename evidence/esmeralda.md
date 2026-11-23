# Asiri evidence, Esmeralda season

Every claim in this file can be re-checked by anyone. Records are
read from the public indexer at https://ootle-indexer-a.tari.com,
the templates are the ones pinned in the app config and in
scripts/verify.py, and the standalone verifier is run against each
tender as it settles. All season tenders are run by us across our
own accounts and are labelled as ours. Amounts are in tari
(1 tari = 1,000,000 microtari).

Templates, Esmeralda:
- Circle: template_d2677930a7e9283c3ead76a54ba9e9cd360ee5dda8a8a56ead8e84a88f45bdd1
- Tender: template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2

## Gate tender (settled)

- Tender: component_3dbc5322267ca40712de3876c651938bf51730c0e4f29487c39c9e2dcdb36850
- Circle: Uyo Provisions Circle,
  component_a1dec38cf9e72a702eed7665730507928b10b823750a72f81a6a5c89a66c6181
- Rules: cap 20 tari, bond 2 tari, windows 2/2/1/2/2/2 epochs,
  approval threshold 2, dispute threshold 3.
- Three bids committed. The 12 tari bid was never revealed and
  could not win. Revealed bids: 15 tari and 17.5 tari. Award:
  15 tari to the low revealed bidder. Delivery confirmed by two
  approvers. Winner paid, receipt issued, losing bond returned,
  refund and the circle's forfeit share collected.
- Final state: escrow empty with the full 20 tari accounted for.
  The bond vault holds exactly 1 tari, the locked forfeit half of
  the unrevealed bid's bond, which stays there unspendable.
- Verifier: 13 of 13 checks pass, in both the standalone script
  and the app's verify page.

## Season, part 1 (complete)

Four tenders on the Uyo Provisions Circle, same rules as the gate
tender unless a section says otherwise. Locked on 2026-11-17.

Recorded outcome fees, summed from the fee written beside each
transaction in the four outcome records below: tie test 51,032
microtari, override test 60,141 microtari, dispute test 69,893
microtari, expiry test 18,783 microtari. Part 1 recorded outcome
fees total 199,849 microtari, or 0.199849 tari. This subtotal covers
only the fees written in the outcome records; setup, registration,
locking, and bid commitment fees are recorded separately, not
in these outcome notes.

### Tender 1, tie test

- Tender: component_23f8e02e400ad07858c4435c52685a4143d2711deb356548df2968ae7916a7c4
- What it proves: two sellers reveal the same price, and the
  locked tie-break, the earlier reveal, decides the winner.
- Bids committed: three, at 14 tari, 14 tari, and 16 tari.
- Outcome: settled. The two 14 tari bids tied on price and the
  earlier reveal won: seller1 revealed first at counter 1, seller2
  second at counter 2, and the third bid was 16 tari. Close-reveal
  set the award at 14 tari to seller1, tx
  0277fdfe6bb246877219ffa1163ed90b69a8c78e0f9e0988079267c0d3cd5942,
  fee 4910 microtari. Delivery was confirmed by two approvers, tx
  6b63ebd34e1692d9aa7bdf9f1656ed4368a4dde6c7be126f9f664580cbe0f9d1,
  fee 4821 microtari, and tx
  65f033159ea4cb845b313a42127730a23ce4d0770c329ac8262c79c3af29d964,
  fee 5106 microtari. The winner was paid 14 tari, tx
  211f91c227673200cbbe1f049c8f673ae3fb3f6048bf8d44777abfcb0c539d39,
  fee 5782 microtari, settlement at epoch 13162, and the receipt was
  issued, tx
  862ce2f10c39402d10a49864f68812f8450d36af1df13384e19761242e2ea993,
  fee 8322 microtari. Both losing bonds were returned, seller2 tx
  d328fbcfd3610c3affc448c1054350bced050d960afd7dc53455424ee8f2d89b,
  fee 5839 microtari, third tx
  8068201535c6b27472eb0a0a031b4447d94d15fe7a8634dc11681d8957414c13,
  fee 5840 microtari. The circle collected the 6 tari refund, tx
  4b1b6703910ec383aacd48dfc7e9f56cb8b473b99d312c12eac8c68281933860,
  fee 6606 microtari, so the escrow is empty with the full 20 tari
  accounted for, 14 paid plus 6 refunded. The circle's
  collect-forfeits call was rejected, tx
  6cfd5b23ade803a1de60af6f52876b189c5783eaba0327712b0d903e056d82ec,
  fee 3806 microtari: Template error, no forfeits for the circle.
  That is the correct answer here, since all three bids were
  revealed and nothing was forfeited. The winner's 2 tari bond sits
  in the bond vault in Returnable state. The season flow claims the
  losing bonds but has no step that claims the winner's bond back,
  so it stays claimable by the winner.
- Verifier: 13 of 13 checks pass.

### Tender 2, override test

- Tender: component_49377a6f26dfb108ca406bbe445551832512aef96c017499c6f2fda5f4970aab
- What it proves: an override is possible only in the open, with a
  published rationale and the approver threshold, and the verifier
  checks the override against that rationale.
- Bids committed: two, at 14 tari and 16 tari.
- The rationale the circle published with its override: Override
  rationale for season tender 2. The low bid of 14 tari came from
  seller2, who has not delivered for this circle before. The circle
  chose seller1 at 16 tari because seller1 delivered the circle's
  gate tender in full and on time. Price was traded for a proven
  delivery record. Its hash,
  5f06ee5e5946d4ee12ce4a16461492a2e3047118fdfd0cdc5382e58e0f4029a8,
  is committed in the override proposal on chain.
- The override proposal landed on chain as proposal id 1. The
  first sign attempt was rejected because its payload
  named proposal id 0, Template error, unknown override proposal,
  tx eaee667be461c2a49f7074c38f10718266a0199c527be59c3f08697b815f46b2.
  Proposal ids start at 1, not 0, an operator-side mistake, not a
  template defect. The sign was re-issued with id 1 and accepted by both
  approvers, tx 5d80dc20e9c6da6173ebfc7376f733c96d5945c342e54ed4f26d01d74c253584
  and tx c91cc50c106e6ceb48fc435069628dd54f25b6d1386279e4be4dea5d2f879e88,
  and the override executed: the award moved from the 14 tari bid
  to seller1 at 16 tari, with the published rationale hash
  5f06ee5e5946d4ee12ce4a16461492a2e3047118fdfd0cdc5382e58e0f4029a8
  on the record.
- Outcome: settled. Both bids were revealed, seller2 at 14 tari,
  tx 29e3d9e8552cff9d579d1bdd7e409c1426dbc74bcf1cdf1c7f82c7f5833dd42f,
  fee 4779 microtari, and seller1 at 16 tari, tx
  8130fbf0055e1f707c6fd51312b01981794f727b9bf8cf1fd70f9dc29353cdce,
  fee 4740 microtari. Close-reveal set the award to the override
  choice, seller1 at 16 tari, tx
  2c276894608bbad9dc743d6cea2f147778f18e55efc7e046f3e9566e4b109b6b,
  fee 4709 microtari. Delivery was advanced, tx
  4133dd795216e1988879d8187fae08beeb73b0aa833b79b12328825fdaeaab73,
  fee 5012 microtari, and confirmed by two approvers, tx
  5aa908381eea044a2e582efd607e7d12b7af7a61bbc86b3f9c28c2245385be6e,
  fee 4893 microtari, and tx
  0bf8f4241f7d8efce8b57ca2bc75c172032fc30cd602485b35f3c52d309891f7,
  fee 5177 microtari. The winner was paid 16 tari, tx
  6b0660e03ab0d2d5f654bc769a3cd0f9046cb89982d524be26c0b10582b6d659,
  fee 5901 microtari, settlement at epoch 13163, and the receipt
  was issued, tx
  469b5262979a68759462a791a7ffe629c60676e7d3124952d03f31dd08306e38,
  fee 8516 microtari. The losing bond was returned, seller2 tx
  dd2388c6d03394eed65f84d47960c26156343accda6c6a740b9dc6166f73c8f7,
  fee 5911 microtari. The circle collected the 4 tari refund, tx
  be5377e40f59fe0fb50dddc0dd3e47a610ce6ce6c58dd5af489df6105a5f553e,
  fee 6678 microtari, so the escrow is empty with the full 20 tari
  accounted for, 16 paid plus 4 refunded. The circle's
  collect-forfeits call was rejected, tx
  6d282b9530ee684812e2852f6770dc6074352bde19cb5a20724001abc2a1b8df,
  fee 3825 microtari: Template error, no forfeits for the circle.
  That is the correct answer here, since both bids were revealed
  and nothing was forfeited. The winner's 2 tari bond sits in the
  bond vault in Returnable state. The season flow claims the
  losing bonds but has no step that claims the winner's bond back,
  so it stays claimable by the winner.
- Verifier: the first run scored 13 of 15, with the two override
  checks failing on a verifier bug: it compared the override
  record's chosen value against commitment hashes, while the
  template stores the chosen seller's public key there. The
  on-chain record itself was always correct: proposal 1 was
  signed by 2 approvers against threshold 2, the chosen key is
  seller1, who revealed at 16 tari, the award and the settlement
  at epoch 13163 match that bid, and the published rationale text
  hashes to 5f06ee5e5946d4ee12ce4a16461492a2e3047118fdfd0cdc5382e58e0f4029a8.
  Both verifier implementations were fixed to compare the chosen
  key against the award winner and the reveal seller fields, the
  recorded fixtures were corrected to the same semantics. Two
  confirmation re-runs pass both
  override checks and score 14 of 15 each time, with the one
  remaining failure a timed-out indexer read on the template
  code hash check, which fetches the full template substate and
  passed in the first run. A clean confirmation re-run on
  2026-11-17 passes 15 of 15, including both override checks and
  the rationale text check against the published text above, which
  hashes to
  5f06ee5e5946d4ee12ce4a16461492a2e3047118fdfd0cdc5382e58e0f4029a8.

### Tender 3, dispute test

- Tender: component_2c11937080ed3f26892e378e2b4ad5457ae786ce2ebf187c1c7953020ea8f49f
- What it proves: when delivery is not confirmed, the winner can
  dispute inside the claim grace, and the approvers can settle the
  tender for the winner at the higher dispute threshold.
- Bids committed: two, at 15 tari and 17.5 tari.
- Outcome: settled. Both bids were revealed, seller1 at 15 tari,
  tx efabd3af1a9e1fc10e66b05adb90ad1ffd33bd579a580b92c850b7eb0b32c62e,
  fee 4808 microtari, and seller2 at 17.5 tari, tx
  862de1e9462dd5ff362b8a24e10f2d5d3053948bffafdf93c273cf02851c6274,
  fee 4714 microtari. Close-reveal set the award at 15 tari to
  seller1, tx
  94732e9926d0540457b9e0de50c783b5a156504b6690e0bcc893743d21a0a1d8,
  fee 4712 microtari. Delivery was advanced, tx
  eb6e14fef7ace54015a9eb2db49682345b7525011d70b048fdccc23d9dbfa4b4,
  fee 4760 microtari, but never confirmed by the approvers, so the
  winner disputed inside the claim grace, tx
  cd6ee5925016198e69b74879670b60f6e00beb87138495617a188d42f42336c5,
  fee 4929 microtari. Between that claim at 12:33:06Z and 13:37:31Z
  the automation's reads of the dispute tender failed, so the
  tender could not advance. A fresh run started at 13:41:11Z read
  the tender and completed the remaining steps.
  The dispute was resolved for the winner by all three approvers
  at threshold 3, tx
  eb380d6c238480f51a786dbff105bcfea9ec0585a19b9012367cbd8e77990392,
  fee 4756 microtari, tx
  d85af29221728ea3871ed7db364be859e8de39face70e78ca67d450560998bfa,
  fee 4842 microtari, and tx
  560defe5cb08fe3792d236b22809b191f591f8479d8d57d7da1279ba6e91ef50,
  fee 5211 microtari. The winner was paid 15 tari, tx
  8131743cab735d845f7e681bfe9fc7ef4e8cd268be8a3418fe40cadf6e7e57b4,
  fee 5983 microtari, settlement at epoch 13165, and the receipt
  was issued, tx
  da2e491da26c1923513f35ccdbec79aeb1d9e1100106fe4d4b3f461bc5145503,
  fee 8668 microtari. The losing bond was returned, seller2 tx
  cf2f72e2747a632134245911ba50aa45fceb2d0a2e45f57b8941c8889558dad6,
  fee 5947 microtari. The circle collected the 5 tari refund, tx
  c7df19591c933cc08599feee588c3aa8ca602a6319faebe56fb0a5b11fb37a5b,
  fee 6713 microtari, so the escrow is empty with the full 20 tari
  accounted for, 15 paid plus 5 refunded. The circle's
  collect-forfeits call was rejected, tx
  83f4137fe19c6d3d8eb82bd61c01d81caf39faa5c1bcfda360e10bd7db47a678,
  fee 3850 microtari: Template error, no forfeits for the circle.
  That is the correct answer here, since both bids were revealed
  and nothing was forfeited. The winner's 2 tari bond sits in the
  bond vault in Returnable state. The season flow claims the
  losing bonds but has no step that claims the winner's bond back,
  so it stays claimable by the winner.
- Verifier: 13 of 13 checks pass.

### Tender 4, expiry test

- Tender: component_8997a6b77d91deb9e9d6703fd3e3cc173ab4eec5ba2dedd0b22cf53b3312789a
- What it proves: a tender nobody completes expires and returns
  the whole escrow to the circle, and the unrevealed seller gets
  the bond back in full, because no sale happened.
- Bids committed: one, at 12 tari, which will never be revealed.
- Outcome: expired. The tender expired with no valid reveal
  (state expired_no_valid_reveal). Expire tx
  09be918c842d22d10834dbb54e148b253b92ba66e340d5496849a44c38ecaf31,
  fee 4333 microtari. The circle collected the full refund of the
  20 tari escrow, tx
  d2154ca5f2aa1a5c90854502e6765fc32bf6a947659bbd61a6828a34a956d4f9,
  fee 5753 microtari. The unrevealed bid's 2 tari bond was
  returnable, not forfeited, so the circle's collect-forfeits call
  was rejected, tx
  866fb5f8d3dfc3ceb2ea18130a4f824c370bd047ba52cf4b847f71b7ff63b169,
  fee 3712 microtari: Template error, no forfeits for the circle.
  The seller then claimed the bond back in full, tx
  a44041b76f6178257fb4722dadb4691c2aacfdee933120b9549a03fcd447597c,
  fee 4985 microtari, and the bond state reads Returned. The
  season plan had expected the unrevealed bond to split as usual;
  that expectation was wrong. On expiry with no valid reveal the
  bond is returned whole, which is the fair outcome for a sale
  that never happened.
- Verifier: 10 of 10 checks pass. The first run passed 9 of 10
  with the template code hash check timing out on the read; it
  passed on re-run.

## Sapient cold run (builder-run, 2026-11-18)

The shipped app run end to end by a human wallet user in his own
browser. Builder evidence, not independent adoption. The app
verify page passed the gate tender 13 of 13 in the builder's
browser. The run found
three app defects, each fixed and shipped the same day: a
first-visit crash in the watch list, no lock action outside the
create flow, and no approver-change proposal form. A first lock was
rejected on chain because a one-approver circle cannot satisfy
the dispute threshold rule. The builder's own circle
component_4a4a7aee7a9af6f55c8b54da1e3f1405c13ba13364792d96c2170c3bbe5377a8
now has two approvers, and its tender
component_be42cefe86871834d94c7330fd105d198edd7c438b09033ad1aca19b84f2d4a2
was locked at epoch 13186 with 2 tari escrow and a 0.5 tari bond
held. The builder's 1.5 tari bid was revealed at epoch 13187 and
verified on chain, price 1,500,000 microtari, valid. Close reveal
ran in the builder's browser at epoch 13189 and the tender is
now Awarded to the builder's key at 1,500,000 microtari, with 1
commitment and 1 reveal counted, verified on chain. The override
deadline was epoch 13190, so advance delivery opened at epoch
13191. Advance delivery and confirm delivery both ran in the
builder's browser at epoch 13191, and the tender is Settled,
verified on chain: settlement winner the builder's key, price
1,500,000 microtari, settlement epoch
13191. Claim payment then landed at epoch 13192, transaction
f53dedea37acf061cffb963202ca3bf4b9fe726c4b43bc0aa2e144f4ca09e4b4,
fee 4,703 microtari, and payout claimed is verified true on
chain, with the escrow down to the 500,000 microtari refund.
The remaining claims landed on 2026-11-23. Claim receipt and
claim bond ran through the app in the builder's browser, and
the builder collected the escrow refund into the circle
treasury himself, 2 tari to 2.5 tari, the treasury balance confirmed
live from the Esmeralda indexer. The standalone verifier then
read the tender at escrow 0 with 2,000,000 paid out of the
2,000,000 cap and the bond vault at 0 with returnable 0, 12 of
13 checks passed, the one could-not-read unchanged: the reveal
recomputation, whose transaction body the indexers have
pruned. The app displayed no transaction id for the receipt
claim; one new transaction id,
b06c59fab7f1cad5daf25cb4c9530a21a67ddcfb89b8ca30588051fb0e7488d9,
appeared in the app's list after the bond claim. The run is
complete.
A fourth app defect found by the run, no threshold validation at
tender creation, was fixed and shipped the same day,
with 48 app tests passing.

## Season, part 2: scale tender (complete, builder-run, 2026-11-20)

Builder-run evidence, ours, not independent adoption. The
ten-seller scale tender on the Uyo Provisions Circle, driven by
an automated runner, launched 2026-11-20.

- Tender: component_d4542df584b5e5682d36c28f39b17c97994eaf4544623b91e7d8fe5b928a8fcc
- Circle: component_a1dec38cf9e72a702eed7665730507928b10b823750a72f81a6a5c89a66c6181
- Template: template_ad7e4c4b5d19f0bc4c9a22d3dd52d73ad5e2d374d7c79361558d338919ccfbf2
- What it proves: the full lifecycle at ten sellers, ten reveals,
  close reveal, advance delivery, two delivery confirmations,
  winner payment and receipt claims, nine loser bond claims, and
  refund collection.
- Lifecycle: 26 of 27 steps completed. The 27th step,
  collect-forfeits, was rejected on chain, tx
  e929f1fce8139c1d488566426fc76f9ea973977dcea8529b1481887444fbc268,
  because every bid was revealed, so there were no forfeits to
  collect. That is the expected ending, recorded exactly as it was
  for all four part 1 season tenders. The run log recorded the
  step as failed, "collect-forfeits", and the run finished at
  10:48:00Z.
- Outcome: Settled. Ten commitments, ten reveals, all ten reveals
  recompute to their commitments. Award 11,000,000 microtari at
  counter 1, the lowest valid revealed price. Close reveal, tx
  ac59c9394aa10e2b51051c0809762387710dabcd68d8d1ab7be4084e912a775e,
  fee 6490 microtari. Advance delivery, tx
  cf1656a7118d7ea6d789e5933f3dcaea4ec5b7af9cc5e2de6fc49cedb23ede24,
  fee 6514 microtari. Two delivery confirmations, threshold 2.
  Winner paid 11 tari, tx
  33e3733b8ec7c01bcc1dc11059d5176b96da81c565cd988122900198353d16c9,
  fee 7497 microtari, settlement at epoch 13259, and the receipt
  was issued, tx
  1e5a977c1f0148a645119552478c9569abdf2eeeb78aff0228dedc08062be02a,
  fee 10253 microtari. All nine losing bonds were claimed back,
  the last two, seller9 tx
  0ccb4b2f6e83e910db8caf6180091e3b3e5d9a467de671eaec3c0909b62b48f6,
  fee 7412 microtari, and seller10 tx
  cabdcfca9b78b615c077274d93ee693af1ba937f80fef09d7e6815652edb9b48,
  fee 7412 microtari. The circle collected the escrow refund, tx
  3376143e38889e95f35d59bb1267dd24c11cd25a5d743d333108b60de4dcef5d,
  fee 8189 microtari. Escrow 0 plus 20,000,000 paid out of a
  20,000,000 cap. Bond vault reconciles: 2,000,000, expected
  2,000,000 from held 0, returnable 2,000,000, locked 0. Forfeit
  split recorded: 0 forfeited bonds, locked 0, for the circle 0.
- Fees: 179,326 microtari in total, or 0.179326 tari, summed from
  the 26 fee lines in the run log.
  This subtotal covers only the fees written in the outcome
  record; setup, registration, locking, and bid commitment fees
  are recorded separately, not here.
- Verifier: the standalone verifier, python3
  scripts/verify.py
  component_d4542df584b5e5682d36c28f39b17c97994eaf4544623b91e7d8fe5b928a8fcc
  --network esmeralda, passed 13 of 13 checks: tender exists,
  state Settled, circle
  component_a1dec38cf9e72a702eed7665730507928b10b823750a72f81a6a5c89a66c6181;
  template binding; template code hash, sha256 of the on-chain
  code is f6cd9585c8a799caafc781450ca5d50496a8412640bb9de587f49049e0fc0803;
  rules hash, recomputed
  c0a2b33019ee0bf34d7fccbc4a836db10b8ca03382475aa2ad9c5240f0cf0910;
  escrow funding, escrow 0 plus paid out 20000000 of cap
  20000000; record counts, 10 commitments, 10 reveals; reveals
  verify against commitments, all 10 reveals recompute to their
  commitments; award is the lowest valid revealed price, award
  11000000 at counter 1, best valid reveal 11000000; award counts,
  award records 10 commitments and 10 reveals; settlement equals
  the award, settled 11000000 at epoch 13259, winner matches the
  award; delivery confirmed or dispute resolved, 2 delivery
  confirmations, threshold 2; bond vault reconciles, vault
  2000000, expected 2000000 from held 0, returnable 2000000,
  locked 0; forfeit split recorded, 0 forfeited bonds, locked 0,
  for the circle 0. No could-not-read rows.

## Season, part 2: attack tender

One tender attacked inside its own windows: wrong-salt and
wrong-identity reveals, a repeated reveal, a duplicate commitment,
an override with no rationale, a lone approver's signature, an
override naming a bid nobody revealed, and money claims by the
wrong accounts. This run was carried out on mainnet rather than
Esmeralda, so no Esmeralda attack record follows; the full
record, every attempt and the chain's answer verbatim, is the
attack test section of the mainnet evidence document shipped
beside this one.
