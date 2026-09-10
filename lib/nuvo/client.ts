import { MODE } from "./config";
import { ChainClient } from "./chain";
import { MockClient } from "./mock";
import type { NuvoClient } from "./types";

// Brief 9: NEXT_PUBLIC_NUVO_MODE picks the implementation. Screens import
// getClient() and never branch on the mode themselves, except to show the
// `Demo data` badge and the developer week control.

let instance: NuvoClient | null = null;

export function getClient(): NuvoClient {
  if (!instance) instance = MODE === "chain" ? new ChainClient() : new MockClient();
  return instance;
}

export const isMock = (client: NuvoClient): client is MockClient => client.mode === "mock";
