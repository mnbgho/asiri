//! The Tender template: one sealed tender for a buying circle, on Tari
//! Ootle.
//!
//! The tender runs through eight states: Draft, Open, Reveal, Awarded,
//! AwaitingDelivery, Settled, Expired, Disputed. The rules and the budget
//! lock before bidding opens and never change after. Sellers bid as hash
//! commitments with a bond. Only revealed bids can win, and the template
//! itself awards the lowest valid revealed price. The circle can replace
//! the award only through a public override at its approver threshold
//! with a rationale hash on chain. The winner is paid from escrow only
//! after delivery is confirmed at threshold, or after a dispute resolves
//! for the winner.
//!
//! Money leaves the tender only through its recorded claim paths. The
//! award payment is claimed by the payment identity bound in the winning
//! commitment, refunds are claimed by circle approvers, bond returns are
//! claimed by their owners, and forfeited bond halves are accounted in
//! two pools, one for the circle and one that leaves circulation.

use asiri_types::{
    amount_u128, canonical_rules_bytes, commitment_bytes, AwardRecord, DisputeRecord,
    OverrideRecord, SettlementRecord, TenderInfo, TenderRules, TenderState,
};
use tari_template_lib::prelude::*;

#[derive(Debug, Clone, minicbor::Encode, minicbor::Decode, minicbor::CborLen)]
struct ReceiptData {
    #[n(0)]
    pub tender: String,
    #[n(1)]
    pub price: Amount,
    #[n(2)]
    pub epoch: u64,
}

#[template]
mod tender {
    use super::*;

    pub struct Tender {
        circle: ComponentAddress,
        circle_name: String,
        bound: bool,
        approvers: Vec<RistrettoPublicKeyBytes>,
        rules: TenderRules,
        rules_hash: Option<Hash32>,
        state: TenderState,
        escrow: Vault,
        bonds: Vault,
        receipt_resource: Option<ResourceAddress>,
        lock_epoch: Option<u64>,
        bid_deadline: Option<u64>,
        reveal_deadline: Option<u64>,
        override_deadline: Option<u64>,
        delivery_start: Option<u64>,
        delivery_deadline: Option<u64>,
        claim_deadline: Option<u64>,
        commitments: Vec<Commitment>,
        reveals: Vec<RevealRecord>,
        reveal_counter: u64,
        award: Option<AwardRecord>,
        override_proposals: Vec<OverrideProposal>,
        override_record: Option<OverrideRecord>,
        delivery_signers: Vec<RistrettoPublicKeyBytes>,
        dispute: Option<DisputeState>,
        dispute_votes: Vec<DisputeVote>,
        settlement: Option<SettlementRecord>,
        refund_amount: Option<Amount>,
        refund_claimed: bool,
        payout_claimed: bool,
        forfeit_for_circle: Amount,
        forfeit_locked: Amount,
        forfeits_claimed_by_circle: bool,
        receipt_id: Option<NonFungibleId>,
        approver_changes: Vec<ApproverChangeProposal>,
        next_proposal_id: u32,
    }

    pub struct Commitment {
        seller: RistrettoPublicKeyBytes,
        commitment: Hash32,
        epoch: u64,
        revealed: bool,
        bond: BondState,
    }

    pub enum BondState {
        Held,
        Returnable,
        Returned,
        Forfeited,
    }

    pub struct RevealRecord {
        seller: RistrettoPublicKeyBytes,
        price: Amount,
        epoch: u64,
        counter: u64,
        valid: bool,
        commitment: Hash32,
    }

    pub struct OverrideProposal {
        id: u32,
        chosen: Option<RistrettoPublicKeyBytes>,
        rationale_hash: Hash32,
        signers: Vec<RistrettoPublicKeyBytes>,
        executed: bool,
        void: bool,
    }

    pub struct DisputeState {
        evidence_hash: Hash32,
        epoch: u64,
        deadline: u64,
        resolved_for_winner: Option<bool>,
        rationale_hash: Option<Hash32>,
    }

    pub struct DisputeVote {
        signer: RistrettoPublicKeyBytes,
        pay_winner: bool,
        rationale_hash: Hash32,
    }

    pub struct ApproverChangeProposal {
        id: u32,
        new_approvers: Vec<RistrettoPublicKeyBytes>,
        signers: Vec<RistrettoPublicKeyBytes>,
        executed: bool,
        void: bool,
    }


    /// Builds the receipt resource for a new tender. The mint rule
    /// allows only components of this template to mint, and the rule is
    /// locked, so the power to issue receipts can never be widened or
    /// handed to anyone else. Each tender creates its own resource in
    /// its constructor and stores the address in its state.
    fn build_receipt_resource(template_address: TemplateAddress) -> ResourceAddress {
        ResourceBuilder::non_fungible()
            .with_token_symbol("ASIRI-RCT")
            .with_access_rules(
                ResourceAccessRules::new()
                    .mintable(
                        AccessRule::Restricted(RestrictedAccessRule::Require(
                            RequireRule::Require(RuleRequirement::ScopedToTemplate(
                                template_address,
                            )),
                        )),
                        LOCKED,
                    )
                    .recallable(AccessRule::DenyAll, LOCKED),
            )
            .with_owner_rule(OwnerRule::None)
            .build()
    }

