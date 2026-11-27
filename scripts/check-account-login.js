'use strict';

// 账号自动登录（内嵌版）自检：不依赖 Creator / 浏览器，直接跑两半代码。
//   node scripts/check-account-login.js
//
// 1. 页面侧引擎 src/probe/account-login.ts：在假页面里启动，确认暴露 window.__mcpAccountLogin、
//    能产出面板要的状态、无引擎时不抛异常；
// 2. 面板侧 composable dist/panel/composables/useAccountLogin.js：用假 globalState 调一遍，
//    确认 computed / 动作接线正常（需要先 npm run build）。

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    console.log('  ✓ ' + name);
  } else {
    failures.push(name + (detail ? '（' + detail + '）' : ''));
    console.log('  ✗ ' + name + (detail ? '（' + detail + '）' : ''));
  }
}

// ===== 1. 页面侧引擎 =====
function checkProbeEngine() {
  console.log('[1] 页面侧引擎 src/probe/account-login.ts');
  const source = fs.readFileSync(path.join(ROOT, 'src/probe/account-login.ts'), 'utf8');

  const store = new Map();
  const posted = [];
  const timers = [];
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn) => timers.push(fn),
    clearTimeout() {},
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval() {},
    location: { href: 'http://localhost:7456/' },
    navigator: { userAgent: 'check' },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: (key) => store.delete(key)
    },
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; },
      createElement() { return { style: {}, appendChild() {} }; },
      body: { appendChild() {} },
      documentElement: { appendChild() {} }
    },
    postMessage: (payload) => posted.push(payload),
    Promise,
    Date, Math, JSON, Number, String, Object, Array, Boolean, Map, Set, Error, TypeError, RegExp,
    parseInt, parseFloat, isFinite, isNaN, encodeURIComponent, decodeURIComponent
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  // preload 早期捕获的模块表
  sandbox.__mcpAccountModules = {};

  vm.createContext(sandbox);
  try {
    vm.runInContext(source, sandbox, { filename: 'account-login.ts' });
  } catch (error) {
    check('引擎能启动', false, error.message);
    return;
  }
  check('引擎能启动（无 cc 也不抛）', true);

  const api = sandbox.window.__mcpAccountLogin;
  check('暴露 window.__mcpAccountLogin', !!api);
  if (!api) return;

  const required = ['state', 'publish', 'use', 'toggle', 'remove', 'grab', 'setWXPay',
    'setTemplate', 'startNewAccount', 'cancelNewAccount', 'cancelReload', 'clear', 'debug'];
  const missing = required.filter((name) => typeof api[name] !== 'function');
  check('API 方法齐全', missing.length === 0, missing.join(', '));

  let state = null;
  try { state = JSON.parse(api.state()); } catch (error) { state = null; }
  check('state() 返回可解析 JSON', !!state);
  if (state) {
    check('state 带 accounts 数组', Array.isArray(state.accounts));
    check('无引擎时 engineReady=false', state.engineReady === false);
    check('带 newTemplate 默认 7', state.newTemplate === 7);
    check('带 modulesCaptured 计数', typeof state.modulesCaptured === 'number');
  }

  // 没有面板时 grab 只应该提示，不应该抛
  const toastCount = () => posted.filter((item) => item && item.channel === 'account-login:toast').length;
  const toastsBefore = toastCount();
  let grabThrew = false;
  try { api.grab(); } catch (error) { grabThrew = true; }
  check('无面板时 grab 不抛异常', !grabThrew);
  check('grab 会通过 postMessage 上报提示', toastCount() === toastsBefore + 1);
  check('提示走的是账户助手的通道', posted.some((item) => item && item.channel === 'account-login:toast'));

  // 存一条账号，确认能读回来（面板列表就是它）
  try { api.clear(); } catch (error) { /* 忽略 */ }
  state = JSON.parse(api.state());
  check('clear 后账号列表为空', state.accounts.length === 0);

  // 模块捕获：模拟引擎就绪后挂钩 cc._RF.push，再推一个 DevConfigController 模块
  const pushedScripts = [];
  const fakeCC = {
    director: { getScene: () => null },
    game: {},
    js: {},
    _RF: {
      push(module, uuid, script) { pushedScripts.push(script); }
    }
  };
  sandbox.cc = fakeCC;
  let capturedState = null;
  try { capturedState = JSON.parse(api.state()); } catch (error) { capturedState = null; }
  check('有 cc 时自动挂钩 cc._RF', !!capturedState && capturedState.modulesHooked === true);

  // 引擎在 window.onload 里推模块，此时挂钩已经就位
  try {
    fakeCC._RF.push({ exports: { DevConfigController: function DevConfigController() {} } }, 'uuid-dc', 'DevConfigController');
    fakeCC._RF.push({ exports: { GLOBAL: { accountId: 'acc-1' } } }, 'uuid-g', 'GlobalData');
  } catch (error) { /* 忽略 */ }
  const afterPush = JSON.parse(api.state());
  check('抓到 DevConfigController / GlobalData', afterPush.modulesCaptured === 2, '实际 ' + afterPush.modulesCaptured);
  check('原来的 push 仍被调用', pushedScripts.length === 2);

  let debugInfo = null;
  try { debugInfo = JSON.parse(api.debug()); } catch (error) { debugInfo = null; }
  check('debug() 能报告模块导出', !!debugInfo && debugInfo.hasExports && debugInfo.hasExports.DevConfig === true);

  // 重复注入保护
  let ranTwice = false;
  try { vm.runInContext(source, sandbox, { filename: 'account-login.ts' }); }
  catch (error) { ranTwice = true; }
  check('重复注入被守卫拦住（不报错、不叠加）', !ranTwice);
}

