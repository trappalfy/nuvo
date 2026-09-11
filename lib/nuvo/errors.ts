import { BaseError, UserRejectedRequestError } from "viem";
import { NoWalletError, QuoteUnavailableError } from "./chain";

// Brief 8: the two messages a failed transaction can end in.

export function txErrorMessage(error: unknown): string {
  if (error instanceof BaseError && error.walk((e) => e instanceof UserRejectedRequestError)) {
    return "Transaction rejected in wallet";
  }
  if (typeof error === "object" && error && "code" in error && (error as { code: unknown }).code === 4001) {
    return "Transaction rejected in wallet";
  }
  if (error instanceof NoWalletError) return error.message;
  return "Transaction failed. Try again.";
}

export function quoteErrorMessage(error: unknown): string {
  return error instanceof QuoteUnavailableError ? error.message : "Quotes are unavailable right now";
}
