// A pretend AI SERVICE for the PACKAGED TEST BUILD and the build tests only: it implements the provider seam (engine/src/agents/provider.ts) directly and answers every role with
// the same canned answers as the fake Claude, without imitating any vendor's message stream. Like fake-claude.ts it is imported only behind `__TEST_BUILD__`, so the release
// build contains none of it (scripts/package.ts checks this). made by the test build.
import type { Profile } from "../../../../engine/src/profile.ts";
import type { ModelProvider } from "../../../../engine/src/agents/provider.ts";
import { fakeAnswer, type FakeControls } from "./fake-claude.ts";

export function fakeProvider(profileOrPath: string | Profile, controls: Partial<FakeControls> = {}): ModelProvider {
  return {
    id: "fake",
    preflight: () => [],                                   // no credential to check: nothing is ever sent anywhere
    async run(call) {
      return { type: "finished", usage: { inTokens: 100, outTokens: 20, costUsd: 0.01 }, answer: fakeAnswer(profileOrPath, controls, call.system, call.prompt) };
    },
  };
}
