import type {
  Address,
  Direction,
  NuvoClient,
  Position,
  Product,
  Quote,
  TxResult,
  Week,
} from "./types";

// Brief: this stage ships no backend and no contracts. ChainClient is the empty
// seat for the next stage — the interface is fixed by the UI, the body is not
// written yet. Reads land here (viem public client against the network from
// config), writes go through wagmi in the screens, and signed quotes come from
// the market maker service that does not exist yet.

const notWired = (method: string) => {
  throw new Error(
    `NuvoClient.${method} is not wired yet. Set NEXT_PUBLIC_NUVO_MODE=mock until the contracts ship.`,
  );
};

export class ChainClient implements NuvoClient {
  readonly mode = "chain" as const;

  // TODO(stage 2): read the current week from the contract schedule.
  async getWeek(): Promise<Week> {
    return notWired("getWeek");
  }

  // TODO(stage 2): read the ladder for the week and pair it with quote service premiums.
  async listProducts(_direction: Direction, _ticker?: string): Promise<Product[]> {
    return notWired("listProducts");
  }

  // TODO(stage 2): ask the market maker for a signed quote.
  async getQuote(_productId: string, _amount: number): Promise<Quote> {
    return notWired("getQuote");
  }

  // TODO(stage 2): balanceOf on USDG and the stock tokens.
  async getBalances(_address?: Address): Promise<Record<string, number>> {
    return notWired("getBalances");
  }

  // TODO(stage 2): allowance(owner, nuvo).
  async getAllowance(_token: string, _amount?: number): Promise<number> {
    return notWired("getAllowance");
  }

  // TODO(stage 2): ERC-20 approve through wagmi.
  async approve(_token: string, _amount: number): Promise<TxResult> {
    return notWired("approve");
  }

  // TODO(stage 2): INuvoDual.subscribe(productId, amount, signedQuote).
  async subscribe(
    _productId: string,
    _amount: number,
    _quote: Quote,
  ): Promise<TxResult & { positionId: string }> {
    return notWired("subscribe");
  }

  // TODO(stage 2): positionsOf(user) plus position() for each id.
  async getPositions(_address?: Address): Promise<Position[]> {
    return notWired("getPositions");
  }

  // TODO(stage 2): INuvoDual.claim(positionId).
  async claim(_positionId: string): Promise<TxResult> {
    return notWired("claim");
  }
}
