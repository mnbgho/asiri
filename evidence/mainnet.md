# Asiri evidence, Mainnet season

Every claim in this file can be re-checked by anyone. Records are
read from the public Mainnet indexer at
https://indexer-a.ootle.tari.com, the templates are the ones
pinned in the app config and in scripts/verify.py, and the
standalone verifier is run against each tender as it settles.
Amounts are in tari (1 tari = 1,000,000
microtari).

Templates, Mainnet:

- Circle: template_b86a46241753b8b8e4c2e9571c0db727925d77e1274009175e4f0b0e18cf466b
- Tender: template_267d1d73da73ec990e8711e492bccb9112076051d396922bdef2b9d667c684eb

The code hashes the Mainnet network stored (sha256 of the WASM
extracted from the Mainnet template substates) are
72c9bb84c7e77b2cdc724a5619aed6dd5c5be71d1bea9eb685b2bab5e0d4609c
for the circle template and
ff672fdced3cccd2c7c7649b4b6107322872ff83d2a347c8a1a30a5461f531e9
for the tender template. They differ from the Esmeralda stored
hashes because the network recompiled the code at publish time;
the bytes submitted were the exact Esmeralda template bytes and
the template interface is identical. Before any tender existed,
the standalone verifier's new Mainnet config was proven against
the chain: it reads the Heartland circle from the Mainnet
indexer, the circle's template binding matches the configured
circle template, and both extracted code hashes match the
configured hashes.

Circle: Heartland Provisions Circle,
component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71,
approvers operator, second, and third, threshold 2, treasury
funded with 50 tari. The circle's creation and the season
accounts are recorded in the season setup record. Ahead of the
season locks, the operator revealed a further 110 tari of its
confidential balance, tx
5c111aa0407845a5017b4e8b9e01a5aef43c8b3f2e06d407653d2b7335e37b0d,
fee 100,000 microtari, because each lock escrows the 20 tari
budget cap from the operator's revealed balance while
settlement refunds land in the circle treasury.

Season rules, every tender unless a section says otherwise:
cap 20 tari, bond 2 tari, windows 2/2/1/2/2/2 epochs (bid,
reveal, override, delivery, claim grace, dispute), approval
threshold 2, dispute threshold 3. Mainnet epochs are about 20
minutes.

## Tender 1, Gate test (Settled)

- Tender: component_84e25948c447c3ee437e783fc29b4bfebf18fb2cc1bee1c0ed41598113ad37f2
- Circle: Heartland Provisions Circle,
  component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71
- What it proves: The full lifecycle on Mainnet. A bid nobody
  reveals stays sealed and cannot win, its bond splits, half to
  the circle and half locked in the tender's bond vault
  unspendable, and the winner is provably the lowest revealed
  bid under the locked rules.
- Setup: Created tx
  7b14b63722fb713921a4076269981c3dad810f2a3c3892cd859642e65a84f3e6,
  fee 4591 microtari, registered tx
  6901e6a184ac3ee50ae73c8964693c3e0c936d93f64978e4f350b454f53fa28b,
  fee 5440 microtari, and locked at epoch 39213 with the 20 tari
  escrow, tx
  3a20d2c72cc6d634d2b460b478b2779b49a707169455a214a9114aca93c7f1f0,
  fee 4614 microtari. Three bids committed: seller1 tx
  95449ac1b46ea65a6cd627e221a5116d4d1800753dd799ba4ecbbab9ebc3e5e0,
  fee 4710 microtari, seller2 tx
  1ac6d78aaa71b8efcd2499b6bbda4f1d3f1763e4c836313000fafe11c6bb29a2,
  fee 4812 microtari, and third tx
  ad50019c2c25862698b9b74984de81160356ef9b7a6160cf747a70e1006225be,
  fee 4914 microtari.
- Outcome: Settled. The 12 tari bid was never revealed and could
  not win. Revealed bids: seller1 at 15 tari, tx
  1e668b5ef3fb49d68b146e0482bbbf836bb0463df99765cf45c810a767b2c60d,
  fee 4429 microtari, and seller2 at 17.5 tari, tx
  7a1391c2a2b00b5d83d3c5adc9b8496a728ba7a29b0a65109abb53409159ecd9,
  fee 4356 microtari, both in the reveal epoch 39216.
  Close-reveal set the award at 15 tari to seller1, tx
  6be372bd5a38ec5602eb88e9f251f21924546339b6ec23d7d2a66d1217e25e30,
  fee 4365 microtari. Delivery was advanced, tx
  a7841d973c15f47791f5953095515495abed873a1b9d52b3d7d62cd13fd19219,
  fee 4391 microtari, and confirmed by two approvers, tx
  0fb91268498f8f6b98aad2b013a1e3f8ae307daeddb5adb006c9f5b5ca5f4b72,
  fee 4264 microtari, and tx
  c83ac332477e01be53269bcd2f032f95ab19dded9a6c180eb2cd10ed9e7955d0,
  fee 4556 microtari. The winner was paid 15 tari, tx
  45886c909cc1734762f7e074fc89f05aa9aee949ae34e350881f7a3ccfb63da3,
  fee 5177 microtari, settlement at epoch 39218, and the receipt
  was issued, tx
  653b415331b55bacd3595ec1b925538bbf5ea2245ab81da5482238367ed39398,
  fee 7649 microtari. The losing bond was returned, seller2 tx
  1a19bb7e1f00a9fa2b5789760967445f0081f825917ee99fcef0d9b845c8615d,
  fee 5282 microtari. The circle collected the 5 tari refund, tx
  10aec82e3bd242793473758e9cf8134e3667e11a77896079ad67ee23e507558e,
  fee 5981 microtari, and the 1 tari forfeit share of the
  unrevealed bid's bond, tx
  5248015b63817a31bd1820766df32d004f475806316101aa42c1b053a5c1698e,
  fee 5985 microtari, so the escrow is empty with the full 20
  tari accounted for, 15 paid plus 5 refunded.
- Final state: The bond vault holds exactly 3 tari, the winner's
  2 tari bond in Returnable state, which the season flow leaves
  claimable by the winner as on Esmeralda, plus 1 tari, the
  locked forfeit half of the unrevealed bid's bond, which stays
  there unspendable.
