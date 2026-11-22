//! Shared types for the Asiri templates.
//!
//! The Circle and Tender templates are separate templates, so the values
//! that pass between them, and the public records they return, live here
//! once and are used by both. Every encoding in this file is fixed and
//! documented so that an independent implementation can reproduce it byte
//! for byte.

use minicbor::{CborLen, Decode, Encode};
use tari_template_lib_types::crypto::RistrettoPublicKeyBytes;
use tari_template_lib_types::{Amount, ComponentAddress, Hash32, NonFungibleId, ResourceAddress};

/// The rules of a tender. They are proposed while the tender is a draft,
/// and the moment the tender is funded they are locked: no method in
/// either template writes them again.
#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, CborLen)]
pub struct TenderRules {
    /// Hash of the specification document the circle published.
    #[n(0)]
    pub specification_hash: Hash32,
    /// The most the tender can pay. The escrow is funded with exactly this.
    #[n(1)]
    pub budget_cap: Amount,
    /// The bond every seller posts with a bid commitment.
    #[n(2)]
    pub bond_amount: Amount,
    #[n(3)]
    pub bid_window_epochs: u64,
    #[n(4)]
    pub reveal_window_epochs: u64,
    #[n(5)]
    pub override_window_epochs: u64,
    #[n(6)]
    pub delivery_window_epochs: u64,
    #[n(7)]
    pub claim_grace_epochs: u64,
    #[n(8)]
    pub dispute_window_epochs: u64,
    /// Distinct approver signatures needed to confirm delivery or to
    /// execute an override.
    #[n(9)]
    pub approval_threshold: u32,
    /// Distinct approver signatures needed to resolve a dispute. Always
    /// higher than the approval threshold.
    #[n(10)]
    pub dispute_threshold: u32,
}

/// The canonical byte encoding of a rules set, in a fixed field order with
/// fixed width big endian integers. The Tender template hashes exactly
/// these bytes with SHA-256 at the moment the rules lock, and anyone can
/// recompute the same bytes from the displayed rules.
pub fn canonical_rules_bytes(rules: &TenderRules) -> Vec<u8> {
    let mut out = Vec::with_capacity(168);
    out.extend_from_slice(b"asiri-rules-v1");
    out.extend_from_slice(rules.specification_hash.as_slice());
    out.extend_from_slice(&amount_u128(rules.budget_cap).to_be_bytes());
    out.extend_from_slice(&amount_u128(rules.bond_amount).to_be_bytes());
    out.extend_from_slice(&rules.bid_window_epochs.to_be_bytes());
    out.extend_from_slice(&rules.reveal_window_epochs.to_be_bytes());
    out.extend_from_slice(&rules.override_window_epochs.to_be_bytes());
    out.extend_from_slice(&rules.delivery_window_epochs.to_be_bytes());
    out.extend_from_slice(&rules.claim_grace_epochs.to_be_bytes());
    out.extend_from_slice(&rules.dispute_window_epochs.to_be_bytes());
    out.extend_from_slice(&rules.approval_threshold.to_be_bytes());
    out.extend_from_slice(&rules.dispute_threshold.to_be_bytes());
    out
}

/// The byte encoding of a bid commitment's preimage, in a fixed layout:
/// the domain bytes, the price as a 16 byte big endian integer, the 32
/// byte salt, and the 32 byte payment identity. The Tender template
/// hashes exactly these bytes with SHA-256.
pub fn commitment_bytes(price: Amount, salt: &[u8; 32], payment_identity: &RistrettoPublicKeyBytes) -> Vec<u8> {
    let mut out = Vec::with_capacity(92);
    out.extend_from_slice(b"asiri-bid-v1");
    out.extend_from_slice(&amount_u128(price).to_be_bytes());
    out.extend_from_slice(salt);
    out.extend_from_slice(payment_identity.as_bytes());
    out
}

/// Extracts the integer value of an amount. Amounts in Tari are unsigned
/// 128 bit integers of the smallest unit.
pub fn amount_u128(amount: Amount) -> u128 {
    u128::from_le_bytes(amount.to_canonical_bytes())
}

/// The eight states of a tender, in lifecycle order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Encode, Decode, CborLen)]
pub enum TenderState {
    #[n(0)]
    Draft,
    #[n(1)]
    Open,
    #[n(2)]
    Reveal,
    #[n(3)]
    Awarded,
    #[n(4)]
    AwaitingDelivery,
    #[n(5)]
    Settled,
    #[n(6)]
    Expired,
    #[n(7)]
    Disputed,
}

