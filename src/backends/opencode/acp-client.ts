import { AcpSubprocessLightweightClient } from "../lightweight/acp-subprocess-client.js";

export class OpenCodeAcpClient extends AcpSubprocessLightweightClient {
  constructor() {
    super({
      backendId: "opencode",
      backendLabel: "OpenCode",
      defaultCommand: "opencode",
      defaultArgs: ["acp"],
      commandEnvVarNames: ["WEIXIN_OPENCODE_ACP_BIN", "OPENCODE_ACP_BIN"],
      argsEnvVarNames: ["WEIXIN_OPENCODE_ACP_ARGS", "OPENCODE_ACP_ARGS"],
      cwdEnvVarNames: ["WEIXIN_OPENCODE_ACP_CWD", "OPENCODE_ACP_CWD"],
      permissionModeEnvVarNames: ["WEIXIN_OPENCODE_ACP_PERMISSION_MODE", "OPENCODE_ACP_PERMISSION_MODE"],
      missingCommandHint: "Install OpenCode CLI or set WEIXIN_OPENCODE_ACP_BIN.",
      authRequiredHint: "OpenCode ACP requires authentication. Run `opencode auth login` or open `opencode` manually in the target workdir first.",
      mediaOutDirName: "opencode-acp-out",
      cancelledMessage: "OpenCode 已取消当前操作。",
    });
  }
}
