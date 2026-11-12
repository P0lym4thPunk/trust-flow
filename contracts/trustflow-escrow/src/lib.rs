#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, BytesN, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    UnsupportedToken = 4,
    Unauthorized = 5,
    IdenticalParties = 6,
    InvalidAmount = 7,
    InvalidDeadline = 8,
    InvalidParameters = 9,
    WrongState = 10,
    MissingAcceptance = 11,
    HashMismatch = 12,
    VersionMismatch = 13,
    NotPayer = 14,
    NotRecipient = 15,
    NotApprover = 16,
    DeadlinePassed = 17,
    DeadlineNotPassed = 18,
    AlreadyReleased = 19,
    CannotCancelFunded = 20,
    NotFound = 21,
    NoActiveCancelRequest = 22,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    Created = 0,
    Funded = 1,
    FulfilmentSubmitted = 2,
    Approved = 3,
    Released = 4,
    Refunded = 5,
    Cancelled = 6,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CancelRequestState {
    None = 0,
    RequestedByPayer = 1,
    RequestedByRecipient = 2,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Initialized,
    NextEscrowId,
    SupportedToken(Address),
    Escrow(u64),
}

const INSTANCE_BUMP_THRESHOLD: u32 = 50_000;
const INSTANCE_EXTEND_TO: u32 = 100_000;
const PERSISTENT_BUMP_THRESHOLD: u32 = 50_000;
const PERSISTENT_EXTEND_TO: u32 = 100_000;

fn extend_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_EXTEND_TO);
}

fn extend_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_EXTEND_TO);
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EscrowRecord {
    pub escrow_id: u64,
    pub payer: Address,
    pub recipient: Address,
    pub approver: Address,
    pub token: Address,
    pub amount: i128,
    pub deadline: u64,
    pub agreement_hash: BytesN<32>,
    pub version: u32,
    pub payer_accepted: bool,
    pub recipient_accepted: bool,
    pub status: EscrowStatus,
    pub cancel_request: CancelRequestState,
    pub fulfilment_hash: BytesN<32>,
    pub rejection_reason_hash: BytesN<32>,
    pub created_at: u64,
    pub funded_at: u64,
    pub completed_at: u64,
}

#[contract]
pub struct TrustFlowEscrow;

#[contractimpl]
impl TrustFlowEscrow {
    /// One-time secure initialization
    pub fn initialize(
        env: Env,
        admin: Address,
        xlm_token: Address,
        usdc_token: Address,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Initialized, &true);
        extend_instance(&env);

        let xlm_key = DataKey::SupportedToken(xlm_token.clone());
        let usdc_key = DataKey::SupportedToken(usdc_token.clone());
        env.storage().persistent().set(&xlm_key, &true);
        env.storage().persistent().set(&usdc_key, &true);
        extend_persistent(&env, &xlm_key);
        extend_persistent(&env, &usdc_key);

        let counter_key = DataKey::NextEscrowId;
        env.storage().persistent().set(&counter_key, &1u64);
        extend_persistent(&env, &counter_key);

