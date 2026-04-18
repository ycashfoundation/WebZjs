// Copyright 2024 ChainSafe Systems
// SPDX-License-Identifier: Apache-2.0, MIT

use std::str::FromStr;
use wasm_bindgen::prelude::*;

use crate::error::Error;
use bip0039::{Count, English, Mnemonic};
use webzjs_common::Network;
use zip32::AccountId;

/// A ZIP32 seed fingerprint. Essentially a Blake2b hash of the seed.
///
/// This is a wrapper around the `zip32::fingerprint::SeedFingerprint` type.
///
#[wasm_bindgen]
pub struct SeedFingerprint {
    inner: zip32::fingerprint::SeedFingerprint,
}
#[wasm_bindgen]
impl SeedFingerprint {
    /// Construct a new SeedFingerprint
    ///
    /// # Arguments
    ///
    /// * `seed` - At least 32 bytes of entry. Care should be taken as to how this is derived
    ///
    #[wasm_bindgen(constructor)]
    pub fn new(seed: Box<[u8]>) -> Result<SeedFingerprint, Error> {
        Ok(Self {
            inner: zip32::fingerprint::SeedFingerprint::from_seed(&seed)
                .ok_or(Error::SeedFingerprint)?,
        })
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        self.inner.to_bytes().to_vec()
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<SeedFingerprint, Error> {
        let bytes: [u8; 32] = bytes.try_into().map_err(|_| Error::SeedFingerprint)?;
        Ok(Self {
            inner: zip32::fingerprint::SeedFingerprint::from_bytes(bytes),
        })
    }

    /// Derive a SeedFingerprint from a BIP39 seed phrase. The phrase is converted
    /// to its 64-byte seed via PBKDF2 (empty passphrase), then hashed. Primary
    /// consumer is a browser-side signing backend that keeps the phrase itself
    /// outside the Rust heap.
    pub fn from_seed_phrase(seed_phrase: &str) -> Result<SeedFingerprint, Error> {
        let mnemonic = <Mnemonic<English>>::from_phrase(seed_phrase)
            .map_err(|_| Error::InvalidSeedPhrase)?;
        let seed = mnemonic.to_seed("");
        Ok(Self {
            inner: zip32::fingerprint::SeedFingerprint::from_seed(&seed)
                .ok_or(Error::SeedFingerprint)?,
        })
    }
}

impl From<SeedFingerprint> for zip32::fingerprint::SeedFingerprint {
    fn from(value: SeedFingerprint) -> Self {
        value.inner
    }
}

impl From<zip32::fingerprint::SeedFingerprint> for SeedFingerprint {
    fn from(value: zip32::fingerprint::SeedFingerprint) -> Self {
        Self { inner: value }
    }
}
/// A Zcash Sapling proof generation key
///
/// This is a wrapper around the `sapling::ProofGenerationKey` type. It is used for generating proofs for Sapling PCZTs.
#[wasm_bindgen]
pub struct ProofGenerationKey {
    inner: sapling::ProofGenerationKey,
}

impl From<ProofGenerationKey> for sapling::ProofGenerationKey {
    fn from(value: ProofGenerationKey) -> sapling::ProofGenerationKey {
        value.inner
    }
}

impl From<sapling::ProofGenerationKey> for ProofGenerationKey {
    fn from(value: sapling::ProofGenerationKey) -> Self {
        Self { inner: value }
    }
}

#[wasm_bindgen]
impl ProofGenerationKey {
    /// Serialize the Sapling proof-generation key as the 64-byte concatenation
    /// `ak || nsk`. Both halves are 32-byte canonical jubjub encodings.
    ///
    /// Used by the Ycash MetaMask snap to hand the proof-generation key back
    /// to the web wallet so the dapp can run the PCZT Prover role locally
    /// (the snap sandbox can't load the Sapling proving params).
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(64);
        out.extend_from_slice(&self.inner.ak.to_bytes());
        out.extend_from_slice(&self.inner.nsk.to_bytes());
        out
    }

