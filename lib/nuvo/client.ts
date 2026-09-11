import { ChainClient } from "./chain";

// One client for the whole app, backed by the network and contracts from env.

let instance: ChainClient | null = null;

export function getClient(): ChainClient {
  if (!instance) instance = new ChainClient();
  return instance;
}
