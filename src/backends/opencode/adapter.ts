import type { WeixinBackendAdapter } from "../contracts.js";
import { AgentApiClient } from "../lightweight/agentapi-client.js";
import { DEFAULT_OPENCODE_AGENTAPI_URL } from "../lightweight/agentapi-launcher.js";

function resolveOpencodeAgentApiUrl(): string {
  return process.env.WEIXIN_OPENCODE_AGENTAPI_URL?.trim() || process.env.OPENCODE_AGENTAPI_URL?.trim() || DEFAULT_OPENCODE_AGENTAPI_URL;
}

export const opencodeBackendAdapter: WeixinBackendAdapter = {
  id: "opencode",
  mode: "lightweight",
  async reply(input) {
    const baseUrl = resolveOpencodeAgentApiUrl();
    const client = new AgentApiClient({
      label: "opencode-agentapi",
      baseUrl,
      autoStart: {
        backendId: "opencode",
      },
    });
    return client.runLightweightConversation(input);
  },
};
