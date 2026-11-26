#!/usr/bin/env node
/**
 * cdp-webview-bridge
 * ------------------------------------------------------------------
 * 目的：让 VS Code 能对 Cocos 预览面板里的游戏画面断点调试。
 *
 * 为什么需要它：
 *   VS Code 内置的 js-debug 只认 CDP target 类型 page / iframe / worker /
 *   service_worker（源码里 `Df = new Set([...])`，且 main-target 过滤器第一句
 *   就是 `e.type === "page"`）。而面板里游戏画面是 Electron <webview>，
 *   它的 CDP target 类型是 "webview"，会被直接丢弃 —— 改 urlFilter 或改
 *   debug 类型都无效。
 *
 * 做法：
 *   起一个本地代理（默认 9223）。它冒充"浏览器级" CDP 端点：
 *     - /json/version 返回自己的 webSocketDebuggerUrl
 *     - 在 browser 会话里自己实现 Target.getTargets / setDiscoverTargets /
 *       attachToTarget，把 webview 的 type 改写成 page
 *     - 之后每个 target 会话的消息原样转发给真实的 webContents 端点
 *   于是 js-debug 看到的就是一个普通的 page target，可以正常 attach。
 *
 * 用法：
 *   node scripts/cdp-webview-bridge.js            # 默认 9222 -> 9223
 *   CDP_SOURCE_PORT=9222 CDP_BRIDGE_PORT=9223 node scripts/cdp-webview-bridge.js
 *   CDP_TARGET_FILTER=127.0.0.1:7457 node scripts/cdp-webview-bridge.js   # 只暴露匹配的 target
 *
 * 前置条件：编辑器带 --remote-debugging-port=9222 启动（Dashboard 设置里的「启动选项」）。
 * ------------------------------------------------------------------
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const SRC_HOST = process.env.CDP_SOURCE_HOST || '127.0.0.1';
const SRC_PORT = Number(process.env.CDP_SOURCE_PORT || 9222);
const PORT = Number(process.env.CDP_BRIDGE_PORT || 9223);
const FILTER = process.env.CDP_TARGET_FILTER || '';
const VERBOSE = process.env.CDP_BRIDGE_VERBOSE === '1';

/** js-debug 白名单里的类型，其余一律伪装成 page */
const KNOWN_TYPES = new Set(['page', 'iframe', 'worker', 'service_worker']);
const BROWSER = 'BROWSER'; // js-debug 用 Target.attachToBrowserTarget 拿到的会话 id

const log = (...args) => console.error('[cdp-bridge]', ...args);
const debug = (...args) => { if (VERBOSE) console.error('[cdp-bridge:v]', ...args); };

// ------------------------------------------------------------------ 上游查询

function httpGetJSON(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: SRC_HOST, port: SRC_PORT, path, timeout: 4000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout (' + path + ')')));
    req.on('error', reject);
  });
}

let targetList = [];

function exposed(t) {
  if (!FILTER) return true;
  return String(t.url || '').includes(FILTER) || String(t.title || '').includes(FILTER);
}

async function refreshTargets() {
  const list = await httpGetJSON('/json/list');
  targetList = Array.isArray(list) ? list.filter(exposed) : [];
  return targetList;
}

function targetInfo(t) {
  return {
    targetId: t.id,
    type: KNOWN_TYPES.has(t.type) ? t.type : 'page', // ← 核心：webview → page
    title: t.title || '',
    url: t.url || '',
    attached: false,
    canAccessOpener: false,
    browserContextId: t.browserContextId,
  };
}

// ------------------------------------------------------------------ 客户端会话

let nextSid = 0;

/**
 * 一个 VS Code（js-debug）连接 = 一个 client。
 * client 发来的消息分三类：
 *   1. 无 sessionId                → browser 级方法，自己实现
 *   2. sessionId === BROWSER       → 同上（js-debug 用 Target.attachToBrowserTarget 拿到的会话）
 *   3. 其它 sessionId              → 转发给对应 target 的真实 WS
 */
