//! Engine tests for the Circle template: creation rules, treasury
//! funding gates, threshold withdrawals paid straight to their
//! destination, and approver rotation.

use tari_template_lib::prelude::*;
use tari_template_test_tooling::{
    TemplateTest, byte_type::ToByteType, crypto::RistrettoSecretKey, transaction::args,
};

struct Keys {
    account: ComponentAddress,
    proof: NonFungibleAddress,
    secret: RistrettoSecretKey,
    key: RistrettoPublicKeyBytes,
}

fn funded(test: &mut TemplateTest) -> Keys {
    let (account, proof, secret, public) = test.create_funded_account_with_keypair();
    Keys {
        account,
        proof,
        secret,
        key: public.to_byte_type(),
    }
}

fn make_circle(test: &mut TemplateTest, keys: Vec<RistrettoPublicKeyBytes>, threshold: u32) -> ComponentAddress {
    test.call_function(
        "Circle",
        "new",
        args!["Test Circle".to_string(), keys, threshold, None::<RistrettoPublicKeyBytes>, None::<TemplateAddress>],
        vec![],
    )
}

fn treasury(test: &mut TemplateTest, circle: ComponentAddress) -> Amount {
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "treasury_balance", args![])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    test.expect_return(0)
}

fn balance(test: &mut TemplateTest, account: ComponentAddress) -> Amount {
    test.execute_expect_success(
        test.transaction()
            .call_method(account, "balance", args![TARI_TOKEN])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    test.expect_return(0)
}

fn deposit(test: &mut TemplateTest, circle: ComponentAddress, from: &Keys, amount: u128) {
    test.execute_expect_success(
        test.transaction()
            .call_method(from.account, "withdraw", args![TARI_TOKEN, Amount::new(amount)])
            .put_last_instruction_output_on_workspace("funds")
            .call_method(circle, "deposit_treasury", args![Workspace("funds")])
            .build_and_seal(&from.secret),
        vec![from.proof.clone()],
    );
}

#[test]
fn creation_rejects_bad_approver_sets() {
    let mut test = TemplateTest::my_crate();
    let a = funded(&mut test);
    let b = funded(&mut test);
    let template = test.get_template_address("Circle");
    // Threshold zero.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args!["X".to_string(), vec![a.key, b.key], 0u32, None::<RistrettoPublicKeyBytes>, None::<TemplateAddress>])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    assert!(format!("{reason}").contains("threshold"), "unexpected: {reason}");
    // Threshold above the approver count.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args!["X".to_string(), vec![a.key, b.key], 3u32, None::<RistrettoPublicKeyBytes>, None::<TemplateAddress>])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    assert!(format!("{reason}").contains("threshold"), "unexpected: {reason}");
    // A duplicated approver.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args!["X".to_string(), vec![a.key, a.key], 1u32, None::<RistrettoPublicKeyBytes>, None::<TemplateAddress>])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    assert!(format!("{reason}").contains("distinct"), "unexpected: {reason}");
    // An empty name.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_function(template, "new", args!["".to_string(), vec![a.key], 1u32, None::<RistrettoPublicKeyBytes>, None::<TemplateAddress>])
            .build_and_seal(test.secret_key()),
        vec![],
    );
    assert!(format!("{reason}").contains("name"), "unexpected: {reason}");
}

#[test]
fn treasury_accepts_member_and_approver_funds_only() {
    let mut test = TemplateTest::my_crate();
    let a = funded(&mut test);
    let b = funded(&mut test);
    let stranger = funded(&mut test);
    let circle = make_circle(&mut test, vec![a.key, b.key], 2);
    // The creator (the test default key) is a member: their deposit
    // needs funds, so use an approver and the stranger for the contrast.
    deposit(&mut test, circle, &a, 5_000);
    assert_eq!(treasury(&mut test, circle), Amount::new(5_000));
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(stranger.account, "withdraw", args![TARI_TOKEN, Amount::new(10)])
            .put_last_instruction_output_on_workspace("funds")
            .call_method(circle, "deposit_treasury", args![Workspace("funds")])
            .build_and_seal(&stranger.secret),
        vec![stranger.proof.clone()],
    );
    assert!(
        format!("{reason}").contains("only circle members"),
        "unexpected: {reason}"
    );
    assert_eq!(treasury(&mut test, circle), Amount::new(5_000));
}

