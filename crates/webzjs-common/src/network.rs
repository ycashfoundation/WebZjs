// Copyright 2024 ChainSafe Systems
// SPDX-License-Identifier: Apache-2.0, MIT

use crate::error::Error;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use zcash_protocol::consensus::{self, Parameters, YCASH_MAIN_NETWORK, YCASH_TEST_NETWORK};

/// Network identifier for the Ycash chain.
///
/// The variant names are kept as `MainNetwork` / `TestNetwork` for wire and storage
/// compatibility with wallets created before the Ycash fork of WebZjs, but both
/// dispatch to Ycash consensus parameters (bip44 coin type 347, Ycash branch IDs,
/// no NU5 activation). `Zcash` is not a supported network on this build.
#[derive(Copy, Clone, Debug, Default, Serialize, Deserialize)]
pub enum Network {
    #[default]
    MainNetwork,
    TestNetwork,
}

impl FromStr for Network {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "main" => Ok(Network::MainNetwork),
            "test" => Ok(Network::TestNetwork),
            _ => Err(Error::InvalidNetwork(s.to_string())),
        }
    }
}

impl Parameters for Network {
    fn network_type(&self) -> consensus::NetworkType {
        match self {
            Network::MainNetwork => consensus::NetworkType::YcashMain,
            Network::TestNetwork => consensus::NetworkType::YcashTest,
        }
    }

    fn activation_height(&self, nu: consensus::NetworkUpgrade) -> Option<consensus::BlockHeight> {
        match self {
            Network::MainNetwork => YCASH_MAIN_NETWORK.activation_height(nu),
            Network::TestNetwork => YCASH_TEST_NETWORK.activation_height(nu),
        }
    }

    fn branch_id(&self, nu: consensus::NetworkUpgrade) -> consensus::BranchId {
        match self {
            Network::MainNetwork => YCASH_MAIN_NETWORK.branch_id(nu),
            Network::TestNetwork => YCASH_TEST_NETWORK.branch_id(nu),
        }
    }
}
