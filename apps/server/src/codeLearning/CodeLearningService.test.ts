import { DEFAULT_SERVER_SETTINGS, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { reviewModelSelection } from "./CodeLearningService.ts";

describe("reviewModelSelection", () => {
  it("reviews with Sonnet on low effort on the Claude instance text generation uses", () => {
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-haiku-5-5",
      },
    };
    expect(reviewModelSelection(settings)).toEqual({
      instanceId: "claudeAgent",
      model: "claude-sonnet-5-5",
      options: [{ id: "effort", value: "low" }],
    });
  });

  it("keeps the text generation model when no Claude instance is set up", () => {
    const textGenerationModelSelection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    };
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      textGenerationModelSelection,
      defaultModelSelection: textGenerationModelSelection,
      providerInstances: {},
    };
    expect(reviewModelSelection(settings)).toBe(textGenerationModelSelection);
  });
});