    impl Tender {
        /// Creates a tender in Draft. The tender names its circle, but it
        /// is inert until that circle registers it: bind is callable only
        /// by the named circle component itself, and an unbound tender
        /// can never be funded or opened.
        pub fn new(circle: ComponentAddress, rules: TenderRules) -> Component<Self> {
            Component::new(Self {
                circle,
                circle_name: String::new(),
                bound: false,
                approvers: Vec::new(),
                rules,
                rules_hash: None,
                state: TenderState::Draft,
                escrow: Vault::new_empty(TARI_TOKEN),
                bonds: Vault::new_empty(TARI_TOKEN),
                receipt_resource: None,
                lock_epoch: None,
                bid_deadline: None,
                reveal_deadline: None,
                override_deadline: None,
                delivery_start: None,
                delivery_deadline: None,
                claim_deadline: None,
                commitments: Vec::new(),
                reveals: Vec::new(),
                reveal_counter: 0,
                award: None,
                override_proposals: Vec::new(),
                override_record: None,
                delivery_signers: Vec::new(),
                dispute: None,
                dispute_votes: Vec::new(),
                settlement: None,
                refund_amount: None,
                refund_claimed: false,
                payout_claimed: false,
                forfeit_for_circle: Amount::zero(),
                forfeit_locked: Amount::zero(),
                forfeits_claimed_by_circle: false,
                receipt_id: None,
                approver_changes: Vec::new(),
                next_proposal_id: 1,
            })
            .with_access_rules(access_rules(circle))
            .with_owner_rule(OwnerRule::None)
            .create()
        }

        /// Binds this tender to its circle. The access rule on this
        /// method accepts the call only when it comes from the named
        /// circle component, and Circle::register_tender is the caller.
        /// The approver set and the circle name arrive from the circle
        /// itself, never from a user's arguments.
        pub fn bind(&mut self, approvers: Vec<RistrettoPublicKeyBytes>, circle_name: String) {
            assert!(self.state == TenderState::Draft, "tender is not a draft");
            assert!(!self.bound, "tender is already bound");
            self.approvers = approvers;
            self.circle_name = circle_name;
            self.bound = true;
        }

        /// Replaces the proposed rules while the tender is a draft.
        /// Circle approvers only.
        pub fn update_rules(&mut self, rules: TenderRules) {
            self.assert_approver();
            assert!(self.state == TenderState::Draft, "tender is not a draft");
            self.rules = rules;
        }

        /// Opens a proposal to replace this tender's approver set, for a
        /// circle that rotates its keys. Signed under the current set at
        /// the approval threshold in the locked rules.
        pub fn propose_approver_change(
            &mut self,
            new_approvers: Vec<RistrettoPublicKeyBytes>,
        ) -> u32 {
            self.assert_approver();
            assert!(
                self.state != TenderState::Settled && self.state != TenderState::Expired,
                "tender is closed"
            );
            validate_key_set(&new_approvers);
            assert!(
                new_approvers.len() >= self.rules.dispute_threshold as usize,
                "the new approver set is smaller than the locked dispute threshold"
            );
            let id = self.next_proposal_id;
            assert!(id < u32::MAX, "proposal id overflow");
            self.next_proposal_id += 1;
            self.approver_changes.push(ApproverChangeProposal {
                id,
                new_approvers,
                signers: Vec::new(),
                executed: false,
                void: false,
            });
            id
        }

        /// Signs an approver change proposal. At the threshold the new
        /// set takes effect and every other open proposal on this tender
        /// is voided. Returns true when this signature executed it.
        pub fn approve_approver_change(&mut self, id: u32) -> bool {
            let signer = self.assert_approver();
            let threshold = self.rules.approval_threshold;
            let proposal = self
                .approver_changes
                .iter_mut()
                .find(|p| p.id == id)
                .expect("unknown approver change proposal");
            assert!(!proposal.void, "proposal is void");
            assert!(!proposal.executed, "proposal already executed");
            assert!(
                !proposal.signers.contains(&signer),
                "approver has already signed this proposal"
            );
            proposal.signers.push(signer);
            if (proposal.signers.len() as u32) < threshold {
                return false;
            }
            proposal.executed = true;
            let new_approvers = proposal.new_approvers.clone();
            self.approvers = new_approvers;
            for p in self.approver_changes.iter_mut() {
                if !p.executed {
                    p.void = true;
                }
            }
            for p in self.override_proposals.iter_mut() {
                if !p.executed {
                    p.void = true;
                }
            }
            self.delivery_signers.clear();
            self.dispute_votes.clear();
            true
        }