function createClientBridge(send) {
  const sessions = new Map(); // sid -> { ws, targetId, ready }
  let pollTimer = null;
  const seen = new Set();

  function sendRaw(text) {
    try { send(text); } catch (err) { debug('send failed', err && err.message); }
  }

  function reply(id, result, sessionId) {
    const msg = { id, result: result || {} };
    if (sessionId) msg.sessionId = sessionId;
    sendRaw(JSON.stringify(msg));
  }

  function replyError(id, message, sessionId) {
    const msg = { id, error: { code: -32000, message } };
    if (sessionId) msg.sessionId = sessionId;
    sendRaw(JSON.stringify(msg));
  }

  function emit(method, params, sessionId) {
    const msg = { method, params };
    if (sessionId) msg.sessionId = sessionId;
    sendRaw(JSON.stringify(msg));
  }

  function announce(sid) {
    for (const t of targetList) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      emit('Target.targetCreated', { targetInfo: targetInfo(t) }, sid);
      debug('created', t.type, '->', targetInfo(t).type, t.url.slice(0, 60));
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const before = new Map(targetList.map((t) => [t.id, t]));
        await refreshTargets();
        const now = new Map(targetList.map((t) => [t.id, t]));
        for (const [id, t] of now) {
          if (!before.has(id)) {
            seen.add(id);
            emit('Target.targetCreated', { targetInfo: targetInfo(t) }, BROWSER);
            log('目标出现:', t.type, '→', targetInfo(t).type, t.url);
          }
        }
        for (const id of before.keys()) {
          if (!now.has(id)) {
            seen.delete(id);
            emit('Target.targetDestroyed', { targetId: id }, BROWSER);
            log('目标消失:', id);
          }
        }
      } catch (err) { /* 编辑器可能已退出，轮询静默跳过 */ }
    }, 500);
    pollTimer.unref && pollTimer.unref();
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  async function attach(targetId, id, sessionId) {
    try { await refreshTargets(); } catch (err) { /* 用缓存 */ }
    const target = targetList.find((t) => t.id === targetId);
    if (!target || !target.webSocketDebuggerUrl) {
      replyError(id, 'No target with givded id found: ' + targetId, sessionId);
      return;
    }
    const sid = 'P' + (++nextSid).toString(16).padStart(4, '0') + crypto.randomBytes(3).toString('hex');
    const upstream = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    const entry = { ws: upstream, targetId, ready: false };
    sessions.set(sid, entry);

    upstream.on('open', () => {
      entry.ready = true;
      log('会话建立:', sid, '→', target.type, target.url.slice(0, 60));
      reply(id, { sessionId: sid }, sessionId);
    });

    upstream.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (err) { return; }
      // 拦掉会让 js-debug 混乱的子 target auto-attach
      if (msg.id && (msg.method === 'Target.setAutoAttach' || msg.method === 'Target.setDiscoverTargets')) {
        return;
      }
      msg.sessionId = sid;
      sendRaw(JSON.stringify(msg));
    });

    upstream.on('close', () => {
      sessions.delete(sid);
      log('会话断开:', sid);
      emit('Target.detachedFromTarget', { sessionId: sid, targetId }, BROWSER);
    });

    upstream.on('error', (err) => {
      log('上游错误:', err && err.message);
      if (!entry.ready) replyError(id, String(err && err.message), sessionId);
    });
  }

  function handleBrowser(msg) {
    const { id, method, params } = msg;
    const sid = msg.sessionId;
    const p = params || {};

    switch (method) {
      case 'Target.attachToBrowserTarget':
        reply(id, { sessionId: BROWSER }, sid);
        return;

      case 'Target.setDiscoverTargets':
        reply(id, {}, sid);
        announce(sid || BROWSER);
        startPolling();
        return;

      case 'Target.getTargets':
        refreshTargets()
          .catch(() => {})
          .then(() => reply(id, { targetInfos: targetList.map(targetInfo) }, sid));
        return;

      case 'Target.attachToTarget':
        attach(p.targetId, id, sid);
        return;

      case 'Target.detachFromTarget': {
        const entry = sessions.get(p.sessionId);
        if (entry) {
          sessions.delete(p.sessionId);
          try { entry.ws.close(); } catch (err) { }
        }
        reply(id, {}, sid);
        return;
      }

      case 'Target.setAutoAttach':
        reply(id, {}, sid);
        return;

      case 'Browser.getVersion':
        httpGetJSON('/json/version')
          .then((v) => reply(id, {
            protocolVersion: v['Protocol-Version'] || '1.3',
            product: v.Browser || 'Cocos Creator',
            revision: '',
            userAgent: v['User-Agent'] || '',
            jsVersion: v['V8-Version'] || '',
          }, sid))
          .catch(() => reply(id, { protocolVersion: '1.3', product: 'Cocos Creator' }, sid));
        return;

      default:
        // 其余浏览器级方法一律空回，避免 js-debug 卡在等待
        debug('browser no-op:', method);
        reply(id, {}, sid);
        return;
    }
  }

  function onClientMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (err) { return; }
    const { method, sessionId } = msg;

    // 会话级的 Target 控制类方法：自己回，不转发（转发会让 Chromium 尝试
    // 创建子 target 会话，js-debug 处理不了 Electron webview 的子 target）
    if (sessionId && sessionId !== BROWSER && (method === 'Target.setAutoAttach' || method === 'Target.setDiscoverTargets')) {
      sendRaw(JSON.stringify({ id: msg.id, sessionId, result: {} }));
      return;
    }

    if (!sessionId || sessionId === BROWSER) {
      if (!method) { // 客户端对自己会话的回包，忽略
        return;
      }
      handleBrowser(msg);
      return;
    }

    const entry = sessions.get(sessionId);
    if (!entry) {
      if (msg.id) sendRaw(JSON.stringify({ id: msg.id, sessionId, error: { code: -32001, message: 'Unknown session' } }));
      return;
    }
    if (!entry.ready) return; // 还没 open，丢弃（js-debug 会在 open 后重发 enable 类命令）
    try {
      // 目标是直连（非 flatten 会话），必须剥掉 sessionId
      const fwd = { ...msg };
      delete fwd.sessionId;
      entry.ws.send(JSON.stringify(fwd));
    } catch (err) { debug('forward failed', err && err.message); }
  }

  return {
    onClientMessage,
    dispose() {
      stopPolling();
      for (const [, entry] of sessions) { try { entry.ws.close(); } catch (err) { } }
      sessions.clear();
    },
  };
}

// ------------------------------------------------------------------ HTTP + WS

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const json = (obj) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  if (url.startsWith('/json/version')) {
    const v = await httpGetJSON('/json/version').catch(() => ({}));
    json({
      'Browser': v.Browser || 'Cocos Creator (bridge)',
      'Protocol-Version': v['Protocol-Version'] || '1.3',
      'User-Agent': v['User-Agent'] || '',
      'V8-Version': v['V8-Version'] || '',
      'WebKit-Version': v['WebKit-Version'] || '',
      'webSocketDebuggerUrl': 'ws://127.0.0.1:' + server.address().port + '/devtools/browser/bridge',
    });
    return;
  }

  if (url.startsWith('/json/list')) {
    const list = await refreshTargets().catch(() => []);
    json(list.map((t) => ({
      ...t,
      type: targetInfo(t).type,
      webSocketDebuggerUrl: 'ws://127.0.0.1:' + server.address().port + '/devtools/page/' + t.id,
    })));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('cdp-webview-bridge: use /json/version or /json/list\n');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  const url = req.url || '';
  log('客户端接入:', url);

  if (url.startsWith('/devtools/page/')) {
    // 直连某个 target（手工工具用），直接透传
    const targetId = url.slice('/devtools/page/'.length);
    refreshTargets().then((list) => {
      const t = list.find((x) => x.id === targetId);
      if (!t) { try { ws.close(); } catch (e) { } return; }
      const upstream = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false });
      ws.on('message', (d) => { if (upstream.readyState === 1) upstream.send(d.toString()); });
      upstream.on('message', (d) => { if (ws.readyState === 1) ws.send(d.toString()); });
      upstream.on('close', () => { try { ws.close(); } catch (e) { } });
      ws.on('close', () => { try { upstream.close(); } catch (e) { } });
    });
    return;
  }

  const send = (text) => { if (ws.readyState === 1) ws.send(text); };
  const bridge = createClientBridge(send);
  ws.on('message', (raw) => { try { bridge.onClientMessage(raw); } catch (err) { log('处理客户端消息异常:', err && err.stack || err); } });
  ws.on('close', () => { log('客户端断开'); bridge.dispose(); });
  ws.on('error', (err) => log('客户端错误:', err && err.message));
});

server.listen(PORT, '127.0.0.1', () => {
  log('代理已启动: 127.0.0.1:' + PORT + ' ← 编辑器 CDP 127.0.0.1:' + SRC_PORT + (FILTER ? '（过滤: ' + FILTER + '）' : ''));
  refreshTargets()
    .then((list) => log('当前可见 target:', list.map((t) => (t.type === 'page' ? '' : '[' + t.type + '→page] ') + t.url).join(' | ') || '(无)'))
    .catch((err) => log('读取编辑器 target 失败:', err.message, '（编辑器是否带 --remote-debugging-port 启动？）'));
});
