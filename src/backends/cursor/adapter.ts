import type { WeixinBackendAdapter } from "../contracts.js";
import { AgentApiClient } from "../lightweight/agentapi-client.js";
import { DEFAULT_CURSOR_AGENTAPI_URL } from "../lightweight/agentapi-launcher.js";

function resolveCursorAgentApiUrl(): string {
  return process.env.WEIXIN_CURSOR_AGENTAPI_URL?.trim() || process.env.CURSOR_AGENTAPI_URL?.trim() || DEFAULT_CURSOR_AGENTAPI_URL;
}

export const cursorBackendAdapter: WeixinBackendAdapter = {
  id: "cursor",
  mode: "lightweight",
  async reply(input) {
    const baseUrl = resolveCursorAgentApiUrl();
    const client = new AgentApiClient({
      label: "cursor-agentapi",
      baseUrl,
      autoStart: {
        backendId: "cursor",
      },
    });
    return client.runLightweightConversation(input);
  },
};
