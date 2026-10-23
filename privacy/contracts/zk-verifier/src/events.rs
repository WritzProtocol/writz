use soroban_sdk::{contractevent, BytesN};

use crate::types::CircuitId;

/// Emitted whenever a circuit's verification key is set or replaced.
///
/// This is the audit trail for VK rotation: `set_verification_key` can be
/// called by the admin at any time with no version history and no grace
/// period (the new key takes effect immediately and retroactively for any
/// proof verified after the call) - see the note on `set_verification_key`
/// in `lib.rs` for why dual-acceptance of the old key was deliberately not
/// implemented. This event is the record of when and how many times a
/// circuit's key has changed, since the contract's storage only ever holds
/// the current key.
#[contractevent(topics = ["vk_rotated"])]
pub struct VkRotatedEvent {
    #[topic]
    pub new_vk_hash: BytesN<32>,
    pub circuit: CircuitId,
    /// All-zero when this is the first key ever set for this circuit
    /// (nothing to rotate from) - a real ceremony's fingerprint is
    /// astronomically unlikely to hash to all zeros, so this is an
    /// unambiguous sentinel rather than a plausible collision.
    pub old_vk_hash: BytesN<32>,
}