        Ok(())
    }

    /// Admin can update the supported token allowlist
    pub fn update_token_allowlist(env: Env, token: Address, allowed: bool) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();
        extend_instance(&env);

        let key = DataKey::SupportedToken(token);
        if allowed {
            env.storage().persistent().set(&key, &true);
            extend_persistent(&env, &key);
        } else {
            env.storage().persistent().remove(&key);
        }
        Ok(())
    }

    /// Creates an escrow with sequential ID. Creator must be payer or recipient.
    pub fn create_escrow(
        env: Env,
        creator: Address,
        payer: Address,
        recipient: Address,
        approver: Address,
        token: Address,
        amount: i128,
        deadline: u64,
        agreement_hash: BytesN<32>,
        version: u32,
    ) -> Result<u64, Error> {
        creator.require_auth();

        // Creator must be either payer or recipient
        if creator != payer && creator != recipient {
            return Err(Error::Unauthorized);
        }

        // Complete participant distinctness
        if payer == recipient || payer == approver || recipient == approver {
            return Err(Error::IdenticalParties);
        }

        // Token allowlist check
        let token_key = DataKey::SupportedToken(token.clone());
        let is_supported: bool = env.storage().persistent().get(&token_key).unwrap_or(false);
        if !is_supported {
            return Err(Error::UnsupportedToken);
        }
        extend_persistent(&env, &token_key);

        // Positive amount & future deadline
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::InvalidDeadline);
        }
        if version == 0 {
            return Err(Error::InvalidParameters);
        }

        // Monotonic persistent counter
        let counter_key = DataKey::NextEscrowId;
        let escrow_id: u64 = env.storage().persistent().get(&counter_key).unwrap_or(1);
        env.storage().persistent().set(&counter_key, &(escrow_id + 1));
        extend_persistent(&env, &counter_key);

        let empty_hash = BytesN::from_array(&env, &[0u8; 32]);
        let record = EscrowRecord {
            escrow_id,
            payer,
            recipient,
            approver,
            token,
            amount,
            deadline,
            agreement_hash,
            version,
            payer_accepted: false,
            recipient_accepted: false,
            status: EscrowStatus::Created,
            cancel_request: CancelRequestState::None,
            fulfilment_hash: empty_hash.clone(),
            rejection_reason_hash: empty_hash,
            created_at: env.ledger().timestamp(),
            funded_at: 0,
            completed_at: 0,
        };

        let escrow_key = DataKey::Escrow(escrow_id);
        env.storage().persistent().set(&escrow_key, &record);
        extend_persistent(&env, &escrow_key);

        Ok(escrow_id)
    }

    /// Records explicit on-chain acceptance from payer or recipient
    pub fn record_acceptance(
        env: Env,
        escrow_id: u64,
        participant: Address,
        agreement_hash: BytesN<32>,
        version: u32,
    ) -> Result<(), Error> {
        participant.require_auth();

        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        if record.status != EscrowStatus::Created {
            return Err(Error::WrongState);
        }
        if record.agreement_hash != agreement_hash {
            return Err(Error::HashMismatch);
        }
        if record.version != version {
            return Err(Error::VersionMismatch);
        }

        if participant == record.payer {
            record.payer_accepted = true;
        } else if participant == record.recipient {
            record.recipient_accepted = true;
        } else {
            return Err(Error::Unauthorized);
        }

        env.storage().persistent().set(&escrow_key, &record);
        Ok(())
    }

    /// Payer funds the escrow after dual acceptance
    pub fn fund_escrow(env: Env, escrow_id: u64) -> Result<(), Error> {
        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        record.payer.require_auth();

        if record.status != EscrowStatus::Created {
            return Err(Error::WrongState);
        }
        if !record.payer_accepted || !record.recipient_accepted {
            return Err(Error::MissingAcceptance);
        }
        if env.ledger().timestamp() >= record.deadline {
            return Err(Error::DeadlinePassed);
        }

        // Defensive state ordering: update state before token transfer
        record.status = EscrowStatus::Funded;
        record.funded_at = env.ledger().timestamp();
        env.storage().persistent().set(&escrow_key, &record);

        let token_client = token::Client::new(&env, &record.token);
        token_client.transfer(
            &record.payer,
            &env.current_contract_address(),
            &record.amount,
        );

        Ok(())
    }

    /// Recipient submits fulfilment deliverables before deadline
    pub fn submit_fulfilment(
        env: Env,
        escrow_id: u64,
        fulfilment_hash: BytesN<32>,
    ) -> Result<(), Error> {
        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        record.recipient.require_auth();

        if record.status != EscrowStatus::Funded {
            return Err(Error::WrongState);
        }
        if env.ledger().timestamp() > record.deadline {
            return Err(Error::DeadlinePassed);
        }

        record.status = EscrowStatus::FulfilmentSubmitted;
        record.fulfilment_hash = fulfilment_hash;
        env.storage().persistent().set(&escrow_key, &record);

        Ok(())
    }

    /// Approver approves fulfilment condition -> Unlocks release
    pub fn approve_condition(env: Env, escrow_id: u64) -> Result<(), Error> {
        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        record.approver.require_auth();

        if record.status != EscrowStatus::FulfilmentSubmitted {
            return Err(Error::WrongState);
        }

        record.status = EscrowStatus::Approved;
        env.storage().persistent().set(&escrow_key, &record);

        Ok(())
    }

    /// Approver rejects fulfilment -> Transitions directly to refund
    pub fn reject_fulfilment(
        env: Env,
        escrow_id: u64,
        reason_hash: BytesN<32>,
    ) -> Result<(), Error> {
        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        record.approver.require_auth();

        if record.status != EscrowStatus::FulfilmentSubmitted {
            return Err(Error::WrongState);
        }

        record.status = EscrowStatus::Refunded;
        record.rejection_reason_hash = reason_hash;
        record.completed_at = env.ledger().timestamp();
        env.storage().persistent().set(&escrow_key, &record);

        let token_client = token::Client::new(&env, &record.token);
        token_client.transfer(
            &env.current_contract_address(),
            &record.payer,
            &record.amount,
        );

        Ok(())
    }

    /// Request mutual cancellation when funded
    pub fn request_cancel(env: Env, escrow_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        if record.status != EscrowStatus::Funded
            && record.status != EscrowStatus::FulfilmentSubmitted
        {
            return Err(Error::WrongState);
        }

        if caller == record.payer {
            record.cancel_request = CancelRequestState::RequestedByPayer;
        } else if caller == record.recipient {
            record.cancel_request = CancelRequestState::RequestedByRecipient;
        } else {
            return Err(Error::Unauthorized);
        }

        env.storage().persistent().set(&escrow_key, &record);
        Ok(())
    }

    /// Withdraws an unconfirmed cancellation request
    pub fn withdraw_cancel_request(env: Env, escrow_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        if (caller == record.payer
            && record.cancel_request == CancelRequestState::RequestedByPayer)
            || (caller == record.recipient
                && record.cancel_request == CancelRequestState::RequestedByRecipient)
        {
            record.cancel_request = CancelRequestState::None;
            env.storage().persistent().set(&escrow_key, &record);
            Ok(())
        } else {
            Err(Error::NoActiveCancelRequest)
        }
    }

    /// Confirms mutual cancellation by the counterparty -> refunds payer
    pub fn confirm_cancel(env: Env, escrow_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        if record.status != EscrowStatus::Funded
            && record.status != EscrowStatus::FulfilmentSubmitted
        {
            return Err(Error::WrongState);
        }

        let is_valid_confirmation = (record.cancel_request
            == CancelRequestState::RequestedByPayer
            && caller == record.recipient)
            || (record.cancel_request == CancelRequestState::RequestedByRecipient
                && caller == record.payer);

        if !is_valid_confirmation {
            return Err(Error::Unauthorized);
        }

        record.status = EscrowStatus::Refunded;
        record.completed_at = env.ledger().timestamp();
        env.storage().persistent().set(&escrow_key, &record);

        let token_client = token::Client::new(&env, &record.token);
        token_client.transfer(
            &env.current_contract_address(),
            &record.payer,
            &record.amount,
        );

        Ok(())
    }

    /// Timeout refund if no fulfilment was submitted before deadline
    pub fn refund_timeout(env: Env, escrow_id: u64) -> Result<(), Error> {
        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        record.payer.require_auth();

        if record.status != EscrowStatus::Funded {
            return Err(Error::WrongState);
        }
        if env.ledger().timestamp() <= record.deadline {
            return Err(Error::DeadlineNotPassed);
        }

        record.status = EscrowStatus::Refunded;
        record.completed_at = env.ledger().timestamp();
        env.storage().persistent().set(&escrow_key, &record);

        let token_client = token::Client::new(&env, &record.token);
        token_client.transfer(
            &env.current_contract_address(),
            &record.payer,
            &record.amount,
        );

        Ok(())
    }

    /// Permissionless release of approved funds directly to stored recipient
    pub fn release_funds(env: Env, escrow_id: u64) -> Result<(), Error> {
        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        if record.status == EscrowStatus::Released {
            return Err(Error::AlreadyReleased);
        }
        if record.status != EscrowStatus::Approved {
            return Err(Error::WrongState);
        }

        record.status = EscrowStatus::Released;
        record.completed_at = env.ledger().timestamp();
        env.storage().persistent().set(&escrow_key, &record);

        let token_client = token::Client::new(&env, &record.token);
        token_client.transfer(
            &env.current_contract_address(),
            &record.recipient,
            &record.amount,
        );

        Ok(())
    }

    /// Cancel unfunded escrow before tokens are deposited
    pub fn cancel_unfunded(env: Env, escrow_id: u64, caller: Address) -> Result<(), Error> {
        caller.require_auth();

        let escrow_key = DataKey::Escrow(escrow_id);
        let mut record: EscrowRecord = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);

        if record.status != EscrowStatus::Created {
            return Err(Error::CannotCancelFunded);
        }
        if caller != record.payer && caller != record.recipient {
            return Err(Error::Unauthorized);
        }

        record.status = EscrowStatus::Cancelled;
        record.completed_at = env.ledger().timestamp();
        env.storage().persistent().set(&escrow_key, &record);

        Ok(())
    }

    /// Read-only inspection of escrow state
    pub fn get_escrow(env: Env, escrow_id: u64) -> Result<EscrowRecord, Error> {
        let escrow_key = DataKey::Escrow(escrow_id);
        let record = env
            .storage()
            .persistent()
            .get(&escrow_key)
            .ok_or(Error::NotFound)?;
        extend_persistent(&env, &escrow_key);
        Ok(record)
    }
}
