import type { WeixinBackendAdapter } from "../contracts.js";
import { AuggieAcpClient } from "./acp-client.js";

const auggieAcpClient = new AuggieAcpClient();

export const auggieBackendAdapter: WeixinBackendAdapter = {
  id: "auggie",
  mode: "lightweight",
  async reply(input) {
    return auggieAcpClient.runLightweightConversation(input);
  },
};