- Fees: 85,516 microtari in total, 29,081 in setup and 56,435
  across the lifecycle, summed from the fee lines above.
- Verifier: 13 of 13 checks pass in the standalone script,
  including all 2 reveals recomputing to their commitments, the
  award at 15,000,000 as the lowest valid revealed price, and
  the forfeit split recorded as 1 forfeited bond, 1,000,000
  locked, 1,000,000 for the circle. The app's verifier, run
  headlessly against the same tender, also passes 13 of 13 with
  the same readings.

## Tender 2, Tie test (Settled)

- Tender: component_7acad78ae79b82e4b13dfcba2191009714dc6091a0cc8c8b6aef64824b81e73b
- Circle: Heartland Provisions Circle,
  component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71
- What it proves: Two sellers revealed the same lowest price
  and the tie broke by commitment order. The earlier
  commitment, counter 1, won at the tied price, the tied loser
  was not penalised, and every bond came back because every
  bid was revealed.
- Setup: Created tx
  6b33a9fa7a63b766ad3bedb29f68ec36d681e6a6b457777e45f875b7c424f6ce,
  fee 4680 microtari, registered tx
  47fa31391a80ec52e630cf5ff59a43cc439d58a62aa57b1b66dd322c1b9e9bc6,
  fee 5575 microtari, and locked at epoch 39218 with the 20
  tari escrow, tx
  fa61db06f262f2c755a528aeb03705d58cffe0afd7429c51d4196b0a0d2b7977,
  fee 4703 microtari. Three bids committed: seller1 tx
  16fe2d96f26ce62f688ac877ede4f171758a263b0f02c4f7e31216904988f953,
  fee 4838 microtari, seller2 tx
  3c5d0d2a60d1fa3eaaeabc5d8bedb6082208a8cde891f621e1f3abe7b24088e6,
  fee 4901 microtari, and third tx
  f924c44f20f48ae424b807c796a426f46f612bbe728e8868a78e4b4d9d77e4a5,
  fee 5003 microtari.
- Outcome: Settled. All three bids revealed in epoch 39221:
  seller1 at 14 tari, tx
  95441444b303638029bc7ef3262af3f87452c5e481603ad3f20bcc8158e054d4,
  fee 4548 microtari, seller2 at 14 tari, tx
  e04e14616fb9acf30a0da58d087673c247400205e0c4f27d365433e1b668ebe3,
  fee 4444 microtari, and third at 16 tari, tx
  873a633d1249393ff455e223617e3834cc3107c2e5dd661c644934c8b499730c,
  fee 4546 microtari. Close-reveal set the award at 14 tari to
  seller1, the counter 1 commitment, tx
  e97c1bc7dea6287bf89340e7527a9fefdd73db5f743a315fb82a244fd6c25774,
  fee 4548 microtari, at epoch 39222. The first
  advance-delivery attempt, tx
  3e11a1f823fe2e3a7257727f7cd8437e92089259b698f95ee56facb1e0b7c70e,
  fee 2497 microtari, executed at epoch 39222, one epoch
  before the override deadline of 39223, and the chain
  rejected it with "the override window is still open". The
  same call was accepted once the deadline had passed, tx
  6a5344b02c172cc0ddc4c6b46c866f2d3450457e810ad2ed6c18fd2c9a2be4ea,
  fee 4573 microtari, and delivery was confirmed by two
  approvers, tx
  a6e7310c35b92e81ebec4585cc696d598540e6ee90877c45ed9076c3afdf1c1b,
  fee 4447 microtari, and tx
  9365f76ffd0d3d4c1f6c17d6e73939ea63157e11506fd86d66838d4de84d87f2,
  fee 4737 microtari. The winner was paid 14 tari, tx
  f082e30b1d38819bab83fe3e2f6edcfec1df132b59f27793d759c6a106853b8e,
  fee 5407 microtari, settlement at epoch 39223, and the
  receipt was issued, tx
  a401401b0372b676f380377f84abcd88311c7ff80c6b31efdf1a66be51253f80,
  fee 7949 microtari. Both losing bonds were returned:
  seller2 tx
  0cd03763f704293478e1bfe013a12f7b08977828f0daec6fad164a487474f961,
  fee 5464 microtari, and third tx
  1d31beafe053326a50493a8b98c59f5999b148bb17beadbd061eb7f431813524,
  fee 5465 microtari. The circle collected the 6 tari refund,
  tx
  d745f5c84f95efcaaa47bc9cc8830c7caa38c1f30bb826e425bb7631edbf754a,
  fee 6173 microtari, so the escrow is empty with the full 20
  tari accounted for, 14 paid plus 6 refunded. A
  collect-forfeits attempt, tx
  cdbc56b0fd7c26a6eeef75f0b93673598dd3911051fab067ea384e48d587115d,
  fee 3387 microtari, was rejected with "no forfeits for the
  circle", the expected ending: every bid was revealed, so no
  bond was forfeitable.
- Final state: The bond vault holds exactly 2 tari, the
  winner's 2 tari bond in Returnable state, which the season
  flow leaves claimable by the winner as on Esmeralda and as
  on the gate tender. Nothing is locked and nothing was
  forfeited.
- Fees: 97,885 microtari in total, 29,700 in setup and 68,185
  across the lifecycle, including the two rejected attempts
  above, whose fees the chain kept, summed from the fee lines
  above.
- Verifier: 13 of 13 checks pass in the standalone script,
  including all 3 reveals recomputing to their commitments,
  the award at 14,000,000 as the lowest valid revealed price
  with the tie broken at counter 1, and the bond vault
  reconciling at 2,000,000 returnable with 0 forfeited. The
  app's verifier, run headlessly against the same tender,
  also passes 13 of 13 with the same readings.

## Tender 3, Override test (Settled)

- Tender: component_c674fd9f80f02a03c24d4a137aa2e5f72ddad382e83428eacd7afcc29344e593
- Circle: Heartland Provisions Circle,
  component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71
