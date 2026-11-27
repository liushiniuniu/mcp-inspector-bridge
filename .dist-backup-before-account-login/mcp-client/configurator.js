"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanMcpClients = scanMcpClients;
exports.getPayload = getPayload;
exports.injectMcpConfig = injectMcpConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const bridgeCommand = 'node';
const bridgeArgs = [path.resolve(__dirname, 'index.js').replace(/\\/g, '/')];
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const getAppdataPath = () => process.env.APPDATA || (isWin ? process.env.USERPROFILE + '\\AppData\\Roaming' : '');
const getMacAppSupportPath = () => process.env.HOME + '/Library/Application Support';
const getUserProfilePath = () => process.env.USERPROFILE || process.env.HOME || '';
const getAppDataDir = () => isWin ? getAppdataPath() : getMacAppSupportPath();
const targetPaths = [
    { name: 'Antigravity', file: path.join(getUserProfilePath(), '.gemini', 'antigravity', 'mcp_config.json') },
    { name: 'Cherry Studio', file: path.join(getAppDataDir(), 'cherry-studio', 'mcp.json') },
    { name: 'Claude Code', file: path.join(getUserProfilePath(), '.claude.json') },
    { name: 'Claude Desktop', file: path.join(getAppDataDir(), 'Claude', 'claude_desktop_config.json') },
    { name: 'Cline', file: path.join(getAppDataDir(), 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'settings', 'cline_mcp_settings.json') },
    { name: 'CodeBuddy CLI', file: path.join(getUserProfilePath(), '.codebuddy', 'mcp.json') },
    { name: 'Codex', file: path.join(getUserProfilePath(), '.codex', 'mcp.json') },
    { name: 'Cursor', file: path.join(getUserProfilePath(), '.cursor', 'mcp.json') },
    { name: 'Gemini CLI', file: path.join(getUserProfilePath(), '.gemini', 'mcp.json') },
    { name: 'GitHub Copilot CLI', file: path.join(getUserProfilePath(), '.config', 'github-copilot', 'mcp.json') },
    { name: 'Kilo Code', file: path.join(getUserProfilePath(), '.kilo', 'mcp.json') },
    { name: 'Kiro', file: path.join(getUserProfilePath(), '.kiro', 'mcp.json') },
    { name: 'OpenCode', file: path.join(getUserProfilePath(), '.opencode', 'mcp.json') },
    { name: 'Qwen Code', file: path.join(getUserProfilePath(), '.qwen', 'mcp.json') },
    { name: 'Rider GitHub Copilot', file: path.join(getAppDataDir(), 'JetBrains', 'Rider', 'github-copilot', 'mcp.json') },
    { name: 'Roo Code', file: path.join(getAppDataDir(), 'Code', 'User', 'globalStorage', 'rooveterinaryinc.roo-cline', 'settings', 'cline_mcp_settings.json') },
    { name: 'Trae', file: path.join(getUserProfilePath(), '.trae', 'mcp.json') },
    { name: 'Trae CN', file: path.join(getUserProfilePath(), '.trae-cn', 'mcp.json') },
    { name: 'VSCode GitHub Copilot', file: path.join(getAppDataDir(), 'Code', 'User', 'globalStorage', 'github.copilot', 'mcp.json') },
    { name: 'VSCode Insiders GitHub Copilot', file: path.join(getAppDataDir(), 'Code - Insiders', 'User', 'globalStorage', 'github.copilot', 'mcp.json') },
    { name: 'Windsurf', file: path.join(getUserProfilePath(), '.codeium', 'windsurf', 'mcp_config.json') },
    { name: 'Zed', file: path.join(getUserProfilePath(), '.config', 'zed', 'mcp.json') }
];
function scanMcpClients() {
    return targetPaths.map((t, id) => {
        if (!t.file) {
            return { id, name: t.name, path: '', isInstalled: false, isConfigured: false, isError: false };
        }
        const targetDir = path.dirname(t.file);
        const isInstalled = fs.existsSync(targetDir);
        let isConfigured = false;
        let isError = false;
        if (isInstalled && fs.existsSync(t.file)) {
            try {
                const raw = fs.readFileSync(t.file, 'utf-8');
                const data = JSON.parse(raw);
                if (data.mcpServers && data.mcpServers['cocos-inspector-bridge']) {
                    const cfg = data.mcpServers['cocos-inspector-bridge'];
                    if (cfg.command && cfg.command.includes('node') && cfg.args && cfg.args[0] && cfg.args[0].includes('index.js')) {
                        isConfigured = true;
                    }
                }
            }
            catch (e) {
                isError = true;
            }
        }
        return { id, name: t.name, path: t.file, isInstalled, isConfigured, isError };
    });
}
function getPayload() {
    const payload = {
        "mcpServers": {
            "cocos-inspector-bridge": {
                "command": bridgeCommand,
                "args": bridgeArgs
            }
        }
    };
    return JSON.stringify(payload, null, 2);
}
function injectMcpConfig(clientId) {
    let log = '';
    let successCount = 0;
    let targets = targetPaths.map((t, i) => ({ ...t, id: i }));
    if (typeof clientId === 'number' && clientId >= 0) {
        targets = targets.filter(t => t.id === clientId);
    }
    for (const target of targets) {
        if (!target.file)
            continue;
        const targetDir = path.dirname(target.file);
        if (!fs.existsSync(targetDir)) {
            continue;
        }
        let mcpData = { mcpServers: {} };
        if (fs.existsSync(target.file)) {
            try {
                const raw = fs.readFileSync(target.file, 'utf-8');
                mcpData = JSON.parse(raw);
                if (!mcpData.mcpServers) {
                    mcpData.mcpServers = {};
                }
            }
            catch (e) {
                log += `⚠️ [${target.name}] 文件损坏，放弃写入: ${e.message}\n`;
                continue;
            }
        }
        mcpData.mcpServers['cocos-inspector-bridge'] = {
            command: bridgeCommand,
            args: bridgeArgs
        };
        try {
            fs.writeFileSync(target.file, JSON.stringify(mcpData, null, 2), 'utf-8');
            log += `✅ [${target.name}] 成功注入配置。\n`;
            successCount++;
        }
        catch (e) {
            log += `❌ [${target.name}] 写入失败: ${e.message}\n`;
        }
    }
    if (successCount === 0 && log === '') {
        return "未能发现所选的常见 AI 客户端 (Claude/Cursor) 全局配置文件，无法写入。";
    }
    return log;
}
//# sourceMappingURL=configurator.js.map