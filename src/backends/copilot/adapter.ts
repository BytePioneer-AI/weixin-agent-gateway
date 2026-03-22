import type { WeixinBackendAdapter } from "../contracts.js";
import { AgentApiClient } from "../lightweight/agentapi-client.js";
import { DEFAULT_COPILOT_AGENTAPI_URL } from "../lightweight/agentapi-launcher.js";

function resolveCopilotAgentApiUrl(): string {
  return process.env.WEIXIN_COPILOT_AGENTAPI_URL?.trim() || process.env.COPILOT_AGENTAPI_URL?.trim() || DEFAULT_COPILOT_AGENTAPI_URL;
}

export const copilotBackendAdapter: WeixinBackendAdapter = {
  id: "copilot",
  mode: "lightweight",
  async reply(input) {
    const baseUrl = resolveCopilotAgentApiUrl();
    const client = new AgentApiClient({
      label: "copilot-agentapi",
      baseUrl,
      autoStart: {
        backendId: "copilot",
      },
    });
    return client.runLightweightConversation(input);
  },
};
