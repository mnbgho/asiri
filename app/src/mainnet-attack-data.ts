// The mainnet attack tender's record, generated from the
// evidence record: every value below is parsed from that
// record by the generator, which cross-checks the record
// against the tender's canonical receipt and fails if the
// record's own fee sums do not close. Regenerated whenever
// the record is refreshed.
//
// The record carries the tender's structured facts and the
// attack record: the eighteen attack transactions the chain
// rejected, each with the chain's own rejection wording,
// the two duplicate submissions the transport retried, and
// the override that was proposed and signed below the
// circle's threshold and left the award unchanged. Five
// attacks are recorded in the evidence without naming the
// account that submitted them; those carry actor null
// rather than an invented account. The tender's receipt
// itself is carried in mainnet-receipts-data.ts and offered
// for download under the record.

import type { MainnetTenderRecord } from "./mainnet-results-data";

export interface MainnetAttack {
  key: string;
  name: string;
  actor: string | null;
  tx: string;
  feeMicro: number;
  rejection: string;
}

export interface MainnetAttackDuplicate {
  key: string;
  tx: string;
  feeMicro: number;
}

export interface MainnetAttackOverride {
  chosenAccount: string;
  proposeTx: string;
  proposeFeeMicro: number;
  signer: string;
  signTx: string;
  signFeeMicro: number;
  signatures: number;
  threshold: number;
  awardWinner: string;
}

export interface MainnetAttackSealedBid {
  by: string;
  priceMicro: number;
}

export const MAINNET_ATTACK_RECORD: MainnetTenderRecord = {
  "key": "attack",
  "title": "the attack tender",
  "state": "settled",
  "tender": "component_1800c5fbabc963212c38d9a963b11ec689d46401a15bcca21cb6d1f989669c79",
  "proves": "the tender's own rules hold against direct attack on mainnet. Every attack below is an ordinary call to the tender template from our own season accounts, with wrong inputs, wrong timing, or the wrong actor, and every one was rejected by the chain, which kept the fee. The same tender then finished honestly: award to the lowest valid revealed bid, delivery confirmed, settled, normal claims.",
  "lockEpoch": 39251,
  "closedEpoch": 39256,
  "capMicro": 20000000,
  "paidTo": "seller1",
  "paidMicro": 15000000,
  "refundMicro": 5000000,
  "provenLowestMicro": null,
  "provenLowestBy": null,
  "rationaleHash": null,
  "disputeEvidenceHash": null,
  "feesMicro": 168965,
  "commitments": 3,
  "reveals": 2,
  "standalonePass": 13,
  "standaloneTotal": 13,
  "appPass": 13,
  "appTotal": 13
};

