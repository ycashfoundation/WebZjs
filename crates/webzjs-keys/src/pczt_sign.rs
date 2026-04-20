use crate::error::Error;
use crate::{SeedFingerprint, UnifiedSpendingKey};
use pczt::roles::signer::Signer;
use pczt::roles::verifier::Verifier;
use std::collections::BTreeMap;
use std::convert::Infallible;
use std::str::FromStr;
use wasm_bindgen::prelude::wasm_bindgen;
use webzjs_common::{Network, Pczt};
use zcash_protocol::consensus::{NetworkConstants, Parameters};
use zcash_transparent::keys::{NonHardenedChildIndex, TransparentKeyScope};

/// Signs and applies signatures to a PCZT.
/// Should in a secure environment (e.g. Metamask snap).
///
/// # Arguments
///
/// * `pczt` - The PCZT that needs to signed
/// * `usk` - UnifiedSpendingKey used to sign the PCZT
/// * `seed_fp` - The fingerprint of the seed used to create `usk`
///
#[wasm_bindgen]
pub async fn pczt_sign(
    network: &str,
    pczt: Pczt,
    usk: UnifiedSpendingKey,
    seed_fp: SeedFingerprint,
) -> Result<Pczt, Error> {
    pczt_sign_inner(
        Network::from_str(network)?,
        pczt.into(),
        usk.into(),
        seed_fp.into(),
    )
    .await
    .map(Into::into)
}