- What it proves: The lowest revealed bid does not have to
  win when the circle overrides in the open. The override is
  public, needs threshold approval, carries a rationale hash
  on chain whose published text anyone can check, and can
  only choose among revealed bids. Here it chose the higher
  revealed bid and paid exactly that price, 2 tari above the
  proven lowest revealed bid.
- Setup: Created tx
  d6f79e7b2a37ed42f751f11c7a5e2205ca08266e47c4e52935b896a594df09ea,
  fee 4770 microtari, registered tx
  501bf09b8a555ad9aa49a4affa9f5214f9ef2b0b8678088b2e61021304ac86c0,
  fee 5710 microtari, and locked at epoch 39223 with the 20
  tari escrow, tx
  925b259771aac9f7ac708d4c602f819cc7fc630c756ac39578db67f7609a5d4b,
  fee 4792 microtari. Two bids committed: seller2 tx
  a509a3d489ba82058c70f9523d2243acb649b54cdccd0edd18de0459d58a1597,
  fee 4889 microtari, and seller1 tx
  ef3566e66251ae507e4d0ee9ee9522b2ca6ff0f820f73e37819242692f166793,
  fee 5070 microtari.
- Outcome: Settled. Both bids revealed in epoch 39226:
  seller2 at 14 tari, tx
  96d20c399436d375cea01b4bb51220f8e0910a8ab01a91b258a073e08bdd3afa,
  fee 4507 microtari, and seller1 at 16 tari, tx
  176ea196486d79be944854271dd44ac816f9d1be401e936b597ad4a9eda712ab,
  fee 4490 microtari. Close-reveal set the provisional award
  at 14 tari to seller2, the lowest revealed bid, tx
  73f51f1ff728999142e0b32577faa5e24660459d2f460350a0901bbb906b1e70,
  fee 4433 microtari, at epoch 39227. Inside the override
  window the circle proposed awarding seller1 at 16 tari
  instead, tx
  111aa8ff3dc8beef5dfbf5ecec3191f86f2aee049c9bc5a4f068cb6c6ba67f8d,
  fee 4381 microtari, and two approvers signed the proposal,
  operator tx
  d45884413c36f7863d70e581651f9aef4d1a5b30ae1a7325f10af0be08563a50,
  fee 4423 microtari, and second tx
  5a86d9f9e4c788441fc30dc0b99d3ce704cca53fe580f38ae38074eb92a301d5,
  fee 4752 microtari, meeting the threshold of 2. The
  rationale recorded on chain hashes to
  7a6785a6ceafc693884d01fb8447058dab6034f43824af38d7cabba77677f7f4;
  the published text says the low bid came from a seller who
  had not delivered for this circle before, and the circle
  traded price for seller1's proven delivery record on the
  gate tender. Delivery was advanced, tx
  c00da841e2247e105f34dbb076728c62b52df4ef24086f4d9f78c4fc0b4b9f46,
  fee 4715 microtari, and confirmed by two approvers, tx
  739b77f60da523f89186f2e06fc6f34eb98a90288a5ca45eaa4dae7933ce8875,
  fee 4589 microtari, and tx
  20646dd230a69cbe06d39190e2b9eb46debd237387b201519017f4f30c65e077,
  fee 4880 microtari. The winner was paid 16 tari, tx
  8063b581847581dc2733171d8627de15fc4e991f35b1a160b82179d75f918f7c,
  fee 5596 microtari, settlement at epoch 39228, and the
  receipt was issued, tx
  74b3a3bab3b9aadb73d3e355ce5fb5a34e6dac031a01e14cff17a4f11b8544b6,
  fee 8213 microtari. The losing bond was returned, seller2
  tx
  e68c618df72f7a5c7d7791acb7789f271a24a1b7b8412450f0ef82819c4bd8b6,
  fee 5608 microtari. The circle collected the 4 tari
  refund, tx
  01bf5e743635857b5a51c1089d556740203c00ca344fccd6328ae5b5e8c7d1b3,
  fee 6325 microtari, so the escrow is empty with the full
  20 tari accounted for, 16 paid plus 4 refunded. A
  collect-forfeits attempt, tx
  c824bbaf16e5a72517688502f7543415e902ddee226e73f40c7469a5e7be56fa,
  fee 3482 microtari, was rejected with "no forfeits for the
  circle", the expected ending: every bid was revealed, so
  no bond was forfeitable.
- Final state: The bond vault holds exactly 2 tari, the
  winner's 2 tari bond in Returnable state, which the season
  flow leaves claimable by the winner as on the gate and tie
  tenders. Nothing is locked and nothing was forfeited.
- Fees: 95,625 microtari in total, 25,231 in setup and
  70,394 across the lifecycle, including the rejected
  collect-forfeits attempt, whose fee the chain kept, summed
  from the fee lines above.
- Verifier: 15 of 15 checks pass in the standalone script,
  including both reveals recomputing to their commitments,
  the override proposal signed by 2 approvers at threshold
  2 with the award following the override choice, the
  chosen bid a valid revealed bid at 16,000,000, the
  rationale text hashing to the recorded value, and the
  settlement of 16,000,000 at epoch 39228 matching the
  award. The app's verifier, run headlessly against the
  same tender, also passes 15 of 15 with the same readings.

## Tender 4, Dispute test (Settled)

- Tender: component_78fa0f9830f846f9f865b4e27133781cb716aab4d937ad79c64467ba90b38e11
- Circle: Heartland Provisions Circle,
  component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71
- What it proves: When delivery is not confirmed, the
  winner can raise a dispute inside the claim window with
  an evidence hash on chain, and a higher threshold of
  approvers than the usual award threshold, 3 against 2,
  decides it. Here all three approvers resolved the dispute
  for the winner and the winner was paid in full.
- Setup: Created tx
  aa5f9ad0660b19cc66290fcb5866ed1f802c7069b1f12497cec36b1f48fa0180,
  fee 4861 microtari, registered tx
  11208988b23b64e081642d66ce7419bd8f47d9245b13f9860b575dccf61b4508,
  fee 5847 microtari, and locked at epoch 39228 with the 20
  tari escrow, tx
  b5b31605c45ef031437f49be2c64d3d7a8634138b43e93a91602d0e44239071d,
  fee 4883 microtari. Two bids committed: seller1 tx
  0db26d4dee4b1b3d6a31154052e4c47b0f9b97b60e4ef56ee6c0867c830102b2,
  fee 5099 microtari, and seller2 tx
  764d82ee0bc2be3b0dcc4bfae3c23c1b97aef9f4d504a9f38aaeeead889be29f,
  fee 5081 microtari.
