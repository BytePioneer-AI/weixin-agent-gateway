import type { WeixinBackendAdapter } from "../contracts.js";
import { AgentApiClient } from "../lightweight/agentapi-client.js";
import { DEFAULT_AUGGIE_AGENTAPI_URL } from "../lightweight/agentapi-launcher.js";

function resolveAuggieAgentApiUrl(): string {
  return process.env.WEIXIN_AUGGIE_AGENTAPI_URL?.trim() || process.env.AUGGIE_AGENTAPI_URL?.trim() || DEFAULT_AUGGIE_AGENTAPI_URL;
}

export const auggieBackendAdapter: WeixinBackendAdapter = {
  id: "auggie",
  mode: "lightweight",
  async reply(input) {
    const baseUrl = resolveAuggieAgentApiUrl();
    const client = new AgentApiClient({
      label: "auggie-agentapi",
      baseUrl,
      autoStart: {
        backendId: "auggie",
      },
    });
    return client.runLightweightConversation(input);
  },
};