export const MAINNET_ATTACKS: MainnetAttack[] = [
  {"key": "duplicate-commit", "name": "duplicate commitment", "actor": "seller1", "tx": "87bffa0f4779ae95126df03ec3865eb4bfd9f9bb5e8b2b6f93b6b1f51de4560d", "feeMicro": 3459, "rejection": "seller has already committed in this tender"},
  {"key": "small-bond", "name": "commit with too small a bond", "actor": "seller3", "tx": "962ab036711327d6037689ff15574d8a781faf1b9ec3cb9b5d04b77e4bd1d330", "feeMicro": 3335, "rejection": "bond must equal the locked bond amount"},
  {"key": "update-rules", "name": "rewrite the locked rules", "actor": "operator", "tx": "bee46b75d2f03248c0d522df81f3f0714385e1792e63af78ecce8de7f8bb601b", "feeMicro": 2922, "rejection": "tender is not a draft"},
  {"key": "late-commit", "name": "commit after the bid deadline", "actor": "seller2", "tx": "631ca4318c7277ddcf7e84e8c7af0b185cd7007e3cc236457ccebb82643149f3", "feeMicro": 3234, "rejection": "the bid window has closed"},
  {"key": "wrong-salt", "name": "reveal with the wrong salt", "actor": "seller1", "tx": "60a10aa7229fd4cad1a75299aaf1482ba402111ee5cb547e70dee4f5178a9aba", "feeMicro": 3175, "rejection": "no matching commitment for this reveal"},
  {"key": "wrong-price", "name": "reveal with the wrong price", "actor": "seller1", "tx": "7b0802c1d15b12a289920e759b6753648f2fd1db38984fd55d4d1806fbdbdb32", "feeMicro": 3176, "rejection": "no matching commitment for this reveal"},
  {"key": "wrong-identity", "name": "reveal under another seller's identity", "actor": "seller2", "tx": "26e3011f424139bc8e4246a73a56c1eb6d036c63d8d143dead979f59ab9d8ce3", "feeMicro": 3033, "rejection": "no matching commitment for this reveal"},
  {"key": "uncommitted-reveal", "name": "reveal of a bid that was never committed", "actor": "second", "tx": "fbc5cbaf93a3b85e43a54033a3f28876784db3f4c31afc5366ad13f7c4cf08c7", "feeMicro": 3032, "rejection": "no matching commitment for this reveal"},
  {"key": "double-reveal", "name": "the same bid revealed twice", "actor": null, "tx": "e541355b5fd4005e8eed54849692891fa6df6b306d9a9048962ae5c281c86061", "feeMicro": 3197, "rejection": "no matching commitment for this reveal"},
  {"key": "early-close-reveal", "name": "close the reveal window early", "actor": null, "tx": "20fe42bb73d2ed2ce7c34bc25e829854b633d338e95e4b839a1e58a563b68257", "feeMicro": 2917, "rejection": "the reveal window is still open"},
  {"key": "early-advance-delivery", "name": "advance to delivery inside the override window", "actor": null, "tx": "6068143737e33fa28562ee025b6920a74a040aa67ceff6d16b29143ef21307a1", "feeMicro": 2927, "rejection": "the override window is still open"},
  {"key": "override-zero-rationale", "name": "override proposed with an all-zero rationale hash", "actor": null, "tx": "ff32bc55464d960debe1173f3616784f5f0591511ea5b4af5de5f5b4087addc5", "feeMicro": 2971, "rejection": "an override requires a rationale hash"},
  {"key": "override-unrevealed", "name": "override proposed for a bid nobody revealed", "actor": null, "tx": "1e59db4d01a80077ca11487c0d5c5d3a84565df525bb6632407b2a3bf1dad960", "feeMicro": 2971, "rejection": "an override can only choose a valid revealed bid"},
  {"key": "release-refund-direct", "name": "release_refund called directly on the tender", "actor": "operator", "tx": "aeefec707fa063351467cab7b48fc6fe7f12109d0261640eecdc6a661753e716", "feeMicro": 2536, "rejection": "Access Denied: call component method 'release_refund' on component_1800c5fbabc963212c38d9a963b11ec689d46401a15bcca21cb6d1f989669c79"},
  {"key": "claim-payment-loser", "name": "the loser claims the payment", "actor": "seller2", "tx": "aed17e80b92965d39123ea342d24e5ca3c327fbb9e26682734b36563938138f2", "feeMicro": 2982, "rejection": "only the winning payment identity can claim the payment"},
  {"key": "claim-bond-nonbidder", "name": "bond claim from an account that never bid", "actor": "second", "tx": "d424a503b1cbc53c8c3b132cb65b9d9fa5d37816a7b5e66f97a6d0e69288a5fe", "feeMicro": 2983, "rejection": "no returnable bond for this seller"},
  {"key": "claim-payment-twice", "name": "the winner claims the payment a second time", "actor": "seller1", "tx": "420393863fe169cd63ff82c547c1449ab5610bac240001a8bc7f200b5b1eae74", "feeMicro": 3101, "rejection": "payment already claimed"},
  {"key": "collect-forfeits-twice", "name": "collect the forfeits a second time, with none left", "actor": "the circle", "tx": "32f411f1a039fa9348b46ff37cda0e7763824dbbc518a3860f63dee8d6332bef", "feeMicro": 3860, "rejection": "forfeits already claimed by the circle"},
];

export const MAINNET_ATTACK_DUPLICATES: MainnetAttackDuplicate[] = [
  {"key": "small-bond", "tx": "41630ce81fa181be3fd7f31ada09a7e036710f77a99a60b16de6e39a0b5b272a", "feeMicro": 3335},
  {"key": "update-rules", "tx": "d70b82caa6dbb649bf4886e8312e34c051fae5a29a5c49f57922140f2a89173c", "feeMicro": 2922},
];

export const MAINNET_ATTACK_OVERRIDE: MainnetAttackOverride = {
  "chosenAccount": "seller2",
  "proposeTx": "d76120354e83f6e2917a70ceeb23d55b8b53204a2383832900fb3ac19cd12a29",
  "proposeFeeMicro": 4844,
  "signer": "operator",
  "signTx": "0ab0de33ab8a7b9df36a8a96c91b63b5c264c348aca92b5c8dbd28326de64213",
  "signFeeMicro": 4886,
  "signatures": 1,
  "threshold": 2,
  "awardWinner": "seller1"
};

export const MAINNET_ATTACK_SEALED_BID: MainnetAttackSealedBid = {
  "by": "third",
  "priceMicro": 12000000
};
