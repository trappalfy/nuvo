import { BaseError, UserRejectedRequestError } from "viem";
import { NoWalletError, NotConfiguredError, TxPendingError, TxRevertedError } from "./chain";
import { UnavailableCode } from "./abi";

// Brief 8: the two messages a failed transaction can end in, plus the one for a
// transaction that is out but not confirmed yet.

export function txErrorMessage(error: unknown): string {
  if (error instanceof BaseError && error.walk((e) => e instanceof UserRejectedRequestError)) {
    return "Transaction rejected in wallet";
  }
  if (typeof error === "object" && error && "code" in error && (error as { code: unknown }).code === 4001) {
    return "Transaction rejected in wallet";
  }
  if (
    error instanceof TxPendingError ||
    error instanceof TxRevertedError ||
    error instanceof NoWalletError ||
    error instanceof NotConfiguredError
  ) {
    return error.message;
  }
  return "Transaction failed. Try again.";
}

/** Why the pool will not take a subscription. The text is what the button says. */
export function unavailableMessage(code: number, deposit: string): string {
  switch (code) {
    case UnavailableCode.Paused:
      return "Subscriptions are paused";
    case UnavailableCode.NoExpiry:
      return "No expiry is open yet";
    case UnavailableCode.BadPrice:
    case UnavailableCode.StalePrice:
      return "Waiting for a fresh reference price";
    case UnavailableCode.NoPremium:
      return "This target is not on offer";
    case UnavailableCode.ZeroAmount:
      return "Enter an amount";
    case UnavailableCode.BelowMin:
      return `Below the minimum for ${deposit}`;
    case UnavailableCode.AboveMax:
      return `Above the maximum for ${deposit}`;
    case UnavailableCode.ExpiryFull:
      return "This week is full";
    case UnavailableCode.NoInventory:
    case UnavailableCode.TooMuchLocked:
      return "The pool cannot cover this size";
    case UnavailableCode.BadDistance:
      return "This target is not on offer";
    default:
      return "Subscriptions are unavailable right now";
  }
}
