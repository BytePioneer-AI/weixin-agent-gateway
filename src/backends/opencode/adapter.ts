import type { WeixinBackendAdapter } from "../contracts.js";
import { OpenCodeAcpClient } from "./acp-client.js";

const opencodeAcpClient = new OpenCodeAcpClient();

export const opencodeBackendAdapter: WeixinBackendAdapter = {
  id: "opencode",
  mode: "lightweight",
  async reply(input) {
    return opencodeAcpClient.runLightweightConversation(input);
  },
};