#[test]
fn withdrawal_flow_full() {
    let mut test = TemplateTest::my_crate();
    let approvers = [funded(&mut test), funded(&mut test), funded(&mut test)];
    let dest = funded(&mut test);
    let keys: Vec<RistrettoPublicKeyBytes> = approvers.iter().map(|k| k.key).collect();
    let circle: ComponentAddress = test.call_function(
        "Circle",
        "new",
        args!["Flow Circle".to_string(), keys, 2u32, None::<RistrettoPublicKeyBytes>, None::<TemplateAddress>],
        vec![],
    );
    deposit(&mut test, circle, &approvers[0], 5_000);
    assert_eq!(treasury(&mut test, circle), Amount::new(5_000));

    // A non-approver cannot propose.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "propose_withdrawal", args![Amount::new(100), dest.account])
            .build_and_seal(&dest.secret),
        vec![],
    );
    assert!(format!("{reason}").contains("approver"), "unexpected: {reason}");

    // Propose 2_000 to the destination.
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "propose_withdrawal", args![Amount::new(2_000), dest.account])
            .build_and_seal(&approvers[0].secret),
        vec![],
    );
    let id: u32 = test.expect_return(0);

    // One signature: nothing moves. The same approver twice is rejected.
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "approve_withdrawal", args![id])
            .build_and_seal(&approvers[0].secret),
        vec![],
    );
    assert!(!test.expect_return::<bool>(0));
    assert_eq!(treasury(&mut test, circle), Amount::new(5_000));
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "approve_withdrawal", args![id])
            .build_and_seal(&approvers[0].secret),
        vec![],
    );
    assert!(format!("{reason}").contains("already signed"), "unexpected: {reason}");

    // The second distinct signature executes, paying the destination
    // directly.
    let dest_before = balance(&mut test, dest.account);
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "approve_withdrawal", args![id])
            .build_and_seal(&approvers[1].secret),
        vec![],
    );
    assert!(test.expect_return::<bool>(0));
    assert_eq!(treasury(&mut test, circle), Amount::new(3_000));
    let dest_after = balance(&mut test, dest.account);
    assert_eq!(dest_after - dest_before, Amount::new(2_000));

    // An executed proposal cannot be signed again.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "approve_withdrawal", args![id])
            .build_and_seal(&approvers[2].secret),
        vec![],
    );
    assert!(format!("{reason}").contains("already executed"), "unexpected: {reason}");
}

#[test]
fn approver_change_executes_and_voids_open_proposals() {
    let mut test = TemplateTest::my_crate();
    let approvers = [funded(&mut test), funded(&mut test), funded(&mut test)];
    let dest = funded(&mut test);
    let keys: Vec<RistrettoPublicKeyBytes> = approvers.iter().map(|k| k.key).collect();
    let circle: ComponentAddress = test.call_function(
        "Circle",
        "new",
        args!["Rotation Circle".to_string(), keys, 2u32, None::<RistrettoPublicKeyBytes>, None::<TemplateAddress>],
        vec![],
    );
    deposit(&mut test, circle, &approvers[0], 5_000);

    // An open withdrawal proposal exists before the rotation.
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "propose_withdrawal", args![Amount::new(500), dest.account])
            .build_and_seal(&approvers[0].secret),
        vec![],
    );
    let withdrawal_id: u32 = test.expect_return(0);

    // Rotate: replace approver 2 with the destination key.
    let mut new_keys: Vec<RistrettoPublicKeyBytes> = approvers.iter().map(|k| k.key).collect();
    new_keys[2] = dest.key;
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "propose_approver_change", args![new_keys.clone(), 2u32])
            .build_and_seal(&approvers[0].secret),
        vec![],
    );
    let change_id: u32 = test.expect_return(0);
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "approve_approver_change", args![change_id])
            .build_and_seal(&approvers[0].secret),
        vec![],
    );
    assert!(!test.expect_return::<bool>(0));
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "approve_approver_change", args![change_id])
            .build_and_seal(&approvers[1].secret),
        vec![],
    );
    assert!(test.expect_return::<bool>(0));

    // The rotated-out approver can no longer act.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "propose_withdrawal", args![Amount::new(1), dest.account])
            .build_and_seal(&approvers[2].secret),
        vec![],
    );
    assert!(format!("{reason}").contains("approver"), "unexpected: {reason}");

    // The pre-rotation withdrawal proposal is void.
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "approve_withdrawal", args![withdrawal_id])
            .build_and_seal(&approvers[0].secret),
        vec![],
    );
    assert!(format!("{reason}").contains("void"), "unexpected: {reason}");

    // The new approver can act.
    test.execute_expect_success(
        test.transaction()
            .call_method(circle, "propose_withdrawal", args![Amount::new(1), dest.account])
            .build_and_seal(&dest.secret),
        vec![],
    );
}

#[test]
fn register_tender_requires_an_approver() {
    let mut test = TemplateTest::my_crate();
    let approvers = [funded(&mut test), funded(&mut test)];
    let stranger = funded(&mut test);
    let keys: Vec<RistrettoPublicKeyBytes> = approvers.iter().map(|k| k.key).collect();
    let circle: ComponentAddress = test.call_function(
        "Circle",
        "new",
        args!["Threshold Circle".to_string(), keys, 2u32, None::<RistrettoPublicKeyBytes>, None::<TemplateAddress>],
        vec![],
    );
    let reason = test.execute_expect_failure(
        test.transaction()
            .call_method(circle, "register_tender", args![stranger.account])
            .build_and_seal(&stranger.secret),
        vec![],
    );
    assert!(format!("{reason}").contains("approver"), "unexpected: {reason}");
}