- Outcome: Settled. Both bids revealed in epoch 39231:
  seller1 at 15 tari, tx
  6096587f3cae297e08c76497abe73f950994ee1e65c3990540b5f35db361e308,
  fee 4684 microtari, and seller2 at 17.5 tari, tx
  ad93ad8e3ebab1ca0b01178d8a65e937c6280d146939fbb07ddd8419c3ca1e39,
  fee 4523 microtari. Close-reveal set the award at 15 tari
  to seller1, tx
  1711759e4046df6bf540af6015017a5e9e04c290c906264cdf885fb5f9b300a9,
  fee 4524 microtari, at epoch 39232. Delivery was
  advanced, tx
  1065df0f18b3ca5f49906dd2d0e390b3d947e0230d045c586c36359e3b3a6692,
  fee 4550 microtari, at epoch 39233, and no delivery
  confirmation came. After the delivery deadline passed,
  seller1 claimed a dispute inside the claim window, tx
  603ec7a9ffeb05e9abdb6d917f3d1d29eab44b5ee02e21929049b5682e469d72,
  fee 4699 microtari, at epoch 39235, with the evidence
  hash
  67ba00860d59c1205adde2e7e724fe039124e68df9d122b14a7794f4951c86bb
  recorded in the claim. All three approvers resolved the
  dispute for the winner: operator tx
  fff24b909eec18f7050ca64a21a041e2117b72f2ce580e95dc99aa68384a76b8,
  fee 4519 microtari, second tx
  95cdc5bb41d92bf3f67c1ee92600075222ece210ec580b56165a9fdcd6de9f22,
  fee 4605 microtari, and third tx
  08de4286905f663fa980cce270d629ffaa2caaa02cf57ffa8ae12e11d396ce86,
  fee 4981 microtari, meeting the dispute threshold of 3.
  The winner was paid 15 tari, tx
  d199d66ab4c46ba63efdb1208f099e41aff5046d7e8392a3296eb03a1c095e97,
  fee 5747 microtari, settlement at epoch 39235, and the
  receipt was issued, tx
  c2fcaa2688413b2001789ea535fca557be0eb3c53b2f1852d5de2d0a04b55c66,
  fee 8435 microtari. The losing bond was returned, seller2
  tx
  a7c502d3b1430dea68d3e5ad2f8cd1319439cba1160956f6c74c5736bb9703e7,
  fee 5710 microtari. The circle collected the 5 tari
  refund, tx
  c6c9a3c5564d2c7ab35e74f166d63fe0ba287fc85843d1e9bb87b6316ce3eef8,
  fee 6438 microtari, so the escrow is empty with the full
  20 tari accounted for, 15 paid plus 5 refunded. A
  collect-forfeits attempt, tx
  f1074279a30ae0912a7bf77689430262f6324a7dbf54d3488eacb5640d1106ea,
  fee 3581 microtari, was rejected with "no forfeits for the
  circle", the expected ending: every bid was revealed, so
  no bond was forfeitable.
- Final state: The bond vault holds exactly 2 tari, the
  winner's 2 tari bond in Returnable state, which the season
  flow leaves claimable by the winner as on the earlier
  tenders. Nothing is locked and nothing was forfeited.
- Fees: 92,767 microtari in total, 25,771 in setup and
  66,996 across the lifecycle, including the rejected
  collect-forfeits attempt, whose fee the chain kept, summed
  from the fee lines above.
- Verifier: 13 of 13 checks pass in the standalone script,
  including both reveals recomputing to their commitments,
  the award at 15,000,000 as the lowest valid revealed
  price, and the settlement of 15,000,000 at epoch 39235
  recorded as settled through a dispute resolved for the
  winner with no delivery confirmations. The app's
  verifier, run headlessly against the same tender, also
  passes 13 of 13 with the same readings.

## Tender 5, Expiry test (Expired)

- Tender: component_96bcddd81d62af245144ebcff5fcccdcb96a69df880728f90df15bffdaae571c
- Circle: Heartland Provisions Circle,
  component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71
- What it proves: A tender that gets no valid reveal
  expires cleanly. The full escrow returns to the circle,
  and the unrevealed bid's bond comes back whole instead of
  splitting, the expiry exception to the forfeit rule that
  the gate tender shows.
- Setup: Created tx
  1b8a10f6815f103d3275669d418ddd2cf3d48dbc250de0bccd7a7e77a97f5ff7,
  fee 4951 microtari, registered tx
  f93331d4649609ff0ba2754026a49016a8562a088f08d44aba35cf8cb051d259,
  fee 5983 microtari, and locked at epoch 39236 with the 20
  tari escrow, tx
  f7db3392d1448c8ccac0498066355d6453ece904ea556828402195f039f49aec,
  fee 4974 microtari. One bid committed: third at 12 tari,
  tx
  8819cf05958d343c66b57830b4e95e82f0c3701cd3d982697aea9aef0e15ddcb,
  fee 5071 microtari. It was never revealed.
- Outcome: Expired. The reveal window closed with no
  reveals and the tender was expired at epoch 39240, tx
  1ccea3c07027f88bce62da8875c59b58706f8f4ff1cac68038636fd4703ff6e7,
  fee 4231 microtari. The circle collected the full 20
  tari refund, tx
  6013aeb7cf9244436d600e087f93989036befa08e20d76a94968eb789858bb5b,
  fee 5616 microtari, so the escrow is empty with nothing
  paid out. A collect-forfeits attempt, tx
  2f2fedbf749dfa6a265328395564ccf7777f375438bca379e0358dc7404eae8d,
  fee 3577 microtari, was rejected with "no forfeits for
  the circle", the expected ending on expiry: the
  unrevealed bond is returnable whole instead of split.
  Third claimed its 2 tari bond back whole, tx
  89fcd8448c8929a0078455e9a4ec5b0fc7100c81f7f7635d20c2a1a98c8112f5,
  fee 4874 microtari.
