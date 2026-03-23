import type { WeixinBackendAdapter } from "../contracts.js";
import { CursorAcpClient } from "./acp-client.js";

const cursorAcpClient = new CursorAcpClient();

export const cursorBackendAdapter: WeixinBackendAdapter = {
  id: "cursor",
  mode: "lightweight",
  async reply(input) {
    return cursorAcpClient.runLightweightConversation(input);
  },
};
