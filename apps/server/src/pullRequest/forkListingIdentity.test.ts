import { describe, expect, it } from "vite-plus/test";

import { forkListingIdentity } from "./PullRequestService.ts";

const upstream = {
  canonicalKey: "github.com/pingdotgg/t3code",
  locator: {
    source: "git-remote" as const,
    remoteName: "upstream",
    remoteUrl: "https://github.com/pingdotgg/t3code.git",
  },
  displayName: "pingdotgg/t3code",
  provider: "github",
  owner: "pingdotgg",
  name: "t3code",
};

describe("forkListingIdentity", () => {
  it("lists a fork's own repository instead of its upstream parent", () => {
    const identity = forkListingIdentity({
      ...upstream,
      origin: { canonicalKey: "github.com/vlammie1/t3code", displayName: "Vlammie1/t3code" },
    });
    expect(identity).toMatchObject({
      canonicalKey: "github.com/vlammie1/t3code",
      displayName: "Vlammie1/t3code",
      owner: "Vlammie1",
      name: "t3code",
    });
    expect(identity).not.toHaveProperty("origin");
  });

  it("leaves a checkout without a fork origin untouched", () => {
    expect(forkListingIdentity(upstream)).toBe(upstream);
  });
});
