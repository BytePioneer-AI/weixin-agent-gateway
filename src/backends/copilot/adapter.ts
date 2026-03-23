import type { WeixinBackendAdapter } from "../contracts.js";
import { CopilotAcpClient } from "./acp-client.js";

const copilotAcpClient = new CopilotAcpClient();

export const copilotBackendAdapter: WeixinBackendAdapter = {
  id: "copilot",
  mode: "lightweight",
  async reply(input) {
    return copilotAcpClient.runLightweightConversation(input);
  },
};