        /// Locks the rules and funds the escrow in one call. After this
        /// call the rules are never written again by any method. Circle
        /// approvers only. The bucket must hold exactly the budget cap.
        pub fn lock_and_fund(&mut self, bucket: Bucket) {
            assert!(self.bound, "tender is not bound to its circle");
            self.assert_approver();
            assert!(self.state == TenderState::Draft, "tender is not a draft");
            validate_rules(&self.rules, self.approvers.len());
            assert!(
                bucket.resource_address() == TARI_TOKEN,
                "the escrow holds TARI only"
            );
            assert!(
                bucket.amount() == self.rules.budget_cap,
                "escrow funding must equal the budget cap"
            );
            let now = Consensus::current_epoch();
            self.rules_hash = Some(intrinsics::hash_sha256(&canonical_rules_bytes(&self.rules)));
            self.lock_epoch = Some(now);
            self.bid_deadline = Some(now + self.rules.bid_window_epochs);
            self.reveal_deadline =
                Some(now + self.rules.bid_window_epochs + self.rules.reveal_window_epochs);
            self.escrow.deposit(bucket);
            self.state = TenderState::Open;
            self.emit_state("open");
        }

        /// Posts a bid commitment with its bond. One per seller. The
        /// commitment is a hash and carries no price information.
        pub fn commit_bid(&mut self, commitment: Hash32, bond_bucket: Bucket) {
            assert!(self.state == TenderState::Open, "tender is not open");
            let now = Consensus::current_epoch();
            assert!(
                now < self.bid_deadline.expect("bid deadline set"),
                "the bid window has closed"
            );
            let seller = CallerContext::transaction_signer_public_key();
            assert!(
                !self.commitments.iter().any(|c| c.seller == seller),
                "seller has already committed in this tender"
            );
            assert!(
                !self.commitments.iter().any(|c| c.commitment == commitment),
                "this commitment is already posted"
            );
            assert!(
                bond_bucket.resource_address() == TARI_TOKEN,
                "the bond is paid in TARI"
            );
            assert!(
                bond_bucket.amount() == self.rules.bond_amount,
                "bond must equal the locked bond amount"
            );
            self.bonds.deposit(bond_bucket);
            self.commitments.push(Commitment {
                seller,
                commitment,
                epoch: now,
                revealed: false,
                bond: BondState::Held,
            });
            emit_event(
                "tender_bid_committed",
                event_payload(&[("commitment", &commitment.to_string())]),
            );
        }

        /// Opens a commitment. The transaction must be signed by the
        /// payment identity the commitment binds, and the presented
        /// price, salt, and payment identity must hash to a stored
        /// commitment. A reveal above the budget cap is recorded as
        /// invalid and can never win.
        pub fn reveal_bid(
            &mut self,
            price: Amount,
            salt: Vec<u8>,
            payment_identity: RistrettoPublicKeyBytes,
        ) {
            assert!(salt.len() == 32, "salt must be 32 bytes");
            let salt: [u8; 32] = salt.try_into().expect("salt length checked");
            assert!(
                self.state == TenderState::Open || self.state == TenderState::Reveal,
                "tender is not in its reveal window"
            );
            let now = Consensus::current_epoch();
            assert!(
                now >= self.bid_deadline.expect("bid deadline set"),
                "the reveal window has not opened"
            );
            assert!(
                now < self.reveal_deadline.expect("reveal deadline set"),
                "the reveal window has closed"
            );
            let signer = CallerContext::transaction_signer_public_key();
            assert!(
                signer == payment_identity,
                "reveal must be signed by the payment identity"
            );
            let digest = intrinsics::hash_sha256(&commitment_bytes(price, &salt, &payment_identity));
            // The match must be the signer's own commitment. A copied
            // hash posted under another seller can never stand in for
            // it or block it: duplicates are refused at commit time,
            // and this lookup skips any entry that is not the
            // signer's own regardless.
            let idx = self
                .commitments
                .iter()
                .position(|c| {
                    !c.revealed && c.commitment == digest && c.seller == payment_identity
                })
                .expect("no matching commitment for this reveal");
            self.commitments[idx].revealed = true;
            let matched_commitment = self.commitments[idx].commitment;
            self.reveal_counter += 1;
            let valid = price <= self.rules.budget_cap;
            self.reveals.push(RevealRecord {
                seller: payment_identity,
                price,
                epoch: now,
                counter: self.reveal_counter,
                valid,
                commitment: matched_commitment,
            });
            if self.state == TenderState::Open {
                self.state = TenderState::Reveal;
                self.emit_state("reveal");
            }
            emit_event(
                "tender_bid_revealed",
                event_payload(&[("price", &price.to_string())]),
            );
        }