// ===== 2. 面板侧 composable =====
function checkPanelComposable() {
  console.log('[2] 面板侧 composable dist/panel/composables/useAccountLogin.js');
  const file = path.join(ROOT, 'dist/panel/composables/useAccountLogin.js');
  if (!fs.existsSync(file)) {
    check('dist 已构建（先 npm run build）', false, '缺少 ' + file);
    return;
  }

  let module = null;
  try { module = require(file); } catch (error) {
    check('composable 能加载', false, error.message);
    return;
  }
  check('composable 能加载', true);
  check('导出 useAccountLogin', typeof module.useAccountLogin === 'function');
  if (typeof module.useAccountLogin !== 'function') return;

  const now = Date.now();
  const globalState = {
    accountLogin: {
      open: false,
      ready: true,
      data: {
        accounts: [
          { key: '1023::abcdefghijklmnop1234567890', deviceId: 'abcdefghijklmnop1234567890', serverId: 1023, host: 'host-1', lastUseAt: now, useCount: 3 }
        ],
        activeKey: '1023::abcdefghijklmnop1234567890',
        devServerWXPay: false,
        wxPayAvailable: true,
        newTemplate: 7,
        newAccount: null,
        engineReady: true,
        hasCanvas: true,
        panelOpen: false,
        current: null,
        modulesCaptured: 6
      },
      lastToast: null
    }
  };
  const gameView = { value: null };

  let api = null;
  try { api = module.useAccountLogin(globalState, gameView); } catch (error) {
    check('useAccountLogin 能初始化', false, error.message);
    return;
  }
  check('useAccountLogin 能初始化', true);
  check('账号列表可读', api.accountAccounts.value.length === 1);
  check('activeKey 可读', globalState.accountLogin.data.activeKey === api.accountActiveKey.value);
  check('状态灯为绿', api.accountStatusColor.value === '#22c55e');
  check('状态提示可生成', typeof api.accountStatusTip.value === 'string' && api.accountStatusTip.value.length > 0);
  check('deviceId 缩略', api.accountShort('abcdefghijklmnop1234567890') === 'abcdefgh…34567890');
  check('短 deviceId 不缩略', api.accountShort('p4test') === 'p4test');
  check('时间可格式化', /^\d{2}:\d{2}$/.test(api.accountTime(now)) || /^\d{2}-\d{2} \d{2}:\d{2}$/.test(api.accountTime(now)));
  check('没有 webview 时也不会抛', (function () {
    try { api.accountStartPolling(); api.accountUse('x'); api.accountTogglePanel(); return true; } catch (error) { return false; }
  })());
  check('点开面板会翻转 open', globalState.accountLogin.open === true);
  check('收不到 webview 时 ready 置 false', globalState.accountLogin.ready === false);
  api.accountStopPolling();
}

try {
  checkProbeEngine();
  checkPanelComposable();
} catch (error) {
  failures.push('自检脚本异常: ' + error.message);
  console.error(error);
}

if (failures.length) {
  console.error('\n自检失败：\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('\n自检全部通过。');
