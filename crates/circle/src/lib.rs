//! The Circle template: a buying circle on Tari Ootle.
//!
//! A circle is a persistent buyer. It holds a treasury, a set of
//! approvers who act by counted signatures at a threshold, and the list
//! of tenders it has registered as its own. No single approver can move
//! treasury funds or change the approver set: both happen only when a
//! proposal collects signatures from distinct approvers up to the
//! threshold, and the change takes effect inside the call that reaches
//! the threshold.

use asiri_types::{CircleInfo, TenderInfo};
use tari_template_lib::prelude::*;

#[template]
mod circle {
    use super::*;

    pub struct Circle {
        name: String,
        members: Vec<RistrettoPublicKeyBytes>,
        approvers: Vec<RistrettoPublicKeyBytes>,
        threshold: u32,
        auditor: Option<RistrettoPublicKeyBytes>,
        treasury: Vault,
        tenders: Vec<ComponentAddress>,
        withdrawals: Vec<WithdrawalProposal>,
        approver_changes: Vec<ApproverChangeProposal>,
        next_proposal_id: u32,
        /// Set while this component is inside a call to another
        /// component. Every gated method refuses to run while it is
        /// set, so a component on the receiving end of a Circle call
        /// can never call back in and act under the transaction
        /// signer's authority.
        external_call_active: bool,
        /// When set at creation, the only template whose components
        /// this circle will register as tenders. Registration checks
        /// the component's real template address, so an impostor
        /// component cannot join the circle's tender list.
        tender_template: Option<TemplateAddress>,
    }

    pub struct WithdrawalProposal {
        id: u32,
        amount: Amount,
        to: ComponentAddress,
        signers: Vec<RistrettoPublicKeyBytes>,
        executed: bool,
        void: bool,
    }

    pub struct ApproverChangeProposal {
        id: u32,
        new_approvers: Vec<RistrettoPublicKeyBytes>,
        new_threshold: u32,
        signers: Vec<RistrettoPublicKeyBytes>,
        executed: bool,
        void: bool,
    }

    impl Circle {
        pub fn new(
            name: String,
            approvers: Vec<RistrettoPublicKeyBytes>,
            threshold: u32,
            auditor: Option<RistrettoPublicKeyBytes>,
            tender_template: Option<TemplateAddress>,
        ) -> Component<Self> {
            assert!(!name.is_empty(), "circle name must not be empty");
            validate_approver_set(&approvers, threshold);
            let creator = CallerContext::transaction_signer_public_key();
            let mut members = approvers.clone();
            if !members.contains(&creator) {
                members.push(creator);
            }
            Component::new(Self {
                name,
                members,
                approvers,
                threshold,
                auditor,
                treasury: Vault::new_empty(TARI_TOKEN),
                tenders: Vec::new(),
                withdrawals: Vec::new(),
                approver_changes: Vec::new(),
                next_proposal_id: 1,
                external_call_active: false,
                tender_template,
            })
            .with_access_rules(access_rules())
            .with_owner_rule(OwnerRule::None)
            .create()
        }

        /// Adds funds to the treasury. Members and approvers only, plus
        /// one deliberate exception: an approver of a tender this circle
        /// registered may pay that tender's proceeds in (an escrow
        /// refund or a forfeit share) even after the circle has rotated
        /// them out of its own set, because the tender's approver set is
        /// a snapshot from when it was bound. Depositing can only add
        /// funds, never remove them.
        pub fn deposit_treasury(&mut self, bucket: Bucket) {
            self.assert_not_in_external_call();
            let signer = CallerContext::transaction_signer_public_key();
            if !self.members.contains(&signer) && !self.approvers.contains(&signer) {
                self.external_call_active = true;
                let mut allowed = false;
                for tender in self.tenders.iter() {
                    let info = ComponentManager::get(*tender)
                        .call::<&str, TenderInfo, Bytes>("info", Vec::<Bytes>::new());
                    if info.approvers.contains(&signer) {
                        allowed = true;
                        break;
                    }
                }
                self.external_call_active = false;
                assert!(allowed, "only circle members can fund the treasury");
            }
            assert!(
                bucket.resource_address() == TARI_TOKEN,
                "the treasury holds TARI only"
            );
            self.treasury.deposit(bucket);
        }