        /// Closes the reveal window and computes the award: the lowest
        /// valid revealed price, ties broken by earliest reveal. With no
        /// valid reveal the tender expires and every bond returns in
        /// full. Anyone may call this once the window has closed.
        pub fn close_reveal(&mut self) {
            assert!(
                self.state == TenderState::Open || self.state == TenderState::Reveal,
                "tender is not in its reveal window"
            );
            let now = Consensus::current_epoch();
            assert!(
                now >= self.reveal_deadline.expect("reveal deadline set"),
                "the reveal window is still open"
            );
            self.close_reveal_inner(now);
        }

        /// Opens an override proposal: a different revealed bid in place
        /// of the computed award, or no winner at all when chosen is
        /// empty, which cancels the tender. Circle approvers only, inside
        /// the override window only.
        pub fn propose_override(
            &mut self,
            chosen: Option<RistrettoPublicKeyBytes>,
            rationale_hash: Hash32,
        ) -> u32 {
            self.assert_approver();
            self.assert_override_window();
            assert!(
                rationale_hash != Hash32::from_array([0u8; 32]),
                "an override requires a rationale hash"
            );
            assert!(
                self.override_record.is_none(),
                "an override has already executed"
            );
            if let Some(seller) = chosen {
                assert!(
                    self.reveals.iter().any(|r| r.valid && r.seller == seller),
                    "an override can only choose a valid revealed bid"
                );
            }
            let id = self.next_proposal_id;
            assert!(id < u32::MAX, "proposal id overflow");
            self.next_proposal_id += 1;
            self.override_proposals.push(OverrideProposal {
                id,
                chosen,
                rationale_hash,
                signers: Vec::new(),
                executed: false,
                void: false,
            });
            id
        }

        /// Signs an override proposal. At the approval threshold the
        /// proposal executes: the award is replaced, or the tender is
        /// cancelled with the escrow and every revealed bond refunded.
        /// Competing proposals are voided by the first execution.
        /// Returns true when this signature executed the proposal.
        pub fn sign_override(&mut self, id: u32) -> bool {
            let signer = self.assert_approver();
            self.assert_override_window();
            let threshold = self.rules.approval_threshold;
            let proposal = self
                .override_proposals
                .iter_mut()
                .find(|p| p.id == id)
                .expect("unknown override proposal");
            assert!(!proposal.void, "proposal is void");
            assert!(!proposal.executed, "proposal already executed");
            assert!(
                !proposal.signers.contains(&signer),
                "approver has already signed this proposal"
            );
            proposal.signers.push(signer);
            if (proposal.signers.len() as u32) < threshold {
                return false;
            }
            proposal.executed = true;
            let chosen = proposal.chosen;
            let rationale_hash = proposal.rationale_hash;
            for p in self.override_proposals.iter_mut() {
                if !p.executed {
                    p.void = true;
                }
            }
            let now = Consensus::current_epoch();
            self.override_record = Some(OverrideRecord {
                chosen,
                rationale_hash,
                epoch: now,
            });
            match chosen {
                Some(seller) => {
                    let mut candidates: Vec<&RevealRecord> = self
                        .reveals
                        .iter()
                        .filter(|r| r.valid && r.seller == seller)
                        .collect();
                    candidates.sort_by(|a, b| {
                        amount_u128(a.price)
                            .cmp(&amount_u128(b.price))
                            .then(a.counter.cmp(&b.counter))
                    });
                    let reveal = candidates
                        .first()
                        .expect("chosen seller has a valid reveal");
                    let mut award = self.award.clone().expect("award exists");
                    award.winner = seller;
                    award.winning_price = reveal.price;
                    award.winning_commitment = reveal.commitment;
                    award.by_override = true;
                    self.award = Some(award);
                    self.emit_state("override_executed");
                }
                None => {
                    self.refund_amount = Some(self.rules.budget_cap);
                    for c in self.commitments.iter_mut() {
                        if matches!(c.bond, BondState::Held) && c.revealed {
                            c.bond = BondState::Returnable;
                        }
                    }
                    self.state = TenderState::Expired;
                    self.emit_state("expired_by_cancellation");
                }
            }
            true
        }

        /// Moves an awarded tender into delivery once the override window
        /// has closed with the winner final. Anyone may call this.
        /// confirm_delivery performs the same step implicitly when it is
        /// called first, so the path never depends on one caller.
        pub fn advance_delivery(&mut self) {
            assert!(self.state == TenderState::Awarded, "tender is not awarded");
            let now = Consensus::current_epoch();
            assert!(
                now >= self.override_deadline.expect("override deadline set"),
                "the override window is still open"
            );
            self.enter_delivery(now);
        }

