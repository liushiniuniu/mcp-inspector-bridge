"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCdpLogListener = initCdpLogListener;
exports.getCdpLogs = getCdpLogs;
exports.getCdpStatus = getCdpStatus;
exports.detachCdpListener = detachCdpListener;
const MAX_BUFFER = 500;
const MAX_MSG_LEN = 300;
let buffer = [];
let targetWC = null;
let listening = false;
let _useInjection = false; // ★ 是否使用了注入模式（webview 场景）
let _useCdp = false; // ★ 是否使用 CDP debugger 模式（webview 场景优先）
let _eventCount = 0;
const CDP_PROTOCOL_VERSION = '1.3';
/** 将日志条目推入 RingBuffer（自动截断到 MAX_BUFFER 上限） */
function push(e) {
    _eventCount++;
    buffer.push(e);
    if (buffer.length > MAX_BUFFER)
        buffer.shift();
}
/** 将 CDP Runtime.consoleAPICalled 事件的 args (RemoteObject[]) 解析为可读字符串 */
function parseCdpArgs(args) {
    return args.map((a) => {
        if (a.type === 'string' && a.value !== undefined)
            return a.value;
        if (a.type === 'undefined')
            return 'undefined';
        if (a.type === 'null' || a.value === null)
            return 'null';
        if (a.type === 'number' || a.type === 'boolean')
            return String(a.value);
        if (a.type === 'object' && a.description)
            return a.description;
        if (a.type === 'function' && a.description)
            return a.description;
        if (a.value !== undefined)
            return String(a.value);
        return a.description || `[${a.type}]`;
    }).join(' ');
}
/** 处理 CDP Runtime.consoleAPICalled 事件，转为 CdpLogEntry 并推入 buffer */
function handleCdpConsoleEvent(params) {
    var _a, _b;
    const rawType = params.type || 'log';
    const type = rawType === 'warning' ? 'warn' : rawType;
    const message = parseCdpArgs(params.args || []).slice(0, MAX_MSG_LEN);
    const firstFrame = (_b = (_a = params.stackTrace) === null || _a === void 0 ? void 0 : _a.callFrames) === null || _b === void 0 ? void 0 : _b[0];
    push({
        type,
        timestamp: params.timestamp || Date.now(),
        message,
        args: [],
        url: firstFrame === null || firstFrame === void 0 ? void 0 : firstFrame.url,
        line: firstFrame === null || firstFrame === void 0 ? void 0 : firstFrame.lineNumber,
        column: firstFrame === null || firstFrame === void 0 ? void 0 : firstFrame.columnNumber,
    });
}
/**
 * 要注入到 webview 页面内的 JS 代码（IIFE）
 *
 * 原理：包装 console.log/warn/error，每次调用时将副本写入 window.__mcpLogBuffer。
 * 原始行为完全不变（originalFn.apply(console, args)），零视觉影响。
 * 来源追踪通过 Error.stack 解析获取（仅用于内部存储，不注入输出文本）。
 */
const INJECTION_SCRIPT = `
//# sourceURL=mcp-log-capture.js
(function(){
    if (window.__mcpLogInjected) return;
    window.__mcpLogInjected = true;
    window.__mcpLogBuffer = [];
    var MAX = 1000;
    
    function parseCaller() {
        try { throw new Error('_'); } catch(e) {
            var lines = e.stack.split('\\n');
            // 调用栈: [0]=Error, [1]=parseCaller, [2]=capture, [3~N]=console包装层/真实调用者
            for (var i = 3; i < Math.min(lines.length, 16); i++) {
                var m = lines[i].match(/\\((.+?):(\\d+):(\\d+)\\)/);
                if (!m) m = lines[i].match(/at\\s+(.+?):(\\d+):(\\d+)/);
                if (m && !m[1].includes('mcp-log-capture')) return { url: m[1], line: parseInt(m[2]), col: parseInt(m[3]) };
            }
        }
        return null;
    }
    
    function capture(type, args) {
        try {
            var caller = parseCaller();
            var msg = Array.prototype.slice.call(args).map(function(a) {
                if (typeof a === 'object') try { return JSON.stringify(a); } catch(e) {}
                return String(a);
            }).join(' ');
            if (msg.length > 2000) msg = msg.slice(0, 2000) + '...(截断长日志)';
            var entry = {
                t: type === 'warning' ? 'warn' : type,
                ts: Date.now(),
                m: msg,
                u: caller ? caller.url : undefined,
                l: caller ? caller.line : undefined,
                c: caller ? caller.col : undefined
            };
            window.__mcpLogBuffer.push(entry);
            if (window.__mcpLogBuffer.length > MAX) window.__mcpLogBuffer.shift();
        } catch(_) {}
    }

    function createProxy(orig, k) {
        return new Proxy(orig, {
            apply: function(target, thisArg, argumentsList) {
                if (window.__mcpLogRecursionGuard) {
                    return Reflect.apply(target, thisArg, argumentsList);
                }
                window.__mcpLogRecursionGuard = true;
                capture(k, argumentsList);
                var ret = Reflect.apply(target, thisArg, argumentsList);
                window.__mcpLogRecursionGuard = false;
                return ret;
            }
        });
    }
    
    var methods = ['log', 'warn', 'error', 'info', 'debug'];
    methods.forEach(function(k) {
        if (console[k]) {
            console[k] = createProxy(console[k], k);
        }
    });

    // 侵入式劫持 cc API，支持稍后加载的 cc
    var hijackCc = function() {
        if (window.cc && !window.__mcpCcHijacked) {
            window.__mcpCcHijacked = true;
            ['log', 'warn', 'error'].forEach(function(k) {
                if (window.cc[k]) {
                    window.cc[k] = createProxy(window.cc[k], k);
                }
            });
            console.log('[MCP] cc 对象引擎日志通道劫持已完成');
        }
    };
    
    // 立即尝试，未就绪时轮询
    hijackCc();
    if (!window.__mcpCcHijacked) {
        var timer = setInterval(function() {
            hijackCc();
            if (window.__mcpCcHijacked) clearInterval(timer);
        }, 500);
        // 10秒后停止轮询，防止非 cocos 环境死循环
        setTimeout(function() { clearInterval(timer); }, 10000);
    }
    
    console.log('[MCP] 日志捕获已启用');
})();
`;
/**
 * 初始化日志监听器（幂等 — 重复调用安全）
 */