/// The award the template computed at the close of the reveal window, or
/// the winner an executed override put in its place.
#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, CborLen)]
pub struct AwardRecord {
    #[n(0)]
    pub winner: RistrettoPublicKeyBytes,
    #[n(1)]
    pub winning_commitment: Hash32,
    #[n(2)]
    pub winning_price: Amount,
    #[n(3)]
    pub commitments_count: u64,
    #[n(4)]
    pub reveals_count: u64,
    #[n(5)]
    pub epoch: u64,
    /// True when an executed override replaced the computed award.
    #[n(6)]
    pub by_override: bool,
}

/// The public record of an executed override.
#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, CborLen)]
pub struct OverrideRecord {
    /// The seller the circle chose instead. None means the circle
    /// cancelled the tender after bids existed.
    #[n(0)]
    pub chosen: Option<RistrettoPublicKeyBytes>,
    #[n(1)]
    pub rationale_hash: Hash32,
    #[n(2)]
    pub epoch: u64,
}

/// The public record of a delivery dispute.
#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, CborLen)]
pub struct DisputeRecord {
    #[n(0)]
    pub evidence_hash: Hash32,
    #[n(1)]
    pub epoch: u64,
    /// Set when approvers resolved the dispute. True means the winner was
    /// paid, false means the circle was refunded. Left unset when the
    /// dispute window closed with no resolution.
    #[n(2)]
    pub resolved_for_winner: Option<bool>,
    #[n(3)]
    pub rationale_hash: Option<Hash32>,
}

/// The public record of a settlement.
#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, CborLen)]
pub struct SettlementRecord {
    #[n(0)]
    pub winner: RistrettoPublicKeyBytes,
    #[n(1)]
    pub price: Amount,
    #[n(2)]
    pub epoch: u64,
}

/// Everything about a tender that is deliberately public, returned by the
/// Tender template's info method. The verify tooling reads exactly this.
#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, CborLen)]
pub struct TenderInfo {
    #[n(0)]
    pub circle: ComponentAddress,
    #[n(1)]
    pub circle_name: String,
    /// True once the named circle has registered this tender as its own.
    #[n(2)]
    pub bound: bool,
    #[n(3)]
    pub state: TenderState,
    #[n(4)]
    pub rules: TenderRules,
    #[n(5)]
    pub rules_hash: Option<Hash32>,
    #[n(6)]
    pub approvers: Vec<RistrettoPublicKeyBytes>,
    #[n(7)]
    pub lock_epoch: Option<u64>,
    #[n(8)]
    pub bid_deadline: Option<u64>,
    #[n(9)]
    pub reveal_deadline: Option<u64>,
    #[n(10)]
    pub override_deadline: Option<u64>,
    #[n(11)]
    pub delivery_deadline: Option<u64>,
    #[n(12)]
    pub claim_deadline: Option<u64>,
    #[n(13)]
    pub commitments_count: u64,
    #[n(14)]
    pub reveals_count: u64,
    #[n(15)]
    pub award: Option<AwardRecord>,
    #[n(16)]
    pub override_record: Option<OverrideRecord>,
    #[n(17)]
    pub dispute: Option<DisputeRecord>,
    #[n(18)]
    pub settlement: Option<SettlementRecord>,
    #[n(19)]
    pub receipt_resource: Option<ResourceAddress>,
    /// Forfeited bond halves waiting for the circle.
    #[n(20)]
    pub forfeit_for_circle: Amount,
    /// Forfeited bond halves locked in the tender permanently. No method
    /// can release them, so they can never be spent again.
    #[n(21)]
    pub forfeit_locked: Amount,
    /// The receipt issued to the winner at settlement, once claimed.
    #[n(22)]
    pub receipt_id: Option<NonFungibleId>,
}

/// Everything about a circle that is deliberately public.
#[derive(Debug, Clone, PartialEq, Eq, Encode, Decode, CborLen)]
pub struct CircleInfo {
    #[n(0)]
    pub name: String,
    #[n(1)]
    pub approvers: Vec<RistrettoPublicKeyBytes>,
    #[n(2)]
    pub threshold: u32,
    #[n(3)]
    pub auditor: Option<RistrettoPublicKeyBytes>,
    #[n(4)]
    pub tenders: Vec<ComponentAddress>,
    #[n(5)]
    pub treasury_balance: Amount,
}