        /// Confirms delivery. Circle approvers only, each counted once.
        /// At the approval threshold the tender settles: the winner's
        /// payment, the escrow refund, and every bond outcome are
        /// recorded, ready to be claimed through their own paths.
        pub fn confirm_delivery(&mut self) {
            let signer = self.assert_approver();
            if self.state == TenderState::Awarded {
                let now = Consensus::current_epoch();
                assert!(
                    now >= self.override_deadline.expect("override deadline set"),
                    "the override window is still open"
                );
                self.enter_delivery(now);
            }
            assert!(
                self.state == TenderState::AwaitingDelivery,
                "tender is not awaiting delivery"
            );
            assert!(
                Consensus::current_epoch() < self.claim_deadline.expect("claim deadline set"),
                "the claim grace has closed"
            );
            assert!(
                !self.delivery_signers.contains(&signer),
                "approver has already confirmed delivery"
            );
            self.delivery_signers.push(signer);
            if (self.delivery_signers.len() as u32) >= self.rules.approval_threshold {
                self.settle();
            }
        }

        /// The winner's delivery claim. Filed from the delivery deadline
        /// until the claim grace closes, it moves the tender to Disputed
        /// and blocks expiry while the circle decides.
        pub fn claim_dispute(&mut self, evidence_hash: Hash32) {
            assert!(
                self.state == TenderState::AwaitingDelivery,
                "tender is not awaiting delivery"
            );
            let now = Consensus::current_epoch();
            assert!(
                now >= self.delivery_deadline.expect("delivery deadline set"),
                "the delivery window is still open"
            );
            assert!(
                now < self.claim_deadline.expect("claim deadline set"),
                "the claim grace has closed"
            );
            let signer = CallerContext::transaction_signer_public_key();
            let award = self.award.clone().expect("award exists");
            assert!(
                signer == award.winner,
                "only the winner can file a delivery claim"
            );
            self.dispute = Some(DisputeState {
                evidence_hash,
                epoch: now,
                deadline: now + self.rules.dispute_window_epochs,
                resolved_for_winner: None,
                rationale_hash: None,
            });
            self.state = TenderState::Disputed;
            self.emit_state("disputed");
        }

        /// Votes to resolve a dispute, at the dispute threshold in the
        /// locked rules, which is higher than the approval threshold.
        /// Votes count per outcome and rationale pair. The executing vote
        /// settles the tender for the winner, or refunds the circle and
        /// forfeits the winner's bond. Returns true when this vote
        /// executed the resolution.
        pub fn resolve_dispute(&mut self, pay_winner: bool, rationale_hash: Hash32) -> bool {
            let signer = self.assert_approver();
            assert!(self.state == TenderState::Disputed, "tender is not disputed");
            let now = Consensus::current_epoch();
            let deadline = self.dispute.as_ref().expect("dispute exists").deadline;
            assert!(now < deadline, "the dispute window has closed");
            assert!(
                !self.dispute_votes.iter().any(|v| v.signer == signer),
                "approver has already voted on this dispute"
            );
            self.dispute_votes.push(DisputeVote {
                signer,
                pay_winner,
                rationale_hash,
            });
            let count = self
                .dispute_votes
                .iter()
                .filter(|v| v.pay_winner == pay_winner && v.rationale_hash == rationale_hash)
                .count() as u32;
            if count < self.rules.dispute_threshold {
                return false;
            }
            if let Some(d) = self.dispute.as_mut() {
                d.resolved_for_winner = Some(pay_winner);
                d.rationale_hash = Some(rationale_hash);
            }
            if pay_winner {
                self.settle();
            } else {
                self.refund_amount = Some(self.rules.budget_cap);
                let winning_commitment =
                    self.award.clone().expect("award exists").winning_commitment;
                let mut circle_part = Amount::zero();
                let mut locked_part = Amount::zero();
                for c in self.commitments.iter_mut() {
                    if matches!(c.bond, BondState::Held) {
                        if c.commitment == winning_commitment {
                            let (cp, bp) = forfeit_split(self.rules.bond_amount);
                            circle_part += cp;
                            locked_part += bp;
                            c.bond = BondState::Forfeited;
                        } else if c.revealed {
                            c.bond = BondState::Returnable;
                        }
                    }
                }
                self.forfeit_for_circle += circle_part;
                self.forfeit_locked += locked_part;
                self.state = TenderState::Expired;
                self.emit_state("expired_by_dispute");
            }
            true
        }