        pub fn treasury_balance(&self) -> Amount {
            self.treasury.balance()
        }

        /// Opens a withdrawal proposal and returns its id. Approvers only.
        /// Nothing moves until approve_withdrawal reaches the threshold.
        pub fn propose_withdrawal(&mut self, amount: Amount, to: ComponentAddress) -> u32 {
            self.assert_not_in_external_call();
            self.assert_approver();
            assert!(amount > Amount::zero(), "withdrawal amount must be positive");
            assert!(
                amount <= self.treasury.balance(),
                "withdrawal exceeds the treasury balance"
            );
            let id = self.next_proposal_id;
            assert!(id < u32::MAX, "proposal id overflow");
            self.next_proposal_id += 1;
            self.withdrawals.push(WithdrawalProposal {
                id,
                amount,
                to,
                signers: Vec::new(),
                executed: false,
                void: false,
            });
            id
        }

        /// Signs a withdrawal proposal. When this signature reaches the
        /// threshold, the amount leaves the treasury and is deposited
        /// into the destination component inside this same call, so the
        /// funds never pass through any account's hands. Returns true
        /// when this signature executed the withdrawal.
        pub fn approve_withdrawal(&mut self, id: u32) -> bool {
            self.assert_not_in_external_call();
            let signer = self.assert_approver();
            let threshold = self.threshold;
            let proposal = self
                .withdrawals
                .iter_mut()
                .find(|p| p.id == id)
                .expect("unknown withdrawal proposal");
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
            let amount = proposal.amount;
            let to = proposal.to;
            assert!(
                amount <= self.treasury.balance(),
                "withdrawal exceeds the treasury balance"
            );
            let bucket = self.treasury.withdraw(amount);
            self.external_call_active = true;
            ComponentManager::get(to).call::<&str, (), Bytes>("deposit", vec![encode_arg(&bucket)]);
            self.external_call_active = false;
            emit_event(
                "circle_withdrawal_executed",
                event_payload(&[
                    ("proposal", &id.to_string()),
                    ("amount", &amount.to_string()),
                ]),
            );
            true
        }

        /// Opens a proposal to replace the approver set. Approvers only.
        pub fn propose_approver_change(
            &mut self,
            new_approvers: Vec<RistrettoPublicKeyBytes>,
            new_threshold: u32,
        ) -> u32 {
            self.assert_not_in_external_call();
            self.assert_approver();
            validate_approver_set(&new_approvers, new_threshold);
            let id = self.next_proposal_id;
            assert!(id < u32::MAX, "proposal id overflow");
            self.next_proposal_id += 1;
            self.approver_changes.push(ApproverChangeProposal {
                id,
                new_approvers,
                new_threshold,
                signers: Vec::new(),
                executed: false,
                void: false,
            });
            id
        }

        /// Signs an approver change proposal under the current set. When
        /// this signature reaches the current threshold, the new set
        /// takes effect and every other open proposal is voided, because
        /// its signatures were collected under the old set. Returns true
        /// when this signature executed the change.
        pub fn approve_approver_change(&mut self, id: u32) -> bool {
            self.assert_not_in_external_call();
            let signer = self.assert_approver();
            let threshold = self.threshold;
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
            let new_threshold = proposal.new_threshold;
            self.approvers = new_approvers;
            self.threshold = new_threshold;
            for p in self.withdrawals.iter_mut() {
                if !p.executed {
                    p.void = true;
                }
            }
            for p in self.approver_changes.iter_mut() {
                if !p.executed {
                    p.void = true;
                }
            }
            emit_event("circle_approvers_changed", event_payload(&[]));
            true
        }

        /// Registers a tender as this circle's own and binds it: the
        /// tender receives this circle's approver set and name from this
        /// component directly, and its bind method accepts the call only
        /// from this component. Approvers only. A tender that was never
        /// registered here can never open for bids.
        pub fn register_tender(&mut self, tender: ComponentAddress) {
            self.assert_not_in_external_call();
            self.assert_approver();
            assert!(
                !self.tenders.contains(&tender),
                "tender is already registered"
            );
            if let Some(expected) = self.tender_template {
                assert!(
                    ComponentManager::get(tender).get_template_address() == expected,
                    "component is not the tender template this circle accepts"
                );
            }
            self.external_call_active = true;
            ComponentManager::get(tender).call::<&str, (), Bytes>(
                "bind",
                vec![encode_arg(&self.approvers), encode_arg(&self.name)],
            );
            self.external_call_active = false;
            self.tenders.push(tender);
            emit_event("circle_tender_registered", event_payload(&[]));
        }

        /// Collects a registered tender's escrow refund into this
        /// treasury. The tender releases the money only to this
        /// component, so an approver who starts the collection cannot
        /// redirect it: the destination is this treasury, always.
        pub fn collect_tender_refund(&mut self, tender: ComponentAddress) -> Amount {
            self.assert_not_in_external_call();
            self.assert_approver();
            assert!(
                self.tenders.contains(&tender),
                "tender is not registered with this circle"
            );
            self.external_call_active = true;
            let bucket = ComponentManager::get(tender)
                .call::<&str, Bucket, Bytes>("release_refund", Vec::<Bytes>::new());
            self.external_call_active = false;
            let amount = bucket.amount();
            self.treasury.deposit(bucket);
            amount
        }

        /// Collects a registered tender's forfeited bond share into
        /// this treasury, under the same fixed destination as the
        /// refund.
        pub fn collect_tender_forfeits(&mut self, tender: ComponentAddress) -> Amount {
            self.assert_not_in_external_call();
            self.assert_approver();
            assert!(
                self.tenders.contains(&tender),
                "tender is not registered with this circle"
            );
            self.external_call_active = true;
            let bucket = ComponentManager::get(tender)
                .call::<&str, Bucket, Bytes>("release_forfeits", Vec::<Bytes>::new());
            self.external_call_active = false;
            let amount = bucket.amount();
            self.treasury.deposit(bucket);
            amount
        }

        pub fn info(&self) -> CircleInfo {
            CircleInfo {
                name: self.name.clone(),
                approvers: self.approvers.clone(),
                threshold: self.threshold,
                auditor: self.auditor,
                tenders: self.tenders.clone(),
                treasury_balance: self.treasury.balance(),
            }
        }

        fn assert_not_in_external_call(&self) {
            assert!(
                !self.external_call_active,
                "circle is executing an external call"
            );
        }

        fn assert_approver(&self) -> RistrettoPublicKeyBytes {
            let signer = CallerContext::transaction_signer_public_key();
            assert!(
                self.approvers.contains(&signer),
                "signer is not a circle approver"
            );
            signer
        }
    }

    /// Every method is listed explicitly. The default rule denies
    /// everything else. Membership gates are enforced in the methods
    /// themselves through CallerContext, because the approver set is
    /// state and can change.
    fn access_rules() -> AccessRules {
        AccessRules::new()
            .method("deposit_treasury", AccessRule::AllowAll)
            .method("treasury_balance", AccessRule::AllowAll)
            .method("propose_withdrawal", AccessRule::AllowAll)
            .method("approve_withdrawal", AccessRule::AllowAll)
            .method("propose_approver_change", AccessRule::AllowAll)
            .method("approve_approver_change", AccessRule::AllowAll)
            .method("register_tender", AccessRule::AllowAll)
            .method("collect_tender_refund", AccessRule::AllowAll)
            .method("collect_tender_forfeits", AccessRule::AllowAll)
            .method("info", AccessRule::AllowAll)
    }

    fn validate_approver_set(approvers: &[RistrettoPublicKeyBytes], threshold: u32) {
        assert!(threshold >= 1, "threshold must be at least 1");
        assert!(
            (threshold as usize) <= approvers.len(),
            "threshold exceeds approver count"
        );
        for (i, a) in approvers.iter().enumerate() {
            assert!(
                !approvers[..i].contains(a),
                "approvers must be distinct"
            );
        }
    }

    fn encode_arg<T: tari_bor::Encode<()>>(value: &T) -> Bytes {
        Bytes::from(tari_bor::encode(value).expect("argument encoding failed"))
    }

    fn event_payload(pairs: &[(&str, &str)]) -> Metadata {
        let mut metadata = Metadata::new();
        for (k, v) in pairs {
            metadata.insert(*k, *v);
        }
        metadata
    }
}