- Final state: The bond vault is empty and the escrow is
  empty. Nothing is locked and nothing was forfeited.
- Fees: 39,277 microtari in total, 20,979 in setup and
  18,298 across the lifecycle, including the rejected
  collect-forfeits attempt, whose fee the chain kept,
  summed from the fee lines above.
- Verifier: 10 of 10 checks pass in the standalone script,
  including the expired state, 1 commitment and 0 reveals,
  no award, and the bond vault reconciling at zero. The
  app's verifier, run headlessly against the same tender,
  also passes 10 of 10 with the same readings.

## Tender 6, Scale test (Settled)

- Tender: component_034c69f5ac0c9dd7bdb5cf15433d885f17f4781fb9d20df49f426134d38621ee
- Circle: Heartland Provisions Circle,
  component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71
- What it proves: The full flow holds at ten sellers. Ten
  commitments, ten reveals, the lowest revealed price
  wins, all nine losing bonds come back, and the escrow
  accounts exactly.
- Setup: Created tx
  b7cbc521f3291d736cc1b23f9b7e1403b3704cc824300c8ced170b173ce293a0,
  fee 5014 microtari, registered tx
  f8d54b32e6bbdd55dbfa11af1475160bece2eb3fb7e35843ef73a20c0086cfb6,
  fee 6093 microtari, and locked at epoch 39240 with the
  20 tari escrow, tx
  4535094471c71098f674a205fb3ac53653361c84bba3d883bf77d10766ceb1db,
  fee 5037 microtari. Ten bids committed, in order:
  seller1 at 11 tari, tx
  7cc0ff8aaf2697d90aa43f6bb9639b4e20947f172be4189c4509a5d908c820f9,
  fee 5292 microtari; seller2 at 12.5 tari, tx
  ddadda46af5f4f7e754810a05aaf7674160778e5b23d2eeddb740b4120f67059,
  fee 5234 microtari; seller3 at 13.75 tari, tx
  fe858db961c325d9876a9a651c1835654c1b8c01beb3ed848dd9717c285bab8a,
  fee 5337 microtari; seller4 at 14 tari, tx
  e50511c771989a658f6313bcc6790a7e1cce6d1512d60ccdca2c14c0464212ff,
  fee 5440 microtari; seller5 at 15.5 tari, tx
  cba11bc3073c1d7700623181853791adb07acfdf13013e79b8b99510bf2419b4,
  fee 5542 microtari; seller6 at 16 tari, tx
  aa958b78d503d8b1e83184095b06f537ad973d1c2a150dbe6025d6872b7f1e1c,
  fee 5644 microtari; seller7 at 17.25 tari, tx
  72a7dc878058619f40afec9d00305e2307a289b8f609f362a90dff31eee2dd78,
  fee 5746 microtari; seller8 at 18 tari, tx
  9ef00b035eba208434787b0cc101384358da5f7c01eed5d0930a6551f41dd374,
  fee 5849 microtari; seller9 at 19 tari, tx
  f4588641f7bf7398d049fcc134e138f2ddb4b26557f2c0ce7800ceaf515e7ea5,
  fee 5951 microtari; seller10 at 19.75 tari, tx
  fb8e950c76d63ea413391f9f28957528bc6d1f399771f4e556547099fccfdeb4,
  fee 6054 microtari.
- Bids: All ten revealed in epoch 39243. In order:
  seller1 at 11 tari, tx
  9aa9ddaf3632cc075b959d84543db5f8598fd81c27801833cefb89e685e82f1f,
  fee 5684 microtari; seller2 at 12.5 tari, tx
  3ab8332f7ee0df2c7f6b1e770b8efedc4eb113bf9462332bd6a6cc4b003f4e39,
  fee 5495 microtari; seller3 at 13.75 tari, tx
  7c8986f242880ed193027902a381c67be81991b66ad7a1de0785900ec0000eaf,
  fee 5598 microtari; seller4 at 14 tari, tx
  2a0444a432c53a2aff9bffc7958e0750014498eaa5c6171090e5edcacef784ce,
  fee 5699 microtari; seller5 at 15.5 tari, tx
  6242b5b2245690ead6f720ba0dd0dff02a9d0a4b39690b97c217d95a9f347b72,
  fee 5803 microtari; seller6 at 16 tari, tx
  4215acf9512267b2ccb069fb5c9968f5e6760d423f3bbf7f08e962642c9c223e,
  fee 5906 microtari; seller7 at 17.25 tari, tx
  333b8968647bb757b3062fc9cfafbc6dbac1e3d7825857ba92c4164abd24074e,
  fee 6009 microtari; seller8 at 18 tari, tx
  1745f57de157227844468741a228c321b044dc075b5bb8763827ab477102fa5f,
  fee 6110 microtari; seller9 at 19 tari, tx
  d13dc2661b7fd5be47a709bfd69fd45868540809f1b4ff12cae4ef7a11010ca5,
  fee 6215 microtari; seller10 at 19.75 tari, tx
  f40f391a44dbfca070148f5ea169ce12cf55e72b1c7d3151586dd9e3f59acb53,
  fee 6317 microtari. Close-reveal, tx
  7b807d276436046069a3a958e9d08046d0173b236fd2443ac27b8a162a4a4b50,
  fee 6319 microtari at epoch 39244, set the award at 11
  tari to seller1, the lowest of the ten.