        /// Closes a tender whose path has run out: an awarded tender
        /// whose delivery window and claim grace closed with no
        /// confirmation and no claim, or a dispute whose window closed
        /// unresolved. Anyone may call this when the closing condition
        /// holds.
        pub fn expire(&mut self) {
            let now = Consensus::current_epoch();
            match self.state {
                TenderState::Open | TenderState::Reveal => {
                    assert!(
                        now >= self.reveal_deadline.expect("reveal deadline set"),
                        "the reveal window is still open"
                    );
                    self.close_reveal_inner(now);
                }
                TenderState::AwaitingDelivery => {
                    assert!(
                        now >= self.claim_deadline.expect("claim deadline set"),
                        "the claim grace is still open"
                    );
                    self.refund_amount = Some(self.rules.budget_cap);
                    let winning_commitment =
                        self.award.clone().expect("award exists").winning_commitment;
                    let mut circle_part = Amount::zero();
                    let mut locked_part = Amount::zero();
                    for c in self.commitments.iter_mut() {
                        if matches!(c.bond, BondState::Held) {
                            if c.commitment == winning_commitment {
                                let (cp, bp) = forfeit_split(self.rules.bond_amount);
                                circle_part += cp;
                                locked_part += bp;
                                c.bond = BondState::Forfeited;
                            } else if c.revealed {
                                c.bond = BondState::Returnable;
                            }
                        }
                    }
                    self.forfeit_for_circle += circle_part;
                    self.forfeit_locked += locked_part;
                    self.state = TenderState::Expired;
                    self.emit_state("expired");
                }
                TenderState::Disputed => {
                    let deadline = self.dispute.as_ref().expect("dispute exists").deadline;
                    assert!(now >= deadline, "the dispute window is still open");
                    self.refund_amount = Some(self.rules.budget_cap);
                    for c in self.commitments.iter_mut() {
                        if matches!(c.bond, BondState::Held) && c.revealed {
                            c.bond = BondState::Returnable;
                        }
                    }
                    self.state = TenderState::Expired;
                    self.emit_state("expired_dispute_unresolved");
                }
                _ => panic!("tender cannot expire from its current state"),
            }
        }

        /// The winner claims the award payment. The transaction must be
        /// signed by the payment identity bound in the winning
        /// commitment, so no other account can ever take this bucket.
        /// The payment bucket leaves the escrow here; the caller's
        /// transaction carries it into a stealth transfer to the winner.
        pub fn claim_payment(&mut self) -> Bucket {
            assert!(self.state == TenderState::Settled, "tender is not settled");
            assert!(!self.payout_claimed, "payment already claimed");
            let settlement = self.settlement.clone().expect("settlement exists");
            let signer = CallerContext::transaction_signer_public_key();
            assert!(
                signer == settlement.winner,
                "only the winning payment identity can claim the payment"
            );
            self.payout_claimed = true;
            self.escrow.withdraw(settlement.price)
        }

        /// The winner claims the receipt for a settled tender. The
        /// receipt is minted inside this call by this template, and the
        /// caller's transaction deposits the bucket into the winner's
        /// account.
        pub fn claim_receipt(&mut self) -> Bucket {
            assert!(self.state == TenderState::Settled, "tender is not settled");
            assert!(self.receipt_id.is_none(), "receipt already claimed");
            let settlement = self.settlement.clone().expect("settlement exists");
            let signer = CallerContext::transaction_signer_public_key();
            assert!(
                signer == settlement.winner,
                "only the winning payment identity can claim the receipt"
            );
            self.mint_receipt(&settlement)
        }

        /// Releases the unspent escrow back to the circle. Only the
        /// bound circle component can call this (see the access
        /// rules), and the circle deposits what it receives into its
        /// own treasury, so the destination is fixed by the templates
        /// and never chosen by a caller. No account can take the
        /// refund for itself.
        pub fn release_refund(&mut self) -> Bucket {
            assert!(
                self.state == TenderState::Settled || self.state == TenderState::Expired,
                "tender is not closed"
            );
            assert!(!self.refund_claimed, "refund already claimed");
            let amount = self.refund_amount.expect("refund recorded");
            self.refund_claimed = true;
            self.escrow.withdraw(amount)
        }

        /// A seller claims back a bond the record marks returnable.
        pub fn claim_bond(&mut self) -> Bucket {
            let signer = CallerContext::transaction_signer_public_key();
            let idx = self
                .commitments
                .iter()
                .position(|c| c.seller == signer && matches!(c.bond, BondState::Returnable))
                .expect("no returnable bond for this seller");
            self.commitments[idx].bond = BondState::Returned;
            self.bonds.withdraw(self.rules.bond_amount)
        }

        /// Releases the circle's half of the forfeited bonds to the
        /// circle, under the same rule as the refund: only the bound
        /// circle component can call this, and the money can only land
        /// in that circle's treasury.
        pub fn release_forfeits(&mut self) -> Bucket {
            assert!(
                self.state == TenderState::Settled || self.state == TenderState::Expired,
                "tender is not closed"
            );
            assert!(
                !self.forfeits_claimed_by_circle,
                "forfeits already claimed by the circle"
            );
            assert!(
                self.forfeit_for_circle > Amount::zero(),
                "no forfeits for the circle"
            );
            self.forfeits_claimed_by_circle = true;
            self.bonds.withdraw(self.forfeit_for_circle)
        }

