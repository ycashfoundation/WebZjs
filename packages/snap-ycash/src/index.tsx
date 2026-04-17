import { getViewingKey } from './rpc/getViewingKey';
import { InitOutput } from '@chainsafe/webzjs-keys';
import { initialiseWasm } from './utils/initialiseWasm';
import {
  OnRpcRequestHandler,
  OnUserInputHandler,
  UserInputEventType,
} from '@metamask/snaps-sdk';
import { setBirthdayBlock } from './rpc/setBirthdayBlock';
import { getSnapState } from './rpc/getSnapState';
import { SetBirthdayBlockParams, SignPcztParams, SnapState } from './types';
import { setSnapState } from './rpc/setSnapState';
import { signPczt } from './rpc/signPczt';

import { assert, object, number, optional, string } from 'superstruct';
import { getSeedFingerprint } from './rpc/getSeedFingerprint';
import { getProofGenerationKey } from './rpc/getProofGenerationKey';

let wasm: InitOutput;

/**
 * Handle incoming JSON-RPC requests, sent through `wallet_invokeSnap`.
 *
 * @returns The result specific to the invoked method.
 * @throws If the request method is not valid for this snap.
 */
export const onRpcRequest: OnRpcRequestHandler = async ({
  request,
  origin,
}) => {
  if (!wasm) {
    wasm = initialiseWasm();
  }

  switch (request.method) {
    case 'getViewingKey':
      return await getViewingKey(origin);
    case 'signPczt':
      assert(
        request.params,
        object({
          pcztHexString: string(),
          signDetails: object({
            recipient: string(),
            amount: string(),
          }),
        }),
      );
      return await signPczt(request.params as SignPcztParams, origin);
    case 'getSeedFingerprint':
      return await getSeedFingerprint();
    case 'getProofGenerationKey':
      return await getProofGenerationKey(origin);
    case 'setBirthdayBlock':
      assert(request.params, object({ latestBlock: optional(number()) }));
      return await setBirthdayBlock(request.params as SetBirthdayBlockParams);
    case 'getSnapState':
      return await getSnapState();
    case 'setSnapState': {
      const setSnapStateParams = request.params as unknown as SnapState;
      return await setSnapState(setSnapStateParams);
    }
    default:
      throw new Error('Method not found.');
  }
};

export const onUserInput: OnUserInputHandler = async ({ id, event }) => {
  if (event.type === UserInputEventType.FormSubmitEvent) {
    switch (event.name) {
      case 'birthday-block-form':
        await snap.request({
          method: 'snap_resolveInterface',
          params: {
            id,
            value: event.value,
          },
        });
        break;
      default:
        break;
    }
  }
};

// onInstall welcome dialog removed — on recent MM Flask builds the hook
// crashed with "Method not found" before any RPC could run, blocking the
// whole snap. The dialog was purely promotional; dropping it is a net
// behavior improvement. If we want a welcome screen back, it should go in
// the wallet dapp (/connect-snap) instead, where we control the full UI.
