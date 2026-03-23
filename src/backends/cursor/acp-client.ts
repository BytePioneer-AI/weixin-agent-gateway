import { AcpSubprocessLightweightClient } from "../lightweight/acp-subprocess-client.js";

export class CursorAcpClient extends AcpSubprocessLightweightClient {
  constructor() {
    super({
      backendId: "cursor",
      backendLabel: "Cursor CLI",
      defaultCommand: "cursor-agent",
      defaultArgs: ["acp"],
      commandEnvVarNames: ["WEIXIN_CURSOR_ACP_BIN", "CURSOR_ACP_BIN"],
      argsEnvVarNames: ["WEIXIN_CURSOR_ACP_ARGS", "CURSOR_ACP_ARGS"],
      cwdEnvVarNames: ["WEIXIN_CURSOR_ACP_CWD", "CURSOR_ACP_CWD"],
      permissionModeEnvVarNames: ["WEIXIN_CURSOR_ACP_PERMISSION_MODE", "CURSOR_ACP_PERMISSION_MODE"],
      missingCommandHint: "Install Cursor CLI and ensure `cursor-agent` is available, or set WEIXIN_CURSOR_ACP_BIN.",
      authRequiredHint: "Cursor ACP requires authentication. Run `cursor-agent login` first or set CURSOR_API_KEY.",
      mediaOutDirName: "cursor-acp-out",
      cancelledMessage: "Cursor CLI 已取消当前操作。",
    });
  }
}