        /// The full public record of this tender.
        pub fn info(&self) -> TenderInfo {
            TenderInfo {
                circle: self.circle,
                circle_name: self.circle_name.clone(),
                bound: self.bound,
                state: self.state,
                rules: self.rules.clone(),
                rules_hash: self.rules_hash,
                approvers: self.approvers.clone(),
                lock_epoch: self.lock_epoch,
                bid_deadline: self.bid_deadline,
                reveal_deadline: self.reveal_deadline,
                override_deadline: self.override_deadline,
                delivery_deadline: self.delivery_deadline,
                claim_deadline: self.claim_deadline,
                commitments_count: self.commitments.len() as u64,
                reveals_count: self.reveals.len() as u64,
                award: self.award.clone(),
                override_record: self.override_record.clone(),
                dispute: self.dispute.as_ref().map(|d| DisputeRecord {
                    evidence_hash: d.evidence_hash,
                    epoch: d.epoch,
                    resolved_for_winner: d.resolved_for_winner,
                    rationale_hash: d.rationale_hash,
                }),
                settlement: self.settlement.clone(),
                receipt_resource: self.receipt_resource,
                forfeit_for_circle: self.forfeit_for_circle,
                forfeit_locked: self.forfeit_locked,
                receipt_id: self.receipt_id.clone(),
            }
        }

        fn assert_approver(&self) -> RistrettoPublicKeyBytes {
            let signer = CallerContext::transaction_signer_public_key();
            assert!(
                self.approvers.contains(&signer),
                "signer is not a circle approver"
            );
            signer
        }

        fn assert_override_window(&self) {
            assert!(self.state == TenderState::Awarded, "tender is not awarded");
            let now = Consensus::current_epoch();
            let award_epoch = self.award.as_ref().expect("award exists").epoch;
            assert!(now >= award_epoch, "override window has not opened");
            assert!(
                now < self.override_deadline.expect("override deadline set"),
                "the override window has closed"
            );
        }

        fn close_reveal_inner(&mut self, now: u64) {
            let valid: Vec<&RevealRecord> = self.reveals.iter().filter(|r| r.valid).collect();
            if valid.is_empty() {
                for c in self.commitments.iter_mut() {
                    if matches!(c.bond, BondState::Held) {
                        c.bond = BondState::Returnable;
                    }
                }
                self.refund_amount = Some(self.rules.budget_cap);
                self.state = TenderState::Expired;
                self.emit_state("expired_no_valid_reveal");
                return;
            }
            let mut best = valid[0];
            for r in valid.iter().skip(1) {
                if amount_u128(r.price) < amount_u128(best.price)
                    || (amount_u128(r.price) == amount_u128(best.price) && r.counter < best.counter)
                {
                    best = r;
                }
            }
            let winner = best.seller;
            let winning_price = best.price;
            let winning_commitment = best.commitment;
            self.award = Some(AwardRecord {
                winner,
                winning_commitment,
                winning_price,
                commitments_count: self.commitments.len() as u64,
                reveals_count: self.reveals.len() as u64,
                epoch: now,
                by_override: false,
            });
            self.override_deadline = Some(now + self.rules.override_window_epochs);
            let invalid_commitments: Vec<Hash32> = self
                .reveals
                .iter()
                .filter(|r| !r.valid)
                .map(|r| r.commitment)
                .collect();
            let mut circle_part = Amount::zero();
            let mut locked_part = Amount::zero();
            for c in self.commitments.iter_mut() {
                if matches!(c.bond, BondState::Held)
                    && (!c.revealed || invalid_commitments.contains(&c.commitment))
                {
                    let (cp, bp) = forfeit_split(self.rules.bond_amount);
                    circle_part += cp;
                    locked_part += bp;
                    c.bond = BondState::Forfeited;
                }
            }
            self.forfeit_for_circle += circle_part;
            self.forfeit_locked += locked_part;
            self.state = TenderState::Awarded;
            self.emit_state("awarded");
        }

        fn enter_delivery(&mut self, now: u64) {
            self.delivery_start = Some(now);
            self.delivery_deadline = Some(now + self.rules.delivery_window_epochs);
            self.claim_deadline =
                Some(now + self.rules.delivery_window_epochs + self.rules.claim_grace_epochs);
            self.state = TenderState::AwaitingDelivery;
            self.emit_state("awaiting_delivery");
        }

        fn settle(&mut self) {
            let award = self.award.clone().expect("award exists");
            let now = Consensus::current_epoch();
            self.settlement = Some(SettlementRecord {
                winner: award.winner,
                price: award.winning_price,
                epoch: now,
            });
            self.refund_amount = Some(self.rules.budget_cap - award.winning_price);
            for c in self.commitments.iter_mut() {
                if matches!(c.bond, BondState::Held) && c.revealed {
                    c.bond = BondState::Returnable;
                }
            }
            self.state = TenderState::Settled;
            self.emit_state("settled");
        }

        fn mint_receipt(&mut self, settlement: &SettlementRecord) -> Bucket {
            // The receipt resource is created on first use: a
            // constructor has no component context to anchor a new
            // resource in, while this call stores the address in the
            // component state in the same transaction that creates it.
            let resource = match self.receipt_resource {
                Some(resource) => resource,
                None => {
                    let resource = build_receipt_resource(
                        ComponentManager::current().get_template_address(),
                    );
                    self.receipt_resource = Some(resource);
                    resource
                },
            };
            let id = NonFungibleId::random();
            let mut immutable = Metadata::new();
            immutable.insert("name", "Asiri tender receipt");
            immutable.insert("tender", &CallerContext::current_component_address().to_string());
            let data = ReceiptData {
                tender: CallerContext::current_component_address().to_string(),
                price: settlement.price,
                epoch: settlement.epoch,
            };
            let bucket = ResourceManager::get(resource).mint_non_fungible(id.clone(), &immutable, &data);
            self.receipt_id = Some(id);
            bucket
        }

