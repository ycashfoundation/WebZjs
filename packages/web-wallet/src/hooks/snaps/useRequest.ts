import type { RequestArguments } from '@metamask/providers';

import { useMetaMaskContext } from '../../context/MetamaskContext';

export type Request = (params: RequestArguments) => Promise<unknown | null>;

/**
 * Utility hook to consume the provider `request` method with the available provider.
 *
 * @returns The `request` function.
 */
export const useRequest = () => {
  const { provider, setError } = useMetaMaskContext();

  /**
   * `provider.request` wrapper.
   *
   * @param params - The request params.
   * @param params.method - The method to call.
   * @param params.params - The method params.
   * @returns The result of the request.
   */

  const request: Request = async ({ method, params }) => {
    // `provider?.request(...)` silently resolves to `undefined` when the
    // MetaMask provider is missing (extension not installed, uninstalled
    // mid-session, not yet injected), and the `?? null` below would then
    // surface that as a `null` return. Callers destructure that null and
    // crash deep in unrelated code with a "Cannot destructure property
    // 'externalHex' of null"-style TypeError that gives the user no way
    // to recover. Detect the missing provider up front and throw a
    // message the user can act on.
    if (!provider) {
      const missingProviderError = new Error(
        'MetaMask is not available. Make sure MetaMask Flask is installed and unlocked, then reload this page.',
      );
      setError(missingProviderError);
      throw missingProviderError;
    }
    try {
      const data =
        (await provider.request({
          method,
          params,
        } as RequestArguments)) ?? null;

      return data;
    } catch (requestError: any) {
      // Handle "pending request" error specifically (code -32002)
      if (requestError?.code === -32002) {
        const pendingError = new Error(
          'A MetaMask request is already pending. Please check MetaMask and approve or reject the pending request, then try again.'
        );
        (pendingError as any).code = -32002;
        (pendingError as any).isPendingRequest = true;
        setError(pendingError);
        throw pendingError;
      }
      setError(requestError as Error);

      throw requestError;
    }
  };

  return request;
};