pub async fn pczt_sign_inner(
    network: Network,
    pczt: pczt::Pczt,
    usk: zcash_keys::keys::UnifiedSpendingKey,
    seed_fp: zip32::fingerprint::SeedFingerprint,
) -> Result<pczt::Pczt, Error> {
    // Find all the spends matching our seed.
    #[derive(Debug)]
    enum KeyRef {
        Orchard {
            index: usize,
        },
        Sapling {
            index: usize,
            /// Sapling has two ZIP-32 scopes per account — external (for
            /// incoming payments) and internal (for change and
            /// shield-self outputs). They have different `ak`, so the
            /// signer has to use the matching `ask` or the PCZT
            /// verifier trips with `WrongFvkForNote`. We determine the
            /// scope by comparing the spend's recipient against the
            /// `pk_d` the external ivk produces for its diversifier —
            /// if they match, external; otherwise internal.
            is_internal: bool,
        },
        Transparent {
            index: usize,
            scope: TransparentKeyScope,
            address_index: NonHardenedChildIndex,
        },
    }

    // Pre-compute external `ak` bytes for quick scope lookup below.
    let external_ak_bytes = usk.sapling().expsk.proof_generation_key().ak.to_bytes();

    let mut keys = BTreeMap::<zip32::AccountId, Vec<KeyRef>>::new();
    let pczt = Verifier::new(pczt)
        .with_orchard::<Infallible, _>(|bundle| {
            for (index, action) in bundle.actions().iter().enumerate() {
                if let Some(account_index) =
                    action
                        .spend()
                        .zip32_derivation()
                        .as_ref()
                        .and_then(|derivation| {
                            derivation.extract_account_index(
                                &seed_fp,
                                zip32::ChildIndex::hardened(network.network_type().coin_type()),
                            )
                        })
                {
                    keys.entry(account_index)
                        .or_default()
                        .push(KeyRef::Orchard { index });
                }
            }
            Ok(())
        })
        .map_err(|e| Error::PcztSign(format!("Invalid PCZT: {:?}", e)))?
        .with_sapling::<Infallible, _>(|bundle| {
            for (index, spend) in bundle.spends().iter().enumerate() {
                if let Some(account_index) =
                    spend.zip32_derivation().as_ref().and_then(|derivation| {
                        derivation.extract_account_index(
                            &seed_fp,
                            zip32::ChildIndex::hardened(network.network_type().coin_type()),
                        )
                    })
                {
                    // The spend's `proof_generation_key` was injected by
                    // the dapp's Prover step; its `ak` identifies the
                    // scope the dapp intends us to sign with. For
                    // correctly-constructed PCZTs, this matches the
                    // note's owning scope — i.e. `external_ak` for
                    // normal spends, `internal_ak` for change/shield-self
                    // outputs. Default to external if pgk is absent
                    // (legacy PCZTs and dummy spends). The legacy behavior
                    // is preserved because a missing pgk means the dapp
                    // never injected one, which only happens when the
                    // caller is still on the single-PGK API.
                    let is_internal = spend
                        .proof_generation_key()
                        .as_ref()
                        .map(|pgk| pgk.ak.to_bytes() != external_ak_bytes)
                        .unwrap_or(false);
                    keys.entry(account_index)
                        .or_default()
                        .push(KeyRef::Sapling { index, is_internal });
                }
            }
            Ok(())
        })
        .map_err(|e| Error::PcztSign(format!("Invalid PCZT: {:?}", e)))?
        .with_transparent::<Infallible, _>(|bundle| {
            for (index, input) in bundle.inputs().iter().enumerate() {
                for derivation in input.bip32_derivation().values() {
                    if let Some((account_index, scope, address_index)) = derivation
                        .extract_bip_44_fields(
                            &seed_fp,
                            bip32::ChildNumber(
                                network.network_type().coin_type()
                                    | bip32::ChildNumber::HARDENED_FLAG,
                            ),
                        )
                    {
                        keys.entry(account_index)
                            .or_default()
                            .push(KeyRef::Transparent {
                                index,
                                scope,
                                address_index,
                            });
                    }
                }
            }
            Ok(())
        })
        .map_err(|e| Error::PcztSign(format!("Invalid PCZT: {:?}", e)))?
        .finish();
    let mut signer = Signer::new(pczt).unwrap();
    //.map_err(|e| anyhow!("Failed to initialize Signer: {:?}", e))?;
    for (_, spends) in keys {
        // let usk = UnifiedSpendingKey::from_seed(&params, seed, account_index)?;
        for keyref in spends {
            match keyref {
                KeyRef::Orchard { index } => {
                    signer
                        .sign_orchard(
                            index,
                            &orchard::keys::SpendAuthorizingKey::from(usk.orchard()),
                        )
                        .map_err(|e| {
                            Error::PcztSign(format!(
                                "Failed to sign Orchard spend {index}: {:?}",
                                e
                            ))
                        })?;
                }
                KeyRef::Sapling { index, is_internal } => {
                    // Sapling ZIP-32 internal scope uses a distinct `ask`
                    // derived via `derive_internal()`. Spending a change
                    // note with the external `ask` produces an `rk` that
                    // doesn't match the one the Constructor baked into
                    // the PCZT (which was randomised from the note's own
                    // internal `ak`), so Signer would reject it with
                    // `WrongSpendAuthorizingKey`. Picking the right scope
                    // here is sufficient only when the Prover also
                    // injected the matching `pgk`; the companion fix on
                    // the dapp-side pczt_prove takes care of that.
                    let ask = if is_internal {
                        usk.sapling().derive_internal().expsk.ask.clone()
                    } else {
                        usk.sapling().expsk.ask.clone()
                    };
                    signer.sign_sapling(index, &ask).map_err(|e| {
                        Error::PcztSign(format!(
                            "Failed to sign Sapling spend {index} ({} scope): {:?}",
                            if is_internal { "internal" } else { "external" },
                            e
                        ))
                    })?;
                }
                KeyRef::Transparent {
                    index,
                    scope,
                    address_index,
                } => {
                    signer
                        .sign_transparent(
                            index,
                            &usk.transparent()
                                .derive_secret_key(scope, address_index)
                                .map_err(|e| {
                                    Error::PcztSign(format!(
                                        "Failed to derive transparent key at .../{:?}/{:?}: {:?}",
                                        scope, address_index, e,
                                    ))
                                })?,
                        )
                        .map_err(|e| {
                            Error::PcztSign(format!(
                                "Failed to sign transparent input {index}: {:?}",
                                e
                            ))
                        })?;
                }
            }
        }
    }

    Ok(signer.finish())
}
