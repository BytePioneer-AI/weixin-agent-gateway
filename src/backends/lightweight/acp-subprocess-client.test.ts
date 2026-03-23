import { describe, expect, it } from "vitest";

import { parseCommandArgs } from "./acp-subprocess-client.js";

describe("parseCommandArgs", () => {
  it("splits plain ACP args by whitespace", () => {
    expect(parseCommandArgs("--acp --stdio")).toEqual(["--acp", "--stdio"]);
  });

  it("preserves quoted arguments", () => {
    expect(parseCommandArgs('--mode "safe write" --label \'Cursor ACP\'')).toEqual([
      "--mode",
      "safe write",
      "--label",
      "Cursor ACP",
    ]);
  });

  it("keeps backslashes in unquoted Windows-style paths", () => {
    expect(parseCommandArgs("--config C:\\tools\\cursor\\agent.json")).toEqual([
      "--config",
      "C:\\tools\\cursor\\agent.json",
    ]);
  });
});
