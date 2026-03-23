import { AcpSubprocessLightweightClient } from "../lightweight/acp-subprocess-client.js";

export class CopilotAcpClient extends AcpSubprocessLightweightClient {
  constructor() {
    super({
      backendId: "copilot",
      backendLabel: "GitHub Copilot",
      defaultCommand: "copilot",
      defaultArgs: ["--acp", "--stdio"],
      commandEnvVarNames: ["WEIXIN_COPILOT_ACP_BIN", "COPILOT_ACP_BIN"],
      argsEnvVarNames: ["WEIXIN_COPILOT_ACP_ARGS", "COPILOT_ACP_ARGS"],
      cwdEnvVarNames: ["WEIXIN_COPILOT_ACP_CWD", "COPILOT_ACP_CWD"],
      permissionModeEnvVarNames: ["WEIXIN_COPILOT_ACP_PERMISSION_MODE", "COPILOT_ACP_PERMISSION_MODE"],
      missingCommandHint: "Install GitHub Copilot CLI or set WEIXIN_COPILOT_ACP_BIN.",
      authRequiredHint: "GitHub Copilot ACP requires authentication. Run `copilot login` first or set GH_TOKEN/GITHUB_TOKEN.",
      mediaOutDirName: "copilot-acp-out",
      cancelledMessage: "GitHub Copilot 已取消当前操作。",
    });
  }
}
