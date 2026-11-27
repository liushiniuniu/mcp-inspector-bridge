'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
// Removed Node path import; using custom getBaseName function
const ipc_router_1 = require("./ipc-router");
const proxy_manager_1 = require("./proxy-manager");
let _isSceneActive = false;
/**
 * 跨平台路径 Basename 提取工具（不依赖 Node.js path 模块）
 * 用于在编辑器不同环境（Main/Render）下安全获取工程目录名
 * @param p 待处理的完整路径字符串
 * @returns 路径的最后一个片段（项目文件夹名称）
 */
function getBaseName(p) {
    if (!p)
        return '';
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || '';
}
let _wss = null;
let _mcpStatus = { active: false, port: 4456, error: 'Initializing...' };
let _logHeartbeatTimer = null;
/**
 * mcp-inspector-bridge: 主进程入口
 */
module.exports = {
    load() {
        // [Backend] 启动时假定场景还未完全就绪，等待 scene:ready
        _isSceneActive = false;
        try {
            const router = (0, ipc_router_1.startMcpRouter)((status) => {
                _mcpStatus = { ...status, projectName: getBaseName(Editor.Project.path || ''), projectPath: Editor.Project.path || '' };
                Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-status-changed', _mcpStatus);
                if (status.active) {
                    Editor.log(`[MCP] Bridge started on ws://localhost:${status.port}`);
                }
                else if (status.error) {
                    Editor.error(`[MCP] WebSocket server error on port ${status.port}:`, status.error);
                }
            });
            _wss = router;
        }
        catch (err) {
            _mcpStatus = { active: false, port: 4456, error: err.message || 'Unknown error' };
            Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'mcp-status-changed', _mcpStatus);
            Editor.error('[MCP] Failed to start WebSocket server:', err);
        }
        // 立即进入激进的全天候日志监听器自动注入探测（用于彻底捕获极早期的报错）
        _logHeartbeatTimer = setInterval(async () => {
            try {
                const { initCdpLogListener, getCdpStatus } = require('./cdp-log-listener');
                const status = getCdpStatus();
                if (!status.attached) {
                    await initCdpLogListener(true);
                }
            }
            catch (e) { }
        }, 1000);
    },
    unload() {
        if (_wss) {
            _wss.close();
            _wss = null;
        }
        if (_logHeartbeatTimer) {
            clearInterval(_logHeartbeatTimer);
            _logHeartbeatTimer = null;
        }
    },
    // 注册跨进程 IPC 消息侦听器
    messages: {
        'scene:ready'() {
            _isSceneActive = true;
            Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'scene-status-changed', { active: true });
        },
        'scene:reloading'() {
            _isSceneActive = false;
            Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'scene-status-changed', { active: false });
        },
        'scene:closed'() {
            _isSceneActive = false;
            Editor.Ipc.sendToPanel('mcp-inspector-bridge', 'scene-status-changed', { active: false });
        },
        'open'() {
            // 收到菜单指令，打开主面板
            Editor.Panel.open('mcp-inspector-bridge');
        },
        'query-scene-active'(event) {
            if (event.reply) {
                // 也可通过向 scene 面板发信检查双保险
                const active = _isSceneActive !== false;
                event.reply(null, active);
            }
        },
        'query-mcp-status'(event) {
            if (event.reply) {
                event.reply(null, _mcpStatus);
            }
        },
        'query-node-tree'(event) {
            // 目前已经通过 probe/crawler 脚本使用了 setInterval 自动轮询并通过
            // __mcpInspector.updateTree 自动推送。
            // 这里保留该接口为下阶段“按需主动拉取”做能力支持，当面板明确通知主进程强制刷新时，从此处处理。
            // 由于当前插件直接使用 <webview> 或前端控制的 BrowserView，主进程暂只作转发标记即可。
            // 后续如有明确需求，此处可直接获取对应 webContents ID 执行 JS.
            if (event.reply) {
                event.reply(null, { status: "polling_active", msg: "已经由注入的爬虫自动同步数据" });
            }
        },
        'query-resolution'(event) {
            const profile = Editor.Profile.load('profile://project/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
            const res = profile.get('last-resolution') || 'FIT';
            if (event.reply) {
                event.reply(null, res);
            }
        },
        'save-resolution'(event, value) {
            const profile = Editor.Profile.load('profile://project/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
            profile.set('last-resolution', value);
            profile.save();
        },
        'query-fps'(event) {
            const profile = Editor.Profile.load('profile://project/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
            const res = profile.get('show-fps');
            if (event.reply) {
                event.reply(null, res === undefined ? false : res);
            }
        },
        'save-fps'(event, value) {
            const profile = Editor.Profile.load('profile://project/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
            profile.set('show-fps', value);
            profile.save();
        },
        'query-audio-mute'(event) {
            const profile = Editor.Profile.load('profile://project/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
            const res = profile.get('audio-mute');
            if (event.reply) {
                event.reply(null, res === undefined ? false : res);
            }
        },
        'save-audio-mute'(event, value) {
            const profile = Editor.Profile.load('profile://project/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
            profile.set('audio-mute', value);
            profile.save();
        },
        'query-panel-width'(event) {
            const profile = Editor.Profile.load('profile://project/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
            const res = profile.get('panel-width');
            if (event.reply) {
                event.reply(null, res === undefined ? 400 : res);
            }
        },
        'save-panel-width'(event, value) {
            const profile = Editor.Profile.load('profile://project/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
            profile.set('panel-width', value);
            profile.save();
        },
        // --- 运行模式 / 自定义预览地址持久化（项目级） ---
        'query-run-mode'(event) {
            try {
                const profile = Editor.Profile.load('profile://project/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
                const mode = profile.get('run-mode') || 'preview';
                const url = profile.get('custom-url') || '';
                if (event.reply)
                    event.reply(null, { mode, url });
            }
            catch (e) {
                if (event.reply)
                    event.reply(null, { mode: 'preview', url: '' });
            }
        },
        'save-run-mode'(event, payload) {
            try {
                const profile = Editor.Profile.load('profile://project/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
                if (payload && payload.mode)
                    profile.set('run-mode', payload.mode);
                if (payload && typeof payload.url === 'string')
                    profile.set('custom-url', payload.url);
                profile.save();
            }
            catch (e) {
                Editor.warn('[Bridge] 保存运行模式失败: ' + e.message);
            }
        },
        'query-custom-resolutions'(event) {
            const profile = Editor.Profile.load('profile://global/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
            const res = profile.get('custom-resolutions') || [];
            if (event.reply) {
                event.reply(null, res);
            }
        },
        'save-custom-resolutions'(event, value) {
            const profile = Editor.Profile.load('profile://global/mcp-inspector-bridge.json', 'mcp-inspector-bridge');
            profile.set('custom-resolutions', value);
            profile.save();
        },
        'query-preview-port'(event) {
            let port = 7456;
            try {
                if (typeof Editor !== 'undefined' && Editor.PreviewServer) {
                    if (Editor.PreviewServer._previewPort) {
                        port = Editor.PreviewServer._previewPort;
                    }
                }
            }
            catch (e) { }
            // 策略 2: profile 取值备用
            if (port === 7456) {
                try {
                    const profile = Editor.Profile.load('profile://global/settings.json');
                    if (profile && profile.data && profile.data['preview-port']) {
                        port = profile.data['preview-port'];
                    }
                }
                catch (e) { }
            }
            if (event.reply) {
                event.reply(null, port);
            }
        },
        'mcp-scan-clients'(event) {
            try {
                const { scanMcpClients } = require('./mcp-client/configurator');
                const list = scanMcpClients();
                if (event.reply)
                    event.reply(null, list);
            }
            catch (e) {
                if (event.reply)
                    event.reply(new Error("scan 出错: " + e.message));
            }
        },
        'mcp-get-payload'(event) {
            try {
                const { getPayload } = require('./mcp-client/configurator');
                const pl = getPayload();
                if (event.reply)
                    event.reply(null, pl);
            }
            catch (e) {
                if (event.reply)
                    event.reply(new Error("payload 出错: " + e.message));
            }
        },
        'mcp-inject-client'(event, clientId) {
            try {
                const { injectMcpConfig } = require('./mcp-client/configurator');
                const log = injectMcpConfig(clientId === -1 ? undefined : clientId);
                if (event.reply)
                    event.reply(null, log);
            }
            catch (e) {
                if (event.reply)
                    event.reply(null, "配置写入报错: " + e.message);
            }
        },
        // --- 用户脚本系统: 文件 I/O handlers ---
        'script-save-file'(event, args) {
            const fs = require('fs');
            const path = require('path');
            const extDir = path.join(Editor.Project.path || __dirname, 'extensions');
            if (!fs.existsSync(extDir))
                fs.mkdirSync(extDir, { recursive: true });
            const filePath = path.join(extDir, args.fileName);
            fs.writeFileSync(filePath, args.content, 'utf-8');
            const profile = Editor.Profile.load('profile://project/mcp-scripts.json', 'mcp-inspector-bridge');
            const scripts = profile.get('scripts') || {};
            const key = args.fileName.replace(/\.user\.js$/i, '');
            scripts[key] = { enabled: true, installedAt: Date.now() };
            profile.set('scripts', scripts);
            profile.save();
            if (event.reply)
                event.reply(null, { success: true });
        },
        'script-set-enabled'(event, args) {
            const profile = Editor.Profile.load('profile://project/mcp-scripts.json', 'mcp-inspector-bridge');
            const scripts = profile.get('scripts') || {};
            const key = args.fileName.replace(/\.user\.js$/i, '');
            if (scripts[key]) {
                scripts[key].enabled = args.enabled;
            }
            else {
                scripts[key] = { enabled: args.enabled, installedAt: Date.now() };
            }
            try {
                profile.set('scripts', scripts);
                profile.save();
            }
            catch (e) {
                Editor.warn(`[Script] profile 写入失败: ${e.message}`);
            }
            if (event.reply)
                event.reply(null, { success: true });
        },
        'script-delete-file'(event, args) {
            const fs = require('fs');
            const path = require('path');
            const extDir = path.join(Editor.Project.path || __dirname, 'extensions');
            const filePath = path.join(extDir, args.fileName);
            try {
                if (fs.existsSync(filePath))
                    fs.unlinkSync(filePath);
            }
            catch (e) { }
            const profile = Editor.Profile.load('profile://project/mcp-scripts.json', 'mcp-inspector-bridge');
            const scripts = profile.get('scripts') || {};
            const key = args.fileName.replace(/\.user\.js$/i, '');
            delete scripts[key];
            profile.set('scripts', scripts);
            profile.save();
            if (event.reply)
                event.reply(null, { success: true });
        },
        'script-list-files'(event) {
            const fs = require('fs');
            const path = require('path');
            const extDir = path.join(Editor.Project.path || __dirname, 'extensions');
            if (!fs.existsSync(extDir)) {
                if (event.reply)
                    event.reply(null, []);
                return;
            }
            const profile = Editor.Profile.load('profile://project/mcp-scripts.json', 'mcp-inspector-bridge');
            const scripts = profile.get('scripts') || {};
            const files = fs.readdirSync(extDir).filter((f) => f.endsWith('.user.js'));
            const result = files.map((f) => {
                var _a;
                const key = f.replace(/\.user\.js$/i, '');
                return { name: f, enabled: ((_a = scripts[key]) === null || _a === void 0 ? void 0 : _a.enabled) !== false };
            });
            if (event.reply)
                event.reply(null, result);
        },
        'script-read-file'(event, args) {
            const fs = require('fs');
            const path = require('path');
            const extDir = path.join(Editor.Project.path || __dirname, 'extensions');
            const filePath = path.join(extDir, args.fileName);
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                if (event.reply)
                    event.reply(null, { content });
            }
            catch (e) {
                if (event.reply)
                    event.reply(null, { error: e.message });
            }
        },
        'script-import-dialog'(event) {
            const { dialog } = require('electron');
            const path = require('path');
            const fs = require('fs');
            const extDir = path.join(Editor.Project.path || __dirname, 'extensions');
            if (!fs.existsSync(extDir))
                fs.mkdirSync(extDir, { recursive: true });
            dialog.showOpenDialog({
                title: '导入用户脚本',
                filters: [{ name: 'UserScript', extensions: ['js'] }],
                properties: ['openFile'],
            }).then((result) => {
                if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
                    if (event.reply)
                        event.reply(null, { canceled: true });
                    return;
                }
                const srcPath = result.filePaths[0];
                const fileName = path.basename(srcPath).replace(/\.js$/i, '.user.js');
                const destPath = path.join(extDir, fileName);
                fs.copyFileSync(srcPath, destPath);
                const content = fs.readFileSync(destPath, 'utf-8');
                if (event.reply)
                    event.reply(null, { fileName, content });
            }).catch((e) => {
                if (event.reply)
                    event.reply(null, { error: e.message });
            });
        },
        'script-export-file'(event, args) {
            const { dialog } = require('electron');
            const path = require('path');
            const fs = require('fs');
            const extDir = path.join(Editor.Project.path || __dirname, 'extensions');
            const srcPath = path.join(extDir, args.fileName);
            dialog.showSaveDialog({
                title: '导出用户脚本',
                defaultPath: args.fileName,
                filters: [{ name: 'UserScript', extensions: ['js'] }],
            }).then((result) => {
                if (result.canceled || !result.filePath)
                    return;
                try {
                    fs.copyFileSync(srcPath, result.filePath);
                }
                catch (_) { }
            }).catch(() => { });
        },
        'script-register-tool'(event, toolDef) {
            // 动态 MCP 工具注册预留（面板→主进程）
            if (event.reply)
                event.reply(null, { success: true });
        },
        'script-unregister-tool'(event, name) {
            if (event.reply)
                event.reply(null, { success: true });
        },
        'query-cdp-logs'(event, args) {
            // 懒启动 CDP 监听器（首次查询时自动 attach）
            async function handle() {
                try {
                    const { initCdpLogListener, getCdpLogs, getCdpStatus } = require('./cdp-log-listener');
                    const status = getCdpStatus();
                    if (!status.attached) {
                        const ok = await initCdpLogListener();
                        if (!ok) {
                            Editor.log('[CDP Log] 懒启动未找到预览页面 WebContents');
                        }
                    }
                    if (event.reply) {
                        const logs = await getCdpLogs((args === null || args === void 0 ? void 0 : args.tail) || 50, (args === null || args === void 0 ? void 0 : args.level) || 'all');
                        // ★ 返回诊断信息：CDP 连接状态 + 日志数据
                        event.reply(null, {
                            _debug: { ...getCdpStatus(), ts: Date.now() },
                            result: logs,
                        });
                    }
                }
                catch (e) {
                    if (event.reply) {
                        event.reply(null, { error: e.message, _debug: { attached: false, size: 0 } });
                    }
                }
            }
            handle();
        },
        // --- 截图功能 handlers ---
        'screenshot-capture'(event, args) {
            try {
                const { webContents, clipboard, nativeImage } = require('electron');
                const { dialog } = require('electron');
                const fs = require('fs');
                const path = require('path');
                const allWc = webContents.getAllWebContents();
                const targetWc = allWc.find((wc) => {
                    const url = wc.getURL();
                    return url && url.includes('localhost:') && !url.includes('inspector');
                });
                if (!targetWc) {
                    Editor.warn('[Screenshot] 未找到活跃的游戏预览 WebContents');
                    if (event.reply)
                        event.reply(null, { success: false, error: '未找到游戏预览画面' });
                    return;
                }
                const handleImage = (img) => {
                    if (!img || img.isEmpty()) {
                        Editor.warn('[Screenshot] capturePage 返回空图像');
                        return;
                    }
                    // 1. 写入剪贴板
                    clipboard.writeImage(img);
                    Editor.log('[Screenshot] 已复制到剪贴板');
                    // 2. 弹出保存对话框
                    const now = new Date();
                    const pad = (n) => n.toString().padStart(2, '0');
                    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                    const defaultName = `screenshot-${ts}.png`;
                    dialog.showSaveDialog({
                        title: '保存游戏截图',
                        defaultPath: defaultName,
                        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
                    }).then((result) => {
                        if (result.canceled || !result.filePath)
                            return;
                        const pngBuffer = img.toPNG();
                        fs.writeFileSync(result.filePath, pngBuffer);
                        Editor.log('[Screenshot] 已保存到:', result.filePath);
                    }).catch((e) => {
                        Editor.warn('[Screenshot] 保存对话框失败:', e.message);
                    });
                };
                const result = targetWc.capturePage();
                if (result && typeof result.then === 'function') {
                    result.then(handleImage).catch((e) => {
                        Editor.warn('[Screenshot] capturePage 失败:', e.message);
                    });
                }
                else if (result) {
                    handleImage(result);
                }
            }
            catch (e) {
                Editor.warn('[Screenshot] handler 异常:', e.message);
                if (event.reply)
                    event.reply(null, { success: false, error: e.message });
            }
        },
        'show-save-video-dialog'(event, args) {
            try {
                const { dialog } = require('electron');
                const now = new Date();
                const pad = (n) => n.toString().padStart(2, '0');
                const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
                const ext = (args && typeof args.ext === 'string') ? args.ext : 'webm';
                const defaultName = `video-${ts}.${ext}`;
                const filterName = ext === 'mp4' ? 'MP4 视频' : 'WebM 视频';
                dialog.showSaveDialog({
                    title: '保存游戏录屏',
                    defaultPath: defaultName,
                    filters: [{ name: filterName, extensions: [ext] }],
                }).then((result) => {
                    if (event.reply)
                        event.reply(null, result);
                }).catch((e) => {
                    if (event.reply)
                        event.reply(e);
                });
            }
            catch (e) {
                if (event.reply)
                    event.reply(e);
            }
        },
        'psd-save-file'(event, args) {
            const { dialog } = require('electron');
            const fs = require('fs');
            dialog.showSaveDialog({
                title: '导出 PSD 布局文件',
                defaultPath: args.defaultName,
                filters: [{ name: 'Photoshop PSD', extensions: ['psd'] }],
            }).then((result) => {
                if (result.canceled || !result.filePath) {
                    if (event.reply)
                        event.reply(null, { canceled: true });
                    return;
                }
                const buf = Buffer.from(args.bufferArray);
                fs.writeFileSync(result.filePath, buf);
                if (event.reply)
                    event.reply(null, { success: true, filePath: result.filePath });
            }).catch((e) => {
                if (event.reply)
                    event.reply(e);
            });
        },
        /**
         * 设置 Webview 代理配置
         * @param event IPC 事件对象
         * @param config 代理配置数据
         */
        'set-webview-proxy'(event, config) {
            (0, proxy_manager_1.applyWebviewProxy)(config).then(() => {
                if (event.reply)
                    event.reply(null, { success: true });
            }).catch((e) => {
                if (event.reply)
                    event.reply(e);
            });
        },
        /**
         * 获取 Webview 代理配置
         * @param event IPC 事件对象
         */
        'get-webview-proxy'(event) {
            const config = (0, proxy_manager_1.getWebviewProxyConfig)();
            if (event.reply)
                event.reply(null, config);
        }
    },
};
//# sourceMappingURL=main.js.map