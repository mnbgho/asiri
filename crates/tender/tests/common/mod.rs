//! Shared setup for the Tender template engine tests.
//!
//! Every test runs against the real in-process engine with both the
//! Circle and Tender templates loaded. Approvers are funded accounts, so
//! the account key of an approver is the key that seals their calls.
//! Sellers are funded accounts too: the account key is the payment
//! identity their commitment binds.

#![allow(dead_code)]

use asiri_types::{commitment_bytes, TenderRules};
use sha2::{Digest, Sha256};
use tari_template_lib::prelude::*;
use tari_template_test_tooling::{
    TemplateTest,
    byte_type::ToByteType,
    crypto::RistrettoSecretKey,
    engine_types::virtual_substate::{VirtualSubstate, VirtualSubstateId},
    transaction::args,
};

pub const CAP: u128 = 10_000;
pub const BOND: u128 = 100;

pub struct Setup {
    pub test: TemplateTest,
    pub circle: ComponentAddress,
    pub tender: ComponentAddress,
    pub receipt_resource: Option<ResourceAddress>,
    /// (account, proof, secret, public key bytes) per approver.
    pub approvers: Vec<(ComponentAddress, NonFungibleAddress, RistrettoSecretKey, RistrettoPublicKeyBytes)>,
    pub rules: TenderRules,
}

pub fn default_rules() -> TenderRules {
    TenderRules {
        specification_hash: Hash32::from_array([9u8; 32]),
        budget_cap: Amount::new(CAP),
        bond_amount: Amount::new(BOND),
        bid_window_epochs: 5,
        reveal_window_epochs: 5,
        override_window_epochs: 3,
        delivery_window_epochs: 5,
        claim_grace_epochs: 3,
        dispute_window_epochs: 4,
        approval_threshold: 2,
        dispute_threshold: 3,
    }
}

pub fn commitment_for(price: u128, salt: &[u8; 32], identity: &RistrettoPublicKeyBytes) -> Hash32 {
    let bytes = commitment_bytes(Amount::new(price), salt, identity);
    let digest = Sha256::digest(&bytes);
    Hash32::from_array(digest.into())
}

pub fn set_epoch(test: &mut TemplateTest, epoch: u64) {
    test.set_virtual_substate(
        VirtualSubstateId::CurrentEpoch,
        VirtualSubstate::CurrentEpoch(epoch),
    );
}

/// Builds a circle with three approvers (threshold 2), a receipt
/// resource, and a bound tender in Draft, funded by nothing yet.
pub fn setup() -> Setup {
    setup_with_rules(default_rules())
}

pub fn setup_with_rules(rules: TenderRules) -> Setup {
    let mut test = TemplateTest::new("..", ["circle", "tender"]);
    let mut approvers = Vec::new();
    for _ in 0..3 {
        let (account, proof, secret, public) = test.create_funded_account_with_keypair();
        approvers.push((account, proof, secret, public.to_byte_type()));
    }
    let approver_keys: Vec<RistrettoPublicKeyBytes> =
        approvers.iter().map(|a| a.3).collect();
    let circle: ComponentAddress = test.call_function(
        "Circle",
        "new",
        args!["Uyo Shopkeepers Circle".to_string(), approver_keys.clone(), 2u32, Some(approver_keys[0]), Some(test.get_template_address("Tender"))],
        vec![],
    );
    let tender: ComponentAddress = test.call_function(
        "Tender",
        "new",
        args![circle, rules.clone()],
        vec![],
    );
    // Register (and thereby bind) the tender, sealed by approver 0.
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "register_tender", args![tender])
            .build_and_seal(&approvers[0].2),
        vec![],
    );
    // The tender created its own receipt resource in its constructor.
    test.execute_expect_success(
        test.transaction()
            .call_method(tender, "info", args![])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    let receipt_resource = test
        .expect_return::<asiri_types::TenderInfo>(0)
        .receipt_resource;
    Setup {
        test,
        circle,
        tender,
        receipt_resource,
        approvers,
        rules,
    }
}

/// Locks the rules and funds the escrow from approver 0's account.
pub fn lock(s: &mut Setup) {
    let (account, proof, secret, _) = &s.approvers[0];
    let (account, proof, secret) = (*account, proof.clone(), secret.clone());
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(account, "withdraw", args![TARI_TOKEN, Amount::new(CAP)])
            .put_last_instruction_output_on_workspace("escrow")
            .call_method(s.tender, "lock_and_fund", args![Workspace("escrow")])
            .build_and_seal(&secret),
        vec![proof],
    );
}

pub struct Seller {
    pub account: ComponentAddress,
    pub proof: NonFungibleAddress,
    pub secret: RistrettoSecretKey,
    pub key: RistrettoPublicKeyBytes,
    pub salt: [u8; 32],
}

pub fn make_seller(test: &mut TemplateTest, salt_seed: u8) -> Seller {
    let (account, proof, secret, public) = test.create_funded_account_with_keypair();
    Seller {
        account,
        proof,
        secret,
        key: public.to_byte_type(),
        salt: [salt_seed; 32],
    }
}

pub fn commit(s: &mut Setup, seller: &Seller, price: u128) {
    let commitment = commitment_for(price, &seller.salt, &seller.key);
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(seller.account, "withdraw", args![TARI_TOKEN, Amount::new(BOND)])
            .put_last_instruction_output_on_workspace("bond")
            .call_method(s.tender, "commit_bid", args![commitment, Workspace("bond")])
            .build_and_seal(&seller.secret),
        vec![seller.proof.clone()],
    );
}

pub fn reveal(s: &mut Setup, seller: &Seller, price: u128) {
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(
                s.tender,
                "reveal_bid",
                args![Amount::new(price), seller.salt.to_vec(), seller.key],
            )
            .build_and_seal(&seller.secret),
        vec![],
    );
}

pub fn info(s: &mut Setup) -> asiri_types::TenderInfo {
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "info", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
    s.test.expect_return(0)
}

pub fn balance(test: &mut TemplateTest, account: ComponentAddress) -> Amount {
    test.execute_expect_success(
        test.transaction()
            .call_method(account, "balance", args![TARI_TOKEN])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    test.expect_return(0)
}

pub fn close_reveal(s: &mut Setup) {
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "close_reveal", args![])
            .build_and_seal(s.test.secret_key()),
        vec![],
    );
}

pub fn confirm_delivery(s: &mut Setup, approver_idx: usize) {
    let secret = s.approvers[approver_idx].2.clone();
    s.test.execute_expect_success(
        s.test
            .transaction()
            .call_method(s.tender, "confirm_delivery", args![])
            .build_and_seal(&secret),
        vec![],
    );
}