- Outcome: Settled. The first advance-delivery attempt,
  tx
  db45bc622fa4be4c60fb86ad76f788b12bca332b3ee946db1aaeaeefbeb827ea,
  fee 2988 microtari, was rejected with "the override
  window is still open": it was submitted as epoch 39245
  opened and executed in epoch 39244, one epoch before the
  override deadline, the same boundary race the tie tender
  hit. The identical step resubmitted inside epoch 39245
  passed, tx
  8687bbb14575089c95f95497cc482a1d24032ac6bb6f06c403cf22d356dedb89,
  fee 6344 microtari. Delivery was confirmed by the
  operator, tx
  c9d20d46c8195ae6cca148d7dfd1a880f9466ba567738b7c0398c1c6f1fa8d63,
  fee 6216 microtari, and by the second approver, tx
  8ee4f5d452bab7c2f848724a7a31d7f880101cf7cb79b700f3ed779c775ddbb4,
  fee 6507 microtari, meeting threshold 2. The winner
  claimed its 11 tari payment, tx
  10d78c799e2957be462a55e2fe9aee184bef34f23b6cc17a154f6b826cb0f781,
  fee 7319 microtari, and settlement was recorded at
  epoch 39245. The winner claimed its receipt, tx
  365e6cac668dd076832cdfd05d12b6d9904d3735943a450f071ff674df71e469,
  fee 10078 microtari. All nine losing sellers claimed
  their 2 tari bonds back, each at a fee of 7235
  microtari: seller2 tx
  2b53aa8854d46ca5fe45bccae8d8c009e323f36e499c1f1ea67bc52803498f1d,
  seller3 tx
  b863623156ebe8315eb9dd402caf8390da8428949367d2f7612447cce46b8627,
  seller4 tx
  5b3273f959400e73b18e747b94916bae2e5a835396070a9f4d09d504baebcaf1,
  seller5 tx
  3429f9c6adbd8a415e46e6b37c481317ec69477bf6d81cd531161ab56ed7e76b,
  seller6 tx
  a6d798277ecfbaae6572e69bcf9d2e85d0dfb23cd95b2bd5b2e98838b2199b1d,
  seller7 tx
  519f41352f386826d3d86dc6579c274ff903e18f16d55a5d5adafebe2b0a258a,
  seller8 tx
  b6dbf6ac92f52e0fb503b73c3308c985955e1d48dd6af60339a58bcf7acd477e,
  seller9 tx
  80a3c19326db8f4193060447a67de649f9081bf2d946b51c8e53c8cb4d3ecd02,
  and seller10 tx
  f275a9dde7b09fac1aee4085b1e300f08ae913434dbc7d32075ac2845711ec27.
  The circle collected the 9 tari refund, tx
  a2e443ae4babdf602fb4d62b2b988df17ace81ee87762e4a02955f9ca7ec613d,
  fee 7982 microtari, so the escrow is fully accounted:
  11 paid out plus 9 refunded of the 20 locked. A
  collect-forfeits attempt, tx
  7661498b596c106a9afd1dfbf62003bc16af3d6e79295a20094e0a7b5d38d3f0,
  fee 3901 microtari, was rejected with "no forfeits for
  the circle", the expected ending: every bid revealed,
  so nothing was forfeited.
- Final state: The bond vault holds 2 tari, the winner's
  bond, returnable to the winner. The escrow is empty.
- Fees: 253,838 microtari in total, 72,233 in setup and
  181,605 across the lifecycle, including both
  advance-delivery attempts and the rejected
  collect-forfeits attempt, whose fees the chain kept,
  summed from the fee lines above.
- Verifier: 13 of 13 checks pass in the standalone script,
  including all 10 reveals recomputing to their
  commitments, the award at the lowest valid revealed
  price of 11 tari, and settlement of 11,000,000
  microtari at epoch 39245 with the winner matching the
  award. The app's verifier, run headlessly against the
  same tender, also passes 13 of 13 with the same
  readings.

## Season closing record

- All six tenders are complete: five settled and one
  expired, each verified in full by both verifiers, the
  standalone script and the app's verifier run headlessly,
  with identical readings. Verifier counts: gate 13 of
  13, tie 13 of 13, override 15 of 15, dispute 13 of 13,
  expiry 10 of 10, scale 13 of 13.
- Fees across the six tenders' own setup and lifecycle
  transactions: gate 85,516 microtari, tie 97,885,
  override 95,625, dispute 92,767, expiry 39,277, scale
  253,838. Total 664,908 microtari, about 0.665 tari, for
  the whole Mainnet season's tender traffic.
- Operator balance at the close, read from the wallet
  daemon after the scale tender settled: 703,503,334
  microtari, 703.503334 tari, of which 19.703306 tari
  revealed and 683.800028 tari confidential. The operator's
  500 tari floor held throughout: the pre-lock readings
  were 763.654111 tari at the mid-season pause, 763.621763
  before the dispute lock, 743.58256 before the expiry
  lock, and 723.553228 before the scale lock, and the
  closing balance sits above the floor.
- Heartland treasury at the close: 100 tari exactly, read
  from the circle's treasury vault on the indexer. That
  is the 50 tari funded at the circle's creation plus 50
  tari the circle collected across the season: the gate
  tender's 5 tari refund and 1 tari forfeit share, the
  tie tender's 6 tari refund, the override tender's 4
  tari refund, the dispute tender's 5 tari refund, the
  expiry tender's full 20 tari refund, and the scale
  tender's 9 tari refund.
- The winner's bond in each settled tender stays in that
  tender's bond vault, returnable to the winner, as each
  tender's own section records. The gate tender's vault
  also holds the 1 tari forfeit half of the unrevealed
  bond, locked and unspendable on the settlement path.

## Tender 7, Attack test (Settled)

- Tender: component_1800c5fbabc963212c38d9a963b11ec689d46401a15bcca21cb6d1f989669c79
- Circle: Heartland Provisions Circle,
  component_46237d52379c5d9289814c67ca840f5fa2aad2b12ed2291acf0e74a5091aca71
- What it proves: The tender's own rules hold against
  direct attack on Mainnet. Every attack below is an
  ordinary call to the tender template, with wrong inputs, wrong timing, or the wrong
  actor, and every one was rejected by the chain, which
  kept the fee. The same tender then finished honestly:
  award to the lowest valid revealed bid, delivery
  confirmed, settled, normal claims.
- Setup: The season rules (cap 20 tari, bond 2 tari,
  windows 2/2/1/2/2/2, approval threshold 2, dispute
  threshold 3). Ahead of the lock the operator revealed a
  further 30 tari of its confidential balance, tx
  75ccacbdaf315afb95159df9d0e22a613a9834e243014f40aba0113989ddf81c,
  fee 100,000 microtari, because the lock escrows the 20
  tari cap from the revealed balance; that reveal fee is
  not counted in this tender's fees, as with the season
  reveal. The operator total read immediately before the
  lock was 703,391,969 microtari, so the operator's 500 tari
  floor held with room. Created tx
  a3a5bc1cdc70f98e46b89340b7862db3c460a53fc6947eb34c7948c1619452af,
  fee 5121 microtari, registered tx
  2b70c168d72a315ad1eddfb0a91e0323cd84468a40f5a97c6dd82ce2558e8620,
  fee 6244 microtari, and locked at epoch 39251 with the
  20 tari escrow, tx
  03cf5ae6006e8f1cad9694abb645adaed70f077faebf90da109f9084e910a080,
  fee 5143 microtari. Deadlines from the lock: bid 39253,
  reveal 39255, override 39256. Three bids committed:
  seller1 at 15 tari, tx
  94bb13f18560a84a2f8136cc4f61d57a77a710383b1766c910aaa5d97491f43c,
  fee 5438 microtari, seller2 at 17.5 tari, tx
  17cdd1378a4785d7ca95bdfa036e642e37b68269acabc03854fa8400c0c1ffca,
  fee 5341 microtari, and third at 12 tari, tx
  c19b13933fd61b61774e9e61addb6e02d8b5a68158472f7e4561f9d481b76f35,
  fee 5443 microtari. Third never revealed, as designed,
  so its bond forfeits.
- Attacks in the bid window, all rejected: A duplicate
  commitment by seller1, tx
  87bffa0f4779ae95126df03ec3865eb4bfd9f9bb5e8b2b6f93b6b1f51de4560d,
  fee 3459 microtari, "seller has already committed in
  this tender"; a commit by seller3 with a 1 tari bond
  against the locked 2 tari bond, tx
  962ab036711327d6037689ff15574d8a781faf1b9ec3cb9b5d04b77e4bd1d330,
  fee 3335 microtari, "bond must equal the locked bond
  amount"; an update_rules call by the operator after the
  lock, tx
  bee46b75d2f03248c0d522df81f3f0714385e1792e63af78ecce8de7f8bb601b,
  fee 2922 microtari, "tender is not a draft".
- Attacks around the reveal window, all rejected: A
  commit by seller2 after the bid deadline, tx
  631ca4318c7277ddcf7e84e8c7af0b185cd7007e3cc236457ccebb82643149f3,
  fee 3234 microtari, "the bid window has closed"; a
  reveal by seller1 with the wrong salt, tx
  60a10aa7229fd4cad1a75299aaf1482ba402111ee5cb547e70dee4f5178a9aba,
  fee 3175 microtari, "no matching commitment for this
  reveal"; a reveal by seller1 with the wrong price, tx
  7b0802c1d15b12a289920e759b6753648f2fd1db38984fd55d4d1806fbdbdb32,
  fee 3176 microtari, the same rejection; a reveal of
  seller1's bid under seller2's identity, tx
  26e3011f424139bc8e4246a73a56c1eb6d036c63d8d143dead979f59ab9d8ce3,
  fee 3033 microtari, the same rejection; a reveal by
  second, an account that never bid, of a bid that was
  never committed, tx
  fbc5cbaf93a3b85e43a54033a3f28876784db3f4c31afc5366ad13f7c4cf08c7,
  fee 3032 microtari, the same rejection; a second reveal
  of seller1's already revealed bid, tx
  e541355b5fd4005e8eed54849692891fa6df6b306d9a9048962ae5c281c86061,
  fee 3197 microtari, the same rejection; and a
  close_reveal call before the reveal deadline, tx
  20fe42bb73d2ed2ce7c34bc25e829854b633d338e95e4b839a1e58a563b68257,
  fee 2917 microtari, "the reveal window is still open".
- Attacks around the override window: An
  advance_delivery call inside the override window, tx
  6068143737e33fa28562ee025b6920a74a040aa67ceff6d16b29143ef21307a1,
  fee 2927 microtari, was rejected with "the override
  window is still open". An override for seller2 was then
  proposed with a real rationale, tx
  d76120354e83f6e2917a70ceeb23d55b8b53204a2383832900fb3ac19cd12a29,
  fee 4844 microtari, and signed by one approver, the
  operator, tx
  0ab0de33ab8a7b9df36a8a96c91b63b5c264c348aca92b5c8dbd28326de64213,
  fee 4886 microtari. One signature is below the circle
  threshold of 2, and a live read straight after showed
  the award unchanged with seller1 and no override
  recorded: the lone signature did not move the award.
  Two further override proposals were rejected: one with
  an all-zero rationale hash, tx
  ff32bc55464d960debe1173f3616784f5f0591511ea5b4af5de5f5b4087addc5,
  fee 2971 microtari, "an override requires a rationale
  hash"; and one choosing third, whose bid was never
  revealed, tx
  1e59db4d01a80077ca11487c0d5c5d3a84565df525bb6632407b2a3bf1dad960,
  fee 2971 microtari, "an override can only choose a
  valid revealed bid". A manual award is impossible by
  construction: the tender template's method list (new,
  bind, update_rules, propose_approver_change,
  approve_approver_change, lock_and_fund, commit_bid,
  reveal_bid, close_reveal, propose_override,
  sign_override, advance_delivery, confirm_delivery,
  claim_dispute, resolve_dispute, expire, claim_payment,
  claim_receipt, release_refund, claim_bond,
  release_forfeits, info) has no award method, and the
  winner is computed inside close_reveal.