    /// Reconstruct a `ProofGenerationKey` from the 64-byte `ak || nsk` layout
    /// produced by [`Self::to_bytes`]. Uses sapling-crypto's `temporary-zcashd`
    /// escape hatch to reconstruct the `SpendValidatingKey` — there is no
    /// stable public constructor for it, and we accept the escape hatch name
    /// because the bytes we're feeding in came from `to_bytes()` above, not
    /// user input.
    pub fn from_bytes(bytes: &[u8]) -> Result<ProofGenerationKey, Error> {
        if bytes.len() != 64 {
            return Err(Error::ProofGenKey(format!(
                "ProofGenerationKey::from_bytes: expected 64 bytes, got {}",
                bytes.len()
            )));
        }
        let ak = sapling::keys::SpendValidatingKey::temporary_zcash_from_bytes(&bytes[0..32])
            .ok_or_else(|| {
                Error::ProofGenKey("ProofGenerationKey::from_bytes: invalid ak".to_string())
            })?;
        let nsk_bytes: [u8; 32] = bytes[32..64].try_into().expect("slice length is 32");
        let nsk_opt: Option<jubjub::Fr> = jubjub::Fr::from_bytes(&nsk_bytes).into();
        let nsk = nsk_opt.ok_or_else(|| {
            Error::ProofGenKey("ProofGenerationKey::from_bytes: invalid nsk".to_string())
        })?;
        Ok(ProofGenerationKey {
            inner: sapling::ProofGenerationKey { ak, nsk },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Round-trip a PGK derived from a deterministic seed through
    /// to_bytes/from_bytes and verify the reconstructed bytes match. This is
    /// the core correctness claim that the snap signing backend depends on —
    /// if it ever regresses, shielded sends through the snap will silently
    /// fail at proving time.
    #[test]
    fn pgk_round_trip_preserves_bytes() {
        // BIP39 all-zero test seed: 32 bytes of 0x00. Not a real mnemonic,
        // but `UnifiedSpendingKey::new` accepts any ≥32-byte input directly.
        let seed = vec![0u8; 32];
        let usk = UnifiedSpendingKey::new("main", seed.into_boxed_slice(), 0)
            .expect("usk derivation must succeed");
        let pgk = usk.to_sapling_proof_generation_key();
        let bytes_a = pgk.to_bytes();
        assert_eq!(bytes_a.len(), 64, "PGK serialization must be 64 bytes");

        let restored = ProofGenerationKey::from_bytes(&bytes_a)
            .expect("round-trip decode must succeed");
        let bytes_b = restored.to_bytes();
        assert_eq!(bytes_a, bytes_b, "PGK bytes must round-trip exactly");
    }

    #[test]
    fn pgk_from_bytes_rejects_wrong_length() {
        assert!(ProofGenerationKey::from_bytes(&[0u8; 63]).is_err());
        assert!(ProofGenerationKey::from_bytes(&[0u8; 65]).is_err());
        assert!(ProofGenerationKey::from_bytes(&[]).is_err());
    }
}

/// A Zcash spending key
///
/// This is a wrapper around the `zcash_keys::keys::SpendingKey` type. It can be created from at least 32 bytes of seed entropy
#[wasm_bindgen]
pub struct UnifiedSpendingKey {
    inner: zcash_keys::keys::UnifiedSpendingKey,
}

#[wasm_bindgen]
impl UnifiedSpendingKey {
    /// Construct a new UnifiedSpendingKey
    ///
    /// # Arguments
    ///
    /// * `network` - Must be either "main" or "test"
    /// * `seed` - At least 32 bytes of entry. Care should be taken as to how this is derived
    /// * `hd_index` - [ZIP32](https://zips.z.cash/zip-0032) hierarchical deterministic index of the account
    ///
    #[wasm_bindgen(constructor)]
    pub fn new(network: &str, seed: Box<[u8]>, hd_index: u32) -> Result<UnifiedSpendingKey, Error> {
        let network = Network::from_str(network)?;
        Ok(Self {
            inner: zcash_keys::keys::UnifiedSpendingKey::from_seed(
                &network,
                &seed,
                AccountId::try_from(hd_index)?,
            )?,
        })
    }

    /// Obtain the UFVK corresponding to this spending key
    pub fn to_unified_full_viewing_key(&self) -> UnifiedFullViewingKey {
        UnifiedFullViewingKey {
            inner: self.inner.to_unified_full_viewing_key(),
        }
    }

    pub fn to_sapling_proof_generation_key(&self) -> ProofGenerationKey {
        ProofGenerationKey {
            inner: self.inner.sapling().expsk.proof_generation_key(),
        }
    }

    /// Serialize the Sapling `ExtendedFullViewingKey` as its 169-byte ZIP-32
    /// binary encoding (`depth ‖ parent_fvk_tag ‖ child_index ‖ chain_code ‖
    /// fvk(ak‖nk‖ovk) ‖ dk`).
    ///
    /// This is the snap↔dapp wire format for handing a viewing key out of the
    /// MetaMask sandbox on Ycash. Ycash never activated unified addresses —
    /// librustzcash-ycash deliberately panics in `UnifiedFullViewingKey::encode`
    /// for Ycash networks — so the bech32 ZIP-316 path is unavailable. The
    /// dapp rebuilds an in-memory sapling-only UFVK from these bytes via
    /// `UnifiedFullViewingKey::from_sapling_extended_full_viewing_key`.
    pub fn to_sapling_extended_fvk_bytes(&self) -> Result<Vec<u8>, Error> {
        let efvk = self.inner.sapling().to_extended_full_viewing_key();
        let mut buf = Vec::with_capacity(169);
        efvk.write(&mut buf)
            .map_err(|e| Error::KeyDerivation(e.to_string()))?;
        Ok(buf)
    }

    /// Construct a UnifiedSpendingKey from a BIP39 seed phrase.
    ///
    /// # Arguments
    ///
    /// * `network` - Must be either "main" or "test"
    /// * `seed_phrase` - 24-word BIP39 mnemonic
    /// * `hd_index` - [ZIP32](https://zips.z.cash/zip-0032) hierarchical deterministic index of the account
    ///
    /// This is the entry point used by the browser signing backend — the phrase
    /// is decrypted from IndexedDB at sign time and handed in here to recover
    /// the spending key without persisting any raw seed bytes.
    pub fn from_seed_phrase(
        network: &str,
        seed_phrase: &str,
        hd_index: u32,
    ) -> Result<UnifiedSpendingKey, Error> {
        let network = Network::from_str(network)?;
        let mnemonic = <Mnemonic<English>>::from_phrase(seed_phrase)
            .map_err(|_| Error::InvalidSeedPhrase)?;
        let seed = mnemonic.to_seed("");
        Ok(Self {
            inner: zcash_keys::keys::UnifiedSpendingKey::from_seed(
                &network,
                &seed,
                AccountId::try_from(hd_index)?,
            )?,
        })
    }
}

impl From<UnifiedSpendingKey> for zcash_keys::keys::UnifiedSpendingKey {
    fn from(value: UnifiedSpendingKey) -> Self {
        value.inner
    }
}

/// A Zcash viewing key
///
/// This is a wrapper around the `zcash_keys::keys::ViewingKey` type.
/// UFVKs should be generated from a spending key by calling `to_unified_full_viewing_key`
/// They can also be encoded and decoded to a canonical string representation
#[wasm_bindgen]
pub struct UnifiedFullViewingKey {
    inner: zcash_keys::keys::UnifiedFullViewingKey,
}

#[wasm_bindgen]
impl UnifiedFullViewingKey {
    /// Encode the UFVK to a string
    ///
    /// # Arguments
    ///
    /// * `network` - Must be either "main" or "test"
    ///
    pub fn encode(&self, network: &str) -> Result<String, Error> {
        let network = Network::from_str(network)?;
        Ok(self.inner.encode(&network))
    }

    /// Construct a UFVK from its encoded string representation
    ///
    /// # Arguments
    ///
    /// * `network` - Must be either "main" or "test"
    /// * `encoding` - The encoded string representation of the UFVK
    ///
    #[wasm_bindgen(constructor)]
    pub fn new(network: &str, encoding: &str) -> Result<UnifiedFullViewingKey, Error> {
        let network = Network::from_str(network)?;
        Ok(Self {
            inner: zcash_keys::keys::UnifiedFullViewingKey::decode(&network, encoding)
                .map_err(Error::KeyDecoding)?,
        })
    }

    /// Get the default transparent address derived from this UFVK.
    ///
    /// This can be used before creating an account to detect the wallet birthday
    /// by querying for transactions to this address.
    ///
    /// # Arguments
    ///
    /// * `network` - Must be either "main" or "test"
    ///
    /// # Returns
    ///
    /// The transparent address as a string, or None if this UFVK has no transparent component.
    ///
    pub fn get_transparent_address(&self, network: &str) -> Result<Option<String>, Error> {
        let network = Network::from_str(network)?;
        let (ua, _) = self
            .inner
            .default_address(zcash_keys::keys::UnifiedAddressRequest::ALLOW_ALL)
            .map_err(|_| Error::TransparentAddressDerivation)?;
        Ok(ua
            .transparent()
            .map(|addr| zcash_keys::encoding::AddressCodec::encode(addr, &network)))
    }
}

/// Generate a new BIP39 24-word seed phrase
///
/// IMPORTANT: This probably does not use secure randomness when used in the browser
/// and should not be used for anything other than testing
///
/// # Returns
///
/// A string containing a 24-word seed phrase
#[wasm_bindgen]
pub fn generate_seed_phrase() -> String {
    let mnemonic = <Mnemonic<English>>::generate(Count::Words24);
    mnemonic.phrase().to_string()
}