async function initCdpLogListener(silent = false) {
    var _a, _b, _c;
    if (listening && targetWC && !targetWC.isDestroyed())
        return true;
    if (listening && (!targetWC || ((_a = targetWC.isDestroyed) === null || _a === void 0 ? void 0 : _a.call(targetWC)))) {
        listening = false;
        targetWC = null;
        _useInjection = false;
    }
    try {
        const { webContents } = require('electron');
        const all = webContents.getAllWebContents();
        const urls = all.map((w) => {
            var _a, _b;
            return ({
                url: w.getURL(),
                id: w.id,
                type: (_a = w.getType) === null || _a === void 0 ? void 0 : _a.call(w),
                destroyed: (_b = w.isDestroyed) === null || _b === void 0 ? void 0 : _b.call(w),
            });
        });
        if (!silent)
            Editor.log(`[CDP Log] 扫描到 ${all.length} 个 WebContents: ${JSON.stringify(urls)}`);
        // 查找预览游戏页面
        const game = all.find((w) => {
            var _a;
            const u = w.getURL();
            if (!u || ((_a = w.isDestroyed) === null || _a === void 0 ? void 0 : _a.call(w)))
                return false;
            if (u.includes('inspector') || u.startsWith('chrome-extension') || u === 'about:blank')
                return false;
            return /https?:\/\/(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(u);
        });
        if (!game) {
            if (!silent)
                Editor.log('[CDP Log] 未找到匹配的预览页面 WebContents');
            return false;
        }
        if (!silent)
            Editor.log(`[CDP Log] ✓ 找到目标: id=${game.id} type=${(_b = game.getType) === null || _b === void 0 ? void 0 : _b.call(game)} url=${game.getURL().slice(0, 120)}`);
        targetWC = game;
        const wcType = ((_c = game.getType) === null || _c === void 0 ? void 0 : _c.call(game)) || 'unknown';
        if (wcType === 'webview') {
            // ★ Webview 模式: CDP debugger 优先 + 注入降级
            try {
                // 尝试通过 CDP debugger 附加（零侵入，无源归属问题）
                if (!silent)
                    Editor.log('[CDP Log] 尝试 CDP debugger 附加到 webview...');
                game.debugger.attach(CDP_PROTOCOL_VERSION);
                await game.debugger.sendCommand('Runtime.enable');
                // 注册 CDP 事件监听
                game.debugger.on('message', (_ev, method, params) => {
                    if (method === 'Runtime.consoleAPICalled') {
                        handleCdpConsoleEvent(params);
                    }
                });
                // 监听 debugger 被外部 detach（如用户打开 DevTools）
                game.debugger.on('detach', (_ev, reason) => {
                    if (!silent)
                        Editor.log(`[CDP Log] Debugger 被外部 detach (${reason})，降级到注入方案`);
                    _useCdp = false;
                    _useInjection = true;
                    // 尝试注入作为补救
                    game.executeJavaScript(INJECTION_SCRIPT).catch(() => { });
                });
                _useCdp = true;
                _useInjection = false;
                if (!silent)
                    Editor.log('[CDP Log] ✓ CDP debugger 附加成功，使用 Runtime.consoleAPICalled 监听日志');
            }
            catch (e) {
                // CDP 附加失败（如 DevTools 已占用），降级到注入方案
                if (!silent)
                    Editor.log(`[CDP Log] Debugger 附加失败 (${e.message})，降级到注入方案`);
                try {
                    await game.executeJavaScript(INJECTION_SCRIPT);
                    _useCdp = false;
                    _useInjection = true;
                    // 验证注入是否生效
                    await new Promise((resolve) => setTimeout(resolve, 200));
                    const testResult = await game.executeJavaScript(`
                        JSON.stringify({
                            injected: !!window.__mcpLogInjected,
                            bufferSize: window.__mcpLogBuffer ? window.__mcpLogBuffer.length : -1
                        })
                    `);
                    if (!silent)
                        Editor.log(`[CDP Log] 注入降级验证结果: ${testResult}`);
                }
                catch (injErr) {
                    if (!silent)
                        Editor.error('[CDP Log] 注入降级也失败了:', injErr.message);
                }
            }
        }
        else {
            // ★ 非 Webview 模式：使用原生 console-message 事件
            _useInjection = false;
            game.on('console-message', (_ev, level, message, line, sourceId) => {
                push({
                    type: level === 1 ? 'warn' : (level >= 2 ? 'error' : 'log'),
                    timestamp: Date.now(),
                    message: message.slice(0, MAX_MSG_LEN),
                    args: [],
                    url: sourceId || undefined,
                    line: line || undefined,
                    column: undefined,
                });
            });
        }
        game.once('destroyed', () => {
            if (!silent)
                Editor.log('[CDP Log] 目标 WebContents 已销毁');
            listening = false;
            targetWC = null;
            _useInjection = false;
            _useCdp = false;
        });
        listening = true;
        if (!silent)
            Editor.log(`[CDP Log] ✓ 初始化完成 (mode=${_useCdp ? 'cdp-debugger' : (_useInjection ? 'injection' : 'native-event')})`);
        return true;
    }
    catch (e) {
        listening = false;
        targetWC = null;
        _useInjection = false;
        _useCdp = false;
        if (!silent)
            Editor.error('[CDP Log] initCdpLogListener 失败:', e.message || e);
        return false;
    }
}
/**
 * 获取缓存日志（支持 tail 截断和 level 过滤）
 *
 * @param tail - 最多返回的条目数（默认 50，上限 100）
 * @param level - 过滤级别: "all" | "warn" | "error"
 */
async function getCdpLogs(tail = 50, level = 'all') {
    var _a;
    // 如果是注入模式，先从 webview 轮询最新数据
    if (_useInjection && !_useCdp && targetWC && !((_a = targetWC.isDestroyed) === null || _a === void 0 ? void 0 : _a.call(targetWC))) {
        try {
            const raw = await targetWC.executeJavaScript(`
                (function() {
                    if (!window.__mcpLogBuffer) return [];
                    var data = window.__mcpLogBuffer.slice();
                    window.__mcpLogBuffer = [];
                    return data;
                })()
            `);
            if (Array.isArray(raw)) {
                for (const entry of raw) {
                    push({
                        type: entry.t || 'log',
                        timestamp: entry.ts || Date.now(),
                        message: entry.m || '',
                        args: [],
                        url: entry.u,
                        line: entry.l,
                        column: entry.c,
                    });
                }
            }
        }
        catch (_) {
            // 轮询失败时返回已有缓存
        }
    }
    let r = buffer;
    if (level === 'error') {
        r = r.filter(e => e.type === 'error');
    }
    else if (level === 'warn') {
        r = r.filter(e => e.type === 'warn' || e.type === 'error');
    }
    return r.slice(-Math.min(tail, 100));
}
/** 获取当前连接状态和缓冲区大小 */
function getCdpStatus() {
    let method = 'native-event';
    if (_useCdp)
        method = 'cdp-debugger';
    else if (_useInjection)
        method = 'webview-injection';
    return {
        attached: listening,
        size: buffer.length,
        method,
        eventCount: _eventCount,
        injection: _useInjection,
        cdp: _useCdp,
    };
}
/** 断开并清空 */
function detachCdpListener() {
    var _a;
    if (_useCdp && targetWC && !((_a = targetWC.isDestroyed) === null || _a === void 0 ? void 0 : _a.call(targetWC))) {
        try {
            targetWC.debugger.detach();
        }
        catch (_) {
            // debugger 可能已被外部 detach，忽略错误
        }
    }
    targetWC = null;
    listening = false;
    _useInjection = false;
    _useCdp = false;
    buffer = [];
}
//# sourceMappingURL=cdp-log-listener.js.map