        fn emit_state(&self, to: &str) {
            emit_event(
                "tender_state",
                event_payload(&[("state", to), ("circle", &self.circle_name)]),
            );
        }
    }

    /// Every method is listed explicitly, and the default rule denies
    /// everything else. Three methods are the exception to an open
    /// rule: bind, release_refund, and release_forfeits accept calls
    /// only from the named circle component, so a tender's proceeds
    /// can move only into its own circle.
    fn access_rules(circle: ComponentAddress) -> AccessRules {
        AccessRules::new()
            .method(
                "bind",
                AccessRule::Restricted(RestrictedAccessRule::Require(
                    RequireRule::Require(RuleRequirement::CallerComponent(circle)),
                )),
            )
            .method("update_rules", AccessRule::AllowAll)
            .method("propose_approver_change", AccessRule::AllowAll)
            .method("approve_approver_change", AccessRule::AllowAll)
            .method("lock_and_fund", AccessRule::AllowAll)
            .method("commit_bid", AccessRule::AllowAll)
            .method("reveal_bid", AccessRule::AllowAll)
            .method("close_reveal", AccessRule::AllowAll)
            .method("propose_override", AccessRule::AllowAll)
            .method("sign_override", AccessRule::AllowAll)
            .method("advance_delivery", AccessRule::AllowAll)
            .method("confirm_delivery", AccessRule::AllowAll)
            .method("claim_dispute", AccessRule::AllowAll)
            .method("resolve_dispute", AccessRule::AllowAll)
            .method("expire", AccessRule::AllowAll)
            .method("claim_payment", AccessRule::AllowAll)
            .method(
                "release_refund",
                AccessRule::Restricted(RestrictedAccessRule::Require(
                    RequireRule::Require(RuleRequirement::CallerComponent(circle)),
                )),
            )
            .method("claim_bond", AccessRule::AllowAll)
            .method(
                "release_forfeits",
                AccessRule::Restricted(RestrictedAccessRule::Require(
                    RequireRule::Require(RuleRequirement::CallerComponent(circle)),
                )),
            )
            .method("claim_receipt", AccessRule::AllowAll)
            .method("info", AccessRule::AllowAll)
    }

    /// Splits a forfeited bond: half is locked in the tender for good, the circle
    /// keeps the rest, including the odd unit when the bond is odd, so
    /// the two parts always add back to the bond.
    fn forfeit_split(bond: Amount) -> (Amount, Amount) {
        let total = amount_u128(bond);
        let locked = total / 2;
        let circle = total - locked;
        (Amount::from_integer(circle), Amount::from_integer(locked))
    }

    fn validate_key_set(keys: &[RistrettoPublicKeyBytes]) {
        assert!(!keys.is_empty(), "approver set must not be empty");
        for (i, a) in keys.iter().enumerate() {
            assert!(!keys[..i].contains(a), "approvers must be distinct");
        }
    }

    fn validate_rules(rules: &TenderRules, approver_count: usize) {
        assert!(rules.budget_cap > Amount::zero(), "budget cap must be positive");
        assert!(
            rules.bid_window_epochs >= 1
                && rules.reveal_window_epochs >= 1
                && rules.override_window_epochs >= 1
                && rules.delivery_window_epochs >= 1
                && rules.claim_grace_epochs >= 1
                && rules.dispute_window_epochs >= 1,
            "every window must be at least one epoch"
        );
        assert!(
            rules.bid_window_epochs <= 200_000
                && rules.reveal_window_epochs <= 200_000
                && rules.override_window_epochs <= 200_000
                && rules.delivery_window_epochs <= 200_000
                && rules.claim_grace_epochs <= 200_000
                && rules.dispute_window_epochs <= 200_000,
            "window exceeds the allowed bound"
        );
        assert!(
            rules.approval_threshold >= 1,
            "approval threshold must be at least 1"
        );
        assert!(
            (rules.approval_threshold as usize) <= approver_count,
            "approval threshold exceeds approver count"
        );
        assert!(
            rules.dispute_threshold > rules.approval_threshold,
            "dispute threshold must exceed the approval threshold"
        );
        assert!(
            (rules.dispute_threshold as usize) <= approver_count,
            "dispute threshold exceeds approver count"
        );
    }

    fn event_payload(pairs: &[(&str, &str)]) -> Metadata {
        let mut metadata = Metadata::new();
        for (k, v) in pairs {
            metadata.insert(*k, *v);
        }
        metadata
    }
}
