import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";
import { NoWalletError, NotConfiguredError, TxPendingError, TxRevertedError } from "./chain";
import { UnavailableCode } from "./abi";

// Brief 8: the two messages a failed transaction can end in, plus the one for a
// transaction that is out but not confirmed yet.

/**
 * What the pool's own errors mean in plain words. Without this every refusal
 * reads as "try again", and a depositor whose inventory is locked is told
 * nothing about why.
 */
const CONTRACT_ERRORS: Record<string, string> = {
  SettlementPending: "A settled week is still being claimed. Deposits and withdrawals reopen once it is.",
  InventoryLocked: "That much is reserved against open positions. Withdraw less, or wait for them to settle.",
  StalePrice: "The reference price is not fresh enough right now.",
  BadPrice: "The reference price is unavailable right now.",
  Slippage: "The price moved past your limit. Try again.",
  StrikeMoved: "The reference moved past your limit. Try again.",
  Expired: "The transaction sat too long. Try again.",
  TooSmall: "That amount is too small.",
  BadShares: "You do not hold that many shares.",
  Paused: "The pool is paused for new deposits.",
  NotSettled: "This week has not been settled yet.",
  AlreadyClaimed: "This position has already been claimed.",
  NotYours: "This position belongs to another wallet.",
};

export function txErrorMessage(error: unknown): string {
  if (error instanceof BaseError && error.walk((e) => e instanceof UserRejectedRequestError)) {
    return "Transaction rejected in wallet";
  }
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name === "Unavailable") {
        const code = Number(reverted.data?.args?.[0] ?? 0);
        return unavailableMessage(code, "this amount");
      }
      if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
    }
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
