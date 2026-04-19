/**
 * Turn the grab-bag of error shapes that come out of the signing pipeline
 * into a single user-facing message. The failure paths we actually see in
 * production are:
 *
 *   - `Error` instances from the wasm wallet (`InsufficientFunds`, malformed
 *     PCZTs, network failures).
 *   - MetaMask / EIP-1193 RPC errors (plain objects with `code` and
 *     `message`). Rejecting a snap prompt yields `code === 4001`; all other
 *     codes surface as generic failures.
 *   - Plain objects thrown from wasm_bindgen's JsValue bridge that have no
 *     `message` at all, which naive `String(err)` stringifies as
 *     `[object Object]`.
 *
 * Keep this in the UI layer rather than the signing backend — the signing
 * backend rethrows raw errors on purpose so that higher levels can classify
 * them with context (e.g. "rejected *during shield*" vs. "rejected *during
 * send*"), and tucking a translator into the backend would flatten that.
 */
export interface FriendlyError {
  /** Short, user-facing one-liner. */
  message: string;
  /**
   * True when the error represents a user-initiated cancellation (rejecting
   * a MetaMask prompt, closing a dialog). Callers may choose to render
   * these less alarmingly — it wasn't a failure, just a "nevermind."
   */
  isUserCancellation: boolean;
}

interface MaybeRpcError {
  code?: unknown;
  message?: unknown;
  data?: unknown;
  cause?: unknown;
  reason?: unknown;
}

function asObject(err: unknown): MaybeRpcError | null {
  if (err && typeof err === 'object') return err as MaybeRpcError;
  return null;
}

/**
 * A string counts as "useful" only if it has content *and* isn't the
 * default Object.prototype.toString output. Several layers between us and
 * MetaMask/wasm_bindgen coerce objects to strings with naive `String(x)`,
 * leaving `"[object Object]"` fragments embedded inside otherwise-real
 * messages — those fragments get stripped, not returned as-is.
 */
function isUsefulString(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (!trimmed) return false;
  if (trimmed === '[object Object]') return false;
  return true;
}

/**
 * Walk the usual places errors hide their human-readable messages: direct
 * `message`, nested `data.message`, `cause.message`, `reason` (common in
 * MetaMask), and finally a JSON dump as a last resort. Strips any
 * "[object Object]" junk that got concatenated into the string.
 */
function extractRawMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err instanceof Error && isUsefulString(err.message)) return err.message;

  const obj = asObject(err);
  if (!obj) return '';

  const candidates: unknown[] = [
    obj.message,
    (obj.data as MaybeRpcError | undefined)?.message,
    (obj.cause as MaybeRpcError | undefined)?.message,
    obj.reason,
  ];
  for (const c of candidates) {
    if (isUsefulString(c)) {
      // Strip embedded "[object Object]" chunks so "User rejected
      // [object Object]" presents as "User rejected".
      return c.replace(/\s*\[object Object\]\s*/g, ' ').trim();
    }
  }

  // Final fallback: serialize whatever we have. Use own-property-names to
  // catch Error-like objects whose `message`/`stack` are non-enumerable.
  try {
    const keys = Object.getOwnPropertyNames(obj);
    if (keys.length > 0) {
      const dump = JSON.stringify(obj, keys);
      if (isUsefulString(dump)) return dump;
    }
  } catch {
    // fall through
  }
  return '';
}

/**
 * Context-aware classifier. `action` is a human-readable verb phrase like
 * "shield your balance" — it's used to compose the cancellation message
 * ("Cancelled — you declined the approval. No funds were moved.").
 */
export function toFriendlyError(
  err: unknown,
  action: string = 'complete this action',
): FriendlyError {
  const obj = asObject(err);
  const rawMessage = extractRawMessage(err);

  // EIP-1193 user rejection. MetaMask sends `code: 4001` for explicit dialog
  // dismissals; snap RPC often wraps the real error under `data` or
  // `data.originalError` so the top-level code reads as `-32603`. Collect
  // every plausible code site and test against the known rejection codes.
  const innerData = asObject(obj?.data);
  const innerOriginal = asObject(
    innerData ? (innerData as unknown as { originalError?: unknown }).originalError : undefined,
  );
  const codesToCheck = [obj?.code, innerData?.code, innerOriginal?.code];
  const isRejectionCode = (c: unknown) =>
    c === 4001 || c === 'ACTION_REJECTED';
  const looksLikeRejection =
    codesToCheck.some(isRejectionCode) ||
    /\b(?:user|you)\s+(?:rejected|denied|cancell?ed)\b/i.test(rawMessage) ||
    /rejected the request/i.test(rawMessage) ||
    /\brejected\b.*\bapproval\b/i.test(rawMessage);

  if (looksLikeRejection) {
    return {
      message: `Cancelled — you declined the approval. No funds were moved. Click Retry to ${action} again.`,
      isUserCancellation: true,
    };
  }

  // `InsufficientFunds` from zcash_client_backend. The shape is
  //   "... InsufficientFunds { available: Zatoshis(N), required: Zatoshis(M) } ..."
  // A shield fails with this when there isn't enough transparent balance to
  // cover the fee and the 0.0001-YEC Sapling dust floor. Sync lag is the
  // usual cause, not an actual shortage, so the message says so.
  if (/InsufficientFunds/.test(rawMessage)) {
    const availableMatch = rawMessage.match(/available:\s*Zatoshis\((\d+)\)/);
    const requiredMatch = rawMessage.match(/required:\s*Zatoshis\((\d+)\)/);
    if (availableMatch && requiredMatch) {
      const available = Number(availableMatch[1]) / 1e8;
      const required = Number(requiredMatch[1]) / 1e8;
      const shortfall = required - available;
      return {
        message: `Not enough YEC to ${action}: ${available.toFixed(8)} available, ${required.toFixed(8)} required (includes fees). Short by ${shortfall.toFixed(8)} YEC. If you've just received funds, wait for sync to finish and try again.`,
        isUserCancellation: false,
      };
    }
    return {
      message: `Not enough YEC to ${action}. Your wallet may still be syncing — wait for sync to finish or try a Full Resync from the Summary, then retry.`,
      isUserCancellation: false,
    };
  }

  // Fallback: use whatever message we extracted, or a generic one if the
  // error is truly opaque (e.g. `{}` thrown from wasm glue). Also catch the
  // literal "[object Object]" one more time at the boundary — belt and
  // suspenders so no future regression can surface it to users.
  if (rawMessage && rawMessage !== '[object Object]') {
    return { message: rawMessage, isUserCancellation: false };
  }
  return {
    message: `Something went wrong while we tried to ${action}. Please try again.`,
    isUserCancellation: false,
  };
}