- Attacks after settlement, all rejected: A direct
  release_refund call on the tender by the operator, tx
  aeefec707fa063351467cab7b48fc6fe7f12109d0261640eecdc6a661753e716,
  fee 2536 microtari, refused by the component access
  rules, "Access Denied: call component method
  'release_refund' on
  component_1800c5fbabc963212c38d9a963b11ec689d46401a15bcca21cb6d1f989669c79"
  (result code AccessDenied); a claim_payment call by
  the loser seller2, tx
  aed17e80b92965d39123ea342d24e5ca3c327fbb9e26682734b36563938138f2,
  fee 2982 microtari, "only the winning payment identity
  can claim the payment"; a claim_bond call by second,
  which never bid, tx
  d424a503b1cbc53c8c3b132cb65b9d9fa5d37816a7b5e66f97a6d0e69288a5fe,
  fee 2983 microtari, "no returnable bond for this
  seller"; a second claim_payment by the winner seller1,
  tx
  420393863fe169cd63ff82c547c1449ab5610bac240001a8bc7f200b5b1eae74,
  fee 3101 microtari, "payment already claimed"; and a
  second collect of the forfeits by the circle once none
  were left, tx
  32f411f1a039fa9348b46ff37cda0e7763824dbbc518a3860f63dee8d6332bef,
  fee 3860 microtari, "forfeits already claimed by the
  circle". The season tenders separately record the
  no-forfeits-at-all case: their collect-forfeits
  attempts were rejected with "no forfeits for the
  circle".
- Duplicate submissions, recorded plainly: The first
  start command was retried after its output was lost,
  which started a second run process. The small-bond and
  update-rules attacks were
  each submitted a second time before both processes were
  stopped: small bond again, tx
  41630ce81fa181be3fd7f31ada09a7e036710f77a99a60b16de6e39a0b5b272a,
  fee 3335 microtari, and update_rules again, tx
  d70b82caa6dbb649bf4886e8312e34c051fae5a29a5c49f57922140f2a89173c,
  fee 2922 microtari, both rejected with the same
  messages as the first submissions. No state changed in
  that window: every submission in it was a rejection.
  The run then continued as a single process. No attack
  was ever resubmitted by the run itself, and no
  honest step needed a boundary-race resubmission in this
  run.
- Honest lifecycle: Seller1 revealed, tx
  dc607b93a1b9a112c4a069815d9de0749a03a51f16afbcf5422c8ffa4c7f87d1,
  fee 5105 microtari, and seller2 revealed, tx
  6492e2b0553a0f66c730234cfe32d1d2ab52402b62c3be5c2925305ed84ed3ae,
  fee 4886 microtari. The operator closed the reveal
  window at epoch 39255, tx
  cea98a4653dd4ccf84fcdb3f2b4ec641d12abe5b7db1171df037a19b57c3d7ce,
  fee 4894 microtari, and the template awarded seller1 at
  15 tari, the lowest valid revealed price. Third's 12
  tari bid was never revealed, so it could not win and is
  not counted as a revealed price. After the override
  deadline the operator advanced to delivery, tx
  b802deae51bfef7a107de976af1771375b6adae9b98efc8ac569991f1c9c895c,
  fee 5056 microtari, and delivery was confirmed by the
  operator, tx
  57c363748af5a9e39e43f5e09c19ffe96d7d4a3f89f60c26f514d7d4848be39e,
  fee 4928 microtari, and by second, tx
  4e86180ec50209eeef21cab9054fb6e9af9648a214a0880cc6354feabc26729f,
  fee 5220 microtari, settling the tender at epoch 39256.
  The winner claimed the payment, tx
  57c63f2cb18f715767bc496f7724dbee59a691484aae15ec8e8fcc023e7e3dec,
  fee 6079 microtari, and the receipt, tx
  a61a532049d9f3d70f7f4c2ffd272d6187e37ae5de6843a97dea2c9ce44d06da,
  fee 8910 microtari. The loser claimed its bond back, tx
  ca2ed21884066909d064c69ebfb9543257b98e7b5de902f4816a81827f756428,
  fee 5947 microtari. The circle collected the 5 tari
  refund, tx
  74230ec605183e7860945154ef0f07daee782fd9aa832f9a2a9eb689f9fec5ef,
  fee 6704 microtari, and the 1 tari forfeit share from
  third's unrevealed bond, tx
  691dd6b3bac5d65cbfa3791f0458f54fd7a1c6e17f0b5ebda7d596d0260a8f80,
  fee 6708 microtari.
- Final state: Settled at epoch 39256, 15 tari paid to
  seller1, escrow empty with 20 tari accounted (15 paid
  out plus 5 refunded). The bond vault holds 3 tari: the
  winner's 2 tari bond, returnable to the winner and left
  claimable as in the season flow, plus the 1 tari
  forfeit half of third's bond, locked and unspendable on
  the settlement path. The Heartland treasury, read live
  from its vault after the collects, holds 106 tari: the
  season closing 100 plus this tender's 5 tari refund and
  1 tari forfeit share. Operator balance at the close:
  683,324,780 microtari, 683.324780 tari, of which
  29.624752 tari revealed and 653.700028 tari
  confidential, above the operator's 500 tari floor. That closing
  figure reconciles to the microtari against the
  pre-setup reading: 703,403,334 after the 30 tari reveal,
  less the 20 tari escrow, less the operator's own fees
  of 78,554 microtari across setup and the steps it
  signed.
- Fees: 168,965 microtari in total for this tender,
  32,730 in setup and 136,235 across the run's steps,
  including every attack's kept fee and the two duplicate
  submissions at 3335 and 2922 microtari, summed from the
  fee lines above. The 100,000 microtari reveal fee ahead
  of setup is excluded, as in the season sections.
- Verifier: 13 of 13 checks pass in the standalone
  script, including both reveals recomputing to their
  commitments, the award at the lowest valid revealed
  price of 15 tari, and settlement of 15,000,000
  microtari at epoch 39256 with the winner matching the
  award. The app's verifier, run headlessly against the
  same tender, also passes 13 of 13 with identical
  readings, and neither verifier had a check it could not
  read. The app verifier for this tender was run from a
  single combined bundle of the same unmodified app
  sources, the way the app itself is built, and that same
  bundle reproduces the gate tender's season reading of
  13 of 13 exactly. The canonical receipt for this tender
  is mainnet-attack.json, downloadable from the app's
  results page, sha256
  128a855fa956b4c30f90a09a44ea3c6b5ad8fb5841cecc6bb429098757c00526,
  produced by the standalone verifier with --receipt on
  Mainnet, 13 pass, 0 fail, 0 could not be read.
