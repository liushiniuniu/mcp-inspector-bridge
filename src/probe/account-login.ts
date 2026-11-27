// @ts-nocheck
// 账号自动登录引擎（内嵌 mcp-inspector-bridge 用，页面侧）
//
// 由 Tools/AccountAutoLogin/accountAutoLogin.user.js 移植：保留全部引擎逻辑
// （DevLoginOptions 面板采样、账号本、自动登录、假支付开关、一键开新号），
// 去掉渲染层（DOM 面板 / toast / 页面缩放补偿）——界面放在 bridge 面板自己的 DOM 里，
// 通过 window.__mcpAccountLogin 收发指令、用 postMessage 经 preload 上报状态。
//
// 与源脚本的差异只有这几处：
// 1. toast()        → notify()：postMessage 给面板弹提示；
// 2. render()       → publish()：postMessage 整份状态给面板；
// 3. 模板号         → 面板下发（state.templateInput）；
// 4. 项目模块捕获   → 在本文件内挂钩 cc._RF.push（页面世界）。不要改回 preload：
//                     bridge 的 webview 里 preload 跑在隔离世界，页面看不到它挂的东西。
//
// 不要手改本文件的引擎部分；改源脚本后重新执行 tools/port-probe.js。

(function () {
  "use strict";

  // 重复注入保护：preload 的 iframe 扫描可能对同一文档注入多次
  // （这里用 window 而不是下面的 win，win 还没声明）
  if (window.__mcpAccountLoginInstalled) return;
  window.__mcpAccountLoginInstalled = true;

  //#region 常量

  const STORE_KEY = "devLoginAccounts";
  const STORE_BAK_KEY = "devLoginAccounts_bak";
  const STORE_VERSION = 2;

  const MAX_ACCOUNTS = 200;
  const POLL_INTERVAL = 300;
  const AUTO_CLICK_DELAY = 500;
  const MAX_AUTO_CLICKS = 3;
  /** 刷新倒计时（可取消） */
  const RELOAD_DELAY = 1000;
  /** 刷新后等待 DevLoginOptions 出现的超时 */
  const PANEL_WAIT_TIMEOUT = 20000;
  /** 自动点击后若在该时间内面板再次出现，判定为一次失败 */
  const FAIL_WINDOW = 15000;

  /** 「一键开新号」待完成任务的独立存储键（跨页面刷新保留） */
  const NEW_ACCOUNT_KEY = "devLoginNewAccount";
  /** 模板号默认值 */
  const NEW_ACCOUNT_TEMPLATE_DEFAULT = 7;
  /** GM 升级协议号，对应 RequestId.DEV_UP_LEVEL */
  const DEV_UP_LEVEL_REQUEST_ID = 14502;
  /** 新号进入主城时加载的预制节点名 */
  const FIRST_ANI_NODE_NAME = "FirstAniScene";
  /** FirstAniScene 检测间隔 */
  const FIRST_ANI_POLL_INTERVAL = 300;
  /** 检测到 FirstAniScene 后等待多久发 GM（ms） */
  const NEW_ACCOUNT_SCENE_DELAY = 1000;
  /** GM 请求成功后等待多久弹游戏提示（ms） */
  const NEW_ACCOUNT_SUCCESS_DELAY = 500;
  /** 弹完提示后等待多久刷新页面（ms） */
  const NEW_ACCOUNT_RELOAD_DELAY = 1000;
  /** GM 请求等待应答的超时（ms） */
  const NEW_ACCOUNT_GM_TIMEOUT = 10000;
  /** 整个新号创建流程的超时（刷新后开始计时，ms） */
  const NEW_ACCOUNT_TIMEOUT = 120000;
  /** 「?」图标展开的简要流程 */
  const NEW_ACCOUNT_TIP_TEXT =
    "① 在右侧输入框填模板号（默认 7）\n" +
    "② 点「开始」：以当前服创建新号（当前账号末位数字 +1）\n" +
    "③ 自动登录 → 进主城后 GM uplv 模板号 → 提示「新号创建成功」并刷新";

  const PANEL_WIDTH = 220;
  const PANEL_GAP = 8;
  const COLLAPSED_WIDTH = 36;
  /** 手动倍率备选（⤢ 循环）：1 表示只做自动补偿，不额外调整 */
  const OVERLAY_SCALE_STEPS = [1, 1.25, 1.5, 2, 3, 0.75, 0.6];
  /** 100% 缩放时的 devicePixelRatio 参考值（推算缩放倍数的兜底） */
  const OVERLAY_REF_DPR_KEY = "devLoginRefDpr";
  const OVERLAY_SCALE_MIN = 0.5;
  /** 预览面板里 1440x3176 的设备帧被缩到 0.2 左右，补偿倍数要能到 5~7 */
  const OVERLAY_SCALE_MAX = 8;

  const LOG_PREFIX = "[DevLogin助手]";

  //#endregion

  //#region 运行环境

  const win = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  /** 油猴沙盒下 cc 可能挂在 unsafeWindow 上 */
  function getCC() {
    const candidates = [win.cc, window.cc, win.legacyCC, win.CC];
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      if (c && c.director && typeof c.director.getScene === "function") return c;
    }
    return win.cc || window.cc || null;
  }

  function getCanvas() {
    const cc = getCC();
    if (cc && cc.game && cc.game.canvas) return cc.game.canvas;

    return document.getElementById("GameCanvas") || document.querySelector("#GameDiv canvas") || document.querySelector("canvas");
  }

  //#endregion

  //#region 项目模块捕获

  /**
   * DevConfigController 未声明 @ccclass，不在 cc.js 类注册表中。
   * 在 document-start 阶段挂钩 cc._RF.push，按脚本名捕获项目模块，
   * 之后即可从 module.exports 取到未注册的类（与 cocos-hot-reload 的做法一致）。
   */
  // preload 在页面脚本之前挂钩 window.cc，把按脚本名注册的项目模块塞进这个对象
  // （见 src/preload.ts 的「早期捕获」）。拿不到时退回本地空表。
  const capturedModules = win.__mcpAccountModules || Object.create(null);
  let rfHooked = false;

  function hookRF(cc) {
    if (rfHooked || !cc || !cc._RF || typeof cc._RF.push !== "function") return false;
    rfHooked = true;

    const originalPush = cc._RF.push;
    cc._RF.push = function (module, uuid, script) {
      try {
        if (script && module) capturedModules[script] = module;
      } catch (e) {
        /* 捕获失败不影响游戏 */
      }
      return originalPush.apply(this, arguments);
    };
    return true;
  }

  /** 尽早拿到 cc：优先挂钩 window.cc 的赋值，其次轮询 */
  function watchCC(onReady) {
    let ccRef = null;
    let done = false;

    const finish = (cc) => {
      if (done || !cc) return;
      if (hookRF(cc)) {
        done = true;
        onReady(cc);
      }
    };

    try {
      const desc = Object.getOwnPropertyDescriptor(win, "cc");
      if (desc && desc.configurable === false) {
        ccRef = win.cc;
      } else {
        Object.defineProperty(win, "cc", {
          configurable: true,
          enumerable: true,
          get() {
            return ccRef;
          },
          set(v) {
            ccRef = v;
            finish(v);
          },
        });
      }
    } catch (e) {
      warn("无法挂钩 window.cc，改为轮询", e);
    }

    if (ccRef) finish(ccRef);

    // 微任务在相邻 <script> 之间会执行，可在项目脚本执行前抢先挂钩
    let burst = 0;
    const burstStart = Date.now();
    const microProbe = () => {
      if (done) return;
      const cc = win.cc || window.cc;
      if (cc) finish(cc);
      burst++;
      if (!done && burst < 4000 && Date.now() - burstStart < 2000) Promise.resolve().then(microProbe);
    };
    Promise.resolve().then(microProbe);

    let waited = 0;
    const timer = setInterval(() => {
      waited += 50;
      const cc = win.cc || window.cc;
      if (cc) {
        finish(cc);
        if (done) {
          clearInterval(timer);
          return;
        }
      }
      if (waited >= 20000) clearInterval(timer);
    }, 50);
  }

  //#endregion

  //#region DevConfigController

  const devConfig = {
    cls: null,
    instance: null,
  };

  function resolveDevConfigClass() {
    if (devConfig.cls) return devConfig.cls;

    const mod = capturedModules["DevConfigController"];
    if (mod && mod.exports && mod.exports.DevConfigController) {
      devConfig.cls = mod.exports.DevConfigController;
      return devConfig.cls;
    }

    const cc = getCC();
    if (cc && cc.js && typeof cc.js.getClassByName === "function") {
      const cls = cc.js.getClassByName("DevConfigController");
      if (cls) {
        devConfig.cls = cls;
        return cls;
      }
    }
    return null;
  }

  /** 游戏尚未启动时不要提前构造控制器单例 */
  function isGameBooted() {
    const cc = getCC();
    if (!cc || !cc.director || typeof cc.director.getScene !== "function") return false;
    const scene = cc.director.getScene();
    return !!(scene && scene.children && scene.children.length);
  }

  function getDevConfig() {
    const cls = resolveDevConfigClass();
    if (!cls || typeof cls.Instance !== "function") return null;

    try {
      // Singleton.Instance() 幂等：已存在则直接返回
      devConfig.instance = cls.Instance();
    } catch (e) {
      warn("获取 DevConfigController 失败", e);
      devConfig.instance = null;
    }
    return devConfig.instance;
  }

  /** 读取游戏内实际值（引擎未就绪或取不到控制器时返回 null） */
  function readWXPay() {
    if (!isGameBooted()) return null;
    const ctrl = getDevConfig();
    if (!ctrl) return null;
    try {
      const v = ctrl.devServerWXPay;
      return typeof v === "boolean" ? v : !!v;
    } catch (e) {
      return null;
    }
  }

  function writeWXPay(value) {
    if (!isGameBooted()) return false;
    const ctrl = getDevConfig();
    if (!ctrl) return false;
    try {
      ctrl.devServerWXPay = !!value;
      return true;
    } catch (e) {
      warn("设置 devServerWXPay 失败", e);
      return false;
    }
  }

  //#endregion

  //#region 游戏接口（当前账号 / GM / 网络 / 提示）

  /** 取被 cc._RF 捕获的项目模块导出（模块按脚本文件名捕获） */
  function getModuleExport(scriptName, exportName) {
    const mod = capturedModules[scriptName];
    if (!mod || !mod.exports) return null;
    return mod.exports[exportName] || null;
  }

  /** 全局数据单例（GLOBAL.accountId 就是本次登录用的 Device ID） */
  function getGlobal() {
    return getModuleExport("GlobalData", "GLOBAL");
  }

  function getRequestId() {
    return getModuleExport("RequestId", "RequestId");
  }

  /** 网络管理器单例 */
  function getNet() {
    return getModuleExport("NetMgr", "NET");
  }

  function getUIManagerClass() {
    const cls = getModuleExport("UIManager", "default") || getModuleExport("UIManager", "UIManager");
    if (cls) return cls;

    const cc = getCC();
    if (cc && cc.js && typeof cc.js.getClassByName === "function") {
      return cc.js.getClassByName("UIManager");
    }
    return null;
  }

  function getUIManager() {
    const cls = getUIManagerClass();
    if (!cls || typeof cls.Instance !== "function") return null;
    try {
      return cls.Instance();
    } catch (e) {
      return null;
    }
  }

  /** 当前登录账号：GLOBAL.accountId（取不到返回空串） */
  function readGameAccountId() {
    const global = getGlobal();
    if (!global) return "";
    const id = global.accountId;
    if (typeof id === "string") return id.trim();
    return id === null || id === undefined ? "" : String(id);
  }

  /** 当前登录服 id：DATA.UserData.ServerId（取不到返回 0） */
  function readGameServerId() {
    const data = getModuleExport("DataCenter", "DATA");
    if (!data || !data.UserData) return 0;
    try {
      const id = Number(data.UserData.ServerId);
      return id >= 1 ? id : 0;
    } catch (e) {
      return 0;
    }
  }

  /** 游戏内飘字提示；取不到 UIManager 时退回脚本自己的 toast */
  function showGameTips(text) {
    const uiManager = getUIManager();
    if (uiManager && typeof uiManager.ShowTips === "function") {
      try {
        uiManager.ShowTips(text);
        return true;
      } catch (e) {
        warn("UIManager.ShowTips 调用失败", e);
      }
    }
    notify(text);
    return false;
  }

  /**
   * 直接发送 GM 升级命令 uplv <level>（等价 DevSwitchPanel 的 uplv 分支，
   * 不必打开 GM 面板）：NET.send(RequestId.DEV_UP_LEVEL, { id: level })。
   * 回调 (ok, detail)；超时或 status 非 0 视为失败。
   */
  function sendGmUpLevel(level, callback) {
    const net = getNet();
    const requestId = getRequestId();
    const requestCode = requestId && typeof requestId.DEV_UP_LEVEL === "number" ? requestId.DEV_UP_LEVEL : DEV_UP_LEVEL_REQUEST_ID;

    if (!net || typeof net.send !== "function") {
      callback(false, "未取到 NET（页面未暴露 window.cc？）");
      return;
    }

    let done = false;
    let timer = 0;
    const finish = (ok, detail) => {
      if (done) return;
      done = true;
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      callback(ok, detail);
    };

    timer = setTimeout(() => finish(false, "GM 请求无应答（" + NEW_ACCOUNT_GM_TIMEOUT / 1000 + "s）"), NEW_ACCOUNT_GM_TIMEOUT);

    try {
      net.send(requestCode, { id: level }, null, (pack) => {
        const status = pack ? pack.s : undefined;
        const ok = status === undefined || status === null || Number(status) === 0;
        finish(ok, ok ? "ok" : "服务器 status=" + status);
      });
    } catch (e) {
      finish(false, "GM 请求发送失败：" + (e && e.message ? e.message : e));
    }
  }

  //#endregion

  //#region 存储

  const storage = {
    get(key) {
      try {
        if (typeof GM_getValue === "function") return GM_getValue(key, null);
      } catch (e) {
        /* 回退到 localStorage */
      }
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        if (typeof GM_setValue === "function") {
          GM_setValue(key, value);
          return;
        }
      } catch (e) {
        /* 回退到 localStorage */
      }
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        warn("保存失败", e);
      }
    },
  };

  function emptyStore() {
    return {
      version: STORE_VERSION,
      activeKey: null,
      accounts: [],
      collapsed: false,
      devServerWXPay: false,
      /** 「一键开新号」模板号（uplv 参数） */
      newTemplate: NEW_ACCOUNT_TEMPLATE_DEFAULT,
      /** 界面缩放手动倍率：1=只做自动补偿 */
      overlayScale: 1,
    };
  }

  let corruptBackedUp = false;

  function makeKey(serverId, deviceId) {
    return serverId + "::" + deviceId;
  }

  function normalizeHost(host) {
    if (!host || typeof host !== "object" || typeof host.text !== "string" || !host.text) return null;
    const ref = { text: host.text };
    if (typeof host.ip === "string" && host.ip) ref.ip = host.ip;
    if (typeof host.list === "string" && host.list) ref.list = host.list;
    return ref;
  }

  function sortAccounts(list) {
    return list.sort((a, b) => {
      if (b.lastUseAt !== a.lastUseAt) return b.lastUseAt - a.lastUseAt;
      return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
    });
  }

  function normalizeStore(raw) {
    const store = emptyStore();
    if (!raw || typeof raw !== "object") return store;

    store.activeKey = typeof raw.activeKey === "string" && raw.activeKey ? raw.activeKey : null;
    store.collapsed = !!raw.collapsed;
    store.devServerWXPay = !!raw.devServerWXPay;
    store.overlayScale = sanitizeScale(raw.overlayScale);

    const template = Number(raw.newTemplate);
    store.newTemplate = isTemplateValue(template) ? template : NEW_ACCOUNT_TEMPLATE_DEFAULT;

    const list = Array.isArray(raw.accounts) ? raw.accounts : [];
    const map = new Map();

    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (!item || typeof item !== "object") continue;

      const deviceId = typeof item.deviceId === "string" ? item.deviceId : "";
      const serverId = Number(item.serverId);
      if (!deviceId || !(serverId >= 1)) continue;

      const rec = {
        key: makeKey(serverId, deviceId),
        deviceId: deviceId,
        serverId: serverId,
        host: normalizeHost(item.host),
        firstUseAt: Number(item.firstUseAt) || Date.now(),
        lastUseAt: Number(item.lastUseAt) || Date.now(),
        useCount: Number(item.useCount) || 0,
      };

      const exist = map.get(rec.key);
      if (!exist || rec.lastUseAt > exist.lastUseAt) map.set(rec.key, rec);
    }

    store.accounts = sortAccounts(Array.from(map.values())).slice(0, MAX_ACCOUNTS);

    if (store.activeKey && !store.accounts.some((a) => a.key === store.activeKey)) {
      store.activeKey = null;
    }
    return store;
  }

  function loadStore() {
    let raw = storage.get(STORE_KEY);
    if (raw === null || raw === undefined || raw === "") return emptyStore();

    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        if (!corruptBackedUp) {
          corruptBackedUp = true;
          warn("本地数据解析失败，已备份到 " + STORE_BAK_KEY);
          storage.set(STORE_BAK_KEY, storage.get(STORE_KEY));
        }
        return emptyStore();
      }
    }
    return normalizeStore(raw);
  }

  /** 超出上限时淘汰最久未使用的记录，正在自动登录的那条受保护 */
  function trimAccounts(store) {
    sortAccounts(store.accounts);
    while (store.accounts.length > MAX_ACCOUNTS) {
      let index = store.accounts.length - 1;
      if (store.activeKey && store.accounts[index].key === store.activeKey && index > 0) index -= 1;
      store.accounts.splice(index, 1);
    }
  }

  function saveStore(store) {
    const data = {
      version: STORE_VERSION,
      activeKey: store.activeKey,
      collapsed: store.collapsed,
      devServerWXPay: !!store.devServerWXPay,
      newTemplate: isTemplateValue(Number(store.newTemplate)) ? Number(store.newTemplate) : NEW_ACCOUNT_TEMPLATE_DEFAULT,
      overlayScale: sanitizeScale(store.overlayScale),
      accounts: sortAccounts(store.accounts.slice()).slice(0, MAX_ACCOUNTS),
    };
    storage.set(STORE_KEY, JSON.stringify(data));
    state.store = data;
  }

  /** 读-改-写，避免与其他标签页的写入互相覆盖 */
  function updateStore(mutator) {
    const store = loadStore();
    mutator(store);
    trimAccounts(store);
    saveStore(store);
    publish();
    return store;
  }

  /** 模板号：不小于 0 的整数（与 DevSwitchPanel 的 uplv 校验一致） */
  function isTemplateValue(n) {
    return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 999999999;
  }

  /** 手动倍率：1 = 只做自动补偿；允许 0.3~3 的任意值 */
  function sanitizeScale(value) {
    const n = Number(value);
    if (!(n > 0)) return 1;
    return Math.min(3, Math.max(0.3, n));
  }

  function loadNewAccount() {
    let raw = storage.get(NEW_ACCOUNT_KEY);
    if (raw === null || raw === undefined || raw === "") return null;

    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        warn("新号创建任务解析失败，已丢弃");
        return null;
      }
    }
    if (!raw || typeof raw !== "object") return null;

    const deviceId = typeof raw.deviceId === "string" ? raw.deviceId.trim() : "";
    const serverId = Number(raw.serverId);
    const template = Number(raw.template);
    if (!deviceId || !(serverId >= 1) || !isTemplateValue(template)) return null;

    return {
      deviceId: deviceId,
      serverId: serverId,
      host: normalizeHost(raw.host),
      template: template,
      stage: typeof raw.stage === "string" && raw.stage ? raw.stage : "login",
      createdAt: Number(raw.createdAt) || Date.now(),
    };
  }

  function saveNewAccount(pending) {
    storage.set(NEW_ACCOUNT_KEY, JSON.stringify(pending));
  }

  function clearNewAccount() {
    storage.set(NEW_ACCOUNT_KEY, "");
  }

  //#endregion

  //#region 状态

  const state = {
    store: emptyStore(),
    /** 已处理过的面板节点，用于识别「新面板出现」 */
    handledNode: null,
    panelNode: null,
    /** 用户点击列表项唤起面板时，等待填充的记录 */
    pendingRecord: null,
    autoTimer: 0,
    autoClicks: 0,
    panelWatchTimer: 0,
    canvasWatchTimer: 0,
    layoutTimer: 0,
    engineReady: false,
    /** 面板当前内容快照，用于面板消失时兜底记录 */
    lastPanelNode: null,
    lastSnapshot: null,
    recordedKey: "",
    recordedAt: 0,
    /** 自动点击后等待「是否失败」的计时器 */
    successTimer: 0,
    /** 刷新倒计时 */
    reloadTimer: 0,
    reloadTickTimer: 0,
    reloadStartedAt: 0 /** 待刷新记录，用于取消时回滚 */,
    reloadFallback: null,
    /** 本次页面加载是否已提示过「未检测到登录面板」 */
    panelWaitWarned: false,
    /** 刷新后等待面板出现的超时计时器 */
    panelWaitTimer: 0,
    /** devServerWXPay 同步定时器 */
    wxPayTimer: 0,
    /** 一键开新号：待完成任务（跨页面刷新保留） */
    newAccount: null,
    /** 新号流程开始时间（刷新后重新计时，用于超时） */
    newAccountStartedAt: 0,
    /** FirstAniScene 轮询定时器 */
    newAniTimer: 0,
    /** 新号流程里的单步延时定时器（1s / 0.5s / 1s） */
    newStepTimer: 0,
    /** 面板下发的模板号（null 表示还没下发，用已保存值） */
    templateInput: null,
    /** 浏览器页面缩放倍数（1 表示 100%） */
    pageZoom: 1,
    /** 面板当前实际缩放倍数（transform: scale） */
    viewScale: 1,
    /** 预览面板设备帧的补偿倍数（1 表示没被缩小） */
    deviceScale: 1,
  };

  //#endregion

  //#region Cocos 访问

  function getComponents(node) {
    if (!node || !node._components) return [];
    return node._components;
  }

  /** DevLoginOptionComponent 特征：两个输入框 + onConfirmClick */
  function isDevLoginComponent(comp) {
    if (!comp) return false;
    if (comp.editDeviceId || comp.editServerId) return true;
    return typeof comp.onConfirmClick === "function";
  }

  function getDevLoginComponent(node) {
    const comps = getComponents(node);
    for (let i = 0; i < comps.length; i++) {
      if (isDevLoginComponent(comps[i])) return comps[i];
    }
    return null;
  }

  /** DevLoginOptionItem 特征：data + onClick */
  function getHostItemComponent(node) {
    const comps = getComponents(node);
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      if (c && c.data && typeof c.onClick === "function") return c;
    }
    return null;
  }

  function walkScene(visitor) {
    const cc = getCC();
    if (!cc || !cc.director || !cc.director.getScene) return;
    const root = cc.director.getScene();
    if (!root) return;

    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || !node.isValid) continue;
      if (visitor(node) === true) return;
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
  }

  function findDevLoginNodes() {
    const found = [];
    walkScene((node) => {
      if (node.name === "DevLoginOptions" && node.activeInHierarchy && getDevLoginComponent(node)) {
        found.push(node);
      }
      return false;
    });
    return found;
  }

  function findNodeByName(root, name) {
    if (!root) return null;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || !node.isValid) continue;
      if (node.name === name) return node;
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
    return null;
  }

  function findButtonByHandler(root, handlerName) {
    const cc = getCC();
    if (!root || !cc) return null;

    let result = null;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || !node.isValid) continue;
      const btn = node.getComponent ? node.getComponent(cc.Button) : null;
      if (btn && btn.clickEvents) {
        for (let i = 0; i < btn.clickEvents.length; i++) {
          const ev = btn.clickEvents[i];
          if (ev && ev.handler === handlerName) {
            result = node;
            break;
          }
        }
      }
      if (result) break;
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
    return result;
  }

  /**
   * 触发节点上的按钮逻辑，等价于游戏内点击。
   * 优先按 clickEvents 的 handler 名直接调用对应组件方法（不依赖类名与组件 id），
   * 失败再退回 cc 的 emitEvents / 'click' 事件。
   */
  function invokeClick(node) {
    const cc = getCC();
    if (!node || !node.isValid || !cc) return false;

    const btn = node.getComponent ? node.getComponent(cc.Button) : null;
    const events = btn && btn.clickEvents ? btn.clickEvents : null;

    if (events && events.length) {
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const target = ev && ev.target;
        const handler = ev && ev.handler;
        if (!target || !target.isValid || !handler) continue;

        const comps = getComponents(target);
        for (let j = 0; j < comps.length; j++) {
          const comp = comps[j];
          if (comp && typeof comp[handler] === "function") {
            comp[handler]();
            return true;
          }
        }
      }

      try {
        cc.Component.EventHandler.emitEvents(events, null);
        return true;
      } catch (e) {
        warn("emitEvents 失败", e);
      }
    }

    if (btn) {
      node.emit("click", btn);
      return true;
    }
    return false;
  }

  function readEditBox(editBox) {
    if (!editBox || typeof editBox.string !== "string") return "";
    return editBox.string;
  }

  function writeEditBox(editBox, value) {
    if (!editBox) return;
    if (editBox.string !== value) editBox.string = value;

    // string setter 在值相同时会提前返回，按实际生效值（可能被 maxLength 截断）补一次显示同步
    const current = readEditBox(editBox);
    if (editBox._string !== current) editBox._string = current;
    if (editBox._textLabel && editBox._textLabel.string !== current) editBox._textLabel.string = current;
  }

  function toHostRef(host) {
    if (!host || !host.text) return null;
    const ref = { text: host.text };
    if (host.ip) ref.ip = host.ip;
    if (host.list) ref.list = host.list;
    return ref;
  }

  function readCurrentHost(comp) {
    if (comp._currentHost) return toHostRef(comp._currentHost);

    const group = comp.groupNodes && comp.groupNodes[0];
    if (!group) return null;

    const children = group.children || [];
    for (let i = 0; i < children.length; i++) {
      const item = getHostItemComponent(children[i]);
      if (item && item.btn && item.btn.interactable === false && item.data) {
        return toHostRef(item.data);
      }
    }
    return null;
  }

  function readSnapshot(comp) {
    try {
      return {
        deviceId: String(readEditBox(comp.editDeviceId)).trim(),
        serverId: parseInt(readEditBox(comp.editServerId), 10),
        host: readCurrentHost(comp),
      };
    } catch (e) {
      return { deviceId: "", serverId: NaN, host: null };
    }
  }

  function selectHost(comp, hostRef) {
    if (!hostRef) return false;
    const group = comp.groupNodes && comp.groupNodes[0];
    if (!group) return false;

    const items = [];
    const children = group.children || [];
    for (let i = 0; i < children.length; i++) {
      const item = getHostItemComponent(children[i]);
      if (item && item.data) items.push(item);
    }

    let target = null;
    for (let i = 0; i < items.length && !target; i++) {
      if (items[i].data.text === hostRef.text) target = items[i];
    }
    for (let i = 0; i < items.length && !target; i++) {
      if (hostRef.ip && items[i].data.ip === hostRef.ip) target = items[i];
    }
    for (let i = 0; i < items.length && !target; i++) {
      if (hostRef.list && items[i].data.list === hostRef.list) target = items[i];
    }
    if (!target) return false;

    return invokeClick(target.node);
  }

  /**
   * 填入顺序不可调换：选 HOST 会把 host.serverId 写回 edit - server，
   * 所以先选线路，再写 serverId，最后写 deviceId。
   */
  function fillPanel(comp, record) {
    const hostMatched = record.host ? selectHost(comp, record.host) : false;
    writeEditBox(comp.editServerId, String(record.serverId));
    writeEditBox(comp.editDeviceId, record.deviceId);
    return hostMatched;
  }

  function findLoginFlowComponent() {
    let result = null;
    walkScene((node) => {
      const comps = getComponents(node);
      for (let i = 0; i < comps.length; i++) {
        if (comps[i] && typeof comps[i].loadDevLoginPanel === "function") {
          result = comps[i];
          return true;
        }
      }
      return false;
    });
    return result;
  }

  //#endregion

  //#region 面板识别与采集

  function resolvePanel() {
    if (state.panelNode && !isNodeGoingAway(state.panelNode)) {
      const comp = getDevLoginComponent(state.panelNode);
      if (comp) return { node: state.panelNode, comp: comp };
    }

    const nodes = findDevLoginNodes();
    if (!nodes.length) {
      state.panelNode = null;
      return null;
    }

    const node = nodes[nodes.length - 1];
    state.panelNode = node;
    return { node: node, comp: getDevLoginComponent(node) };
  }

  function recordLogin(snapshot) {
    if (!snapshot) return;
    const deviceId = snapshot.deviceId;
    const serverId = snapshot.serverId;
    if (!deviceId || !(serverId >= 1)) return;

    const now = Date.now();
    updateStore((store) => {
      const key = makeKey(serverId, deviceId);
      const index = store.accounts.findIndex((a) => a.key === key);
      if (index >= 0) {
        const rec = store.accounts[index];
        rec.lastUseAt = now;
        rec.useCount = (rec.useCount || 0) + 1;
        if (snapshot.host) rec.host = snapshot.host;
        store.accounts.splice(index, 1);
        store.accounts.unshift(rec);
      } else {
        store.accounts.unshift({
          key: key,
          deviceId: deviceId,
          serverId: serverId,
          host: snapshot.host || null,
          firstUseAt: now,
          lastUseAt: now,
          useCount: 1,
        });
      }
    });
    state.recordedKey = makeKey(serverId, deviceId);
    state.recordedAt = Date.now();
    log("已记录账号", deviceId, serverId, "host=", snapshot.host && snapshot.host.text);
  }

  /**
   * Cocos 2.x 的 destroy() 是延迟销毁：调用后当帧 isValid 仍为 true。
   * 这里在临时节点上探测 ToDestroy 标志位，用来即时判断「节点是否已进入销毁流程」。
   */
  let toDestroyBit = 0;
  let toDestroyBitProbed = false;

  function getToDestroyBit() {
    if (toDestroyBitProbed) return toDestroyBit;
    toDestroyBitProbed = true;

    const cc = getCC();
    if (!cc || typeof cc.Node !== "function") return 0;

    const flags = cc.Object && cc.Object.Flags;
    if (flags && typeof flags.ToDestroy === "number") {
      toDestroyBit = flags.ToDestroy;
      return toDestroyBit;
    }

    try {
      const probe = new cc.Node("dlpa-probe");
      const before = probe._objFlags || 0;
      probe.destroy();
      const after = probe._objFlags || 0;
      toDestroyBit = after & ~before;
    } catch (e) {
      toDestroyBit = 0;
    }
    return toDestroyBit;
  }

  function isNodeGoingAway(node) {
    if (!node) return true;
    if (node.isValid === false) return true;

    const bit = getToDestroyBit();
    if (bit && typeof node._objFlags === "number" && node._objFlags & bit) return true;

    return !node._parent;
  }

  /** 包一层 onConfirmClick：游戏通过校验并销毁面板（即提交登录）时才记录 */
  function patchPanel(comp) {
    if (!comp || comp.__dlpaPatched) return comp;
    const original = comp.onConfirmClick;
    if (typeof original !== "function") return comp;

    comp.onConfirmClick = function () {
      const snapshot = readSnapshot(comp);
      const node = comp.node;
      let result;
      try {
        result = original.apply(this, arguments);
      } finally {
        if (isNodeGoingAway(node)) recordLogin(snapshot);
      }
      return result;
    };
    comp.__dlpaPatched = true;
    return comp;
  }

  /** 用户点「重置」时放弃本次自动登录 */
  function patchReset(comp) {
    if (!comp || comp.__dlpaResetPatched) return;
    const original = comp.onResetClick;
    if (typeof original !== "function") return;
    comp.onResetClick = function () {
      cancelAutoTimer();
      return original.apply(this, arguments);
    };
    comp.__dlpaResetPatched = true;
  }

  function cancelAutoTimer() {
    if (state.autoTimer) {
      clearTimeout(state.autoTimer);
      state.autoTimer = 0;
    }
  }

  function clickLogin(comp) {
    const node = comp.node;
    const btnNode = findNodeByName(node, "Btn_READALL") || findButtonByHandler(node, "onConfirmClick");
    if (btnNode && invokeClick(btnNode)) return true;
    if (typeof comp.onConfirmClick === "function") {
      comp.onConfirmClick();
      return true;
    }
    return false;
  }

  function armAutoClick(panel, record) {
    cancelAutoTimer();
    const node = panel.node;
    const comp = panel.comp;

    state.autoTimer = setTimeout(function fire() {
      state.autoTimer = 0;

      if (!node || !node.isValid || state.panelNode !== node) return;
      if (document.visibilityState !== "visible") {
        state.autoTimer = setTimeout(fire, 300);
        return;
      }

      // 中途被手动改动则尊重用户操作，取消自动点击
      const deviceId = String(readEditBox(comp.editDeviceId)).trim();
      const serverId = parseInt(readEditBox(comp.editServerId), 10);
      if (deviceId !== record.deviceId || serverId !== record.serverId) {
        notify("已取消自动登录：检测到手动修改");
        return;
      }

      const clicked = clickLogin(comp);
      if (!clicked) return;

      state.autoClicks++;
      log("自动登录第 " + state.autoClicks + " 次", record.deviceId, record.serverId);

      // 若 FAIL_WINDOW 内面板没有再出现，说明这次自动登录成功，连续失败计数归零
      if (state.successTimer) clearTimeout(state.successTimer);
      state.successTimer = setTimeout(() => {
        state.successTimer = 0;
        state.autoClicks = 0;
      }, FAIL_WINDOW);
    }, AUTO_CLICK_DELAY);
  }

  function onPanelAppeared(panel) {
    patchReset(panel.comp);

    // 面板又出现了，说明上一次自动点击没有成功，取消「成功」判定
    if (state.successTimer) {
      clearTimeout(state.successTimer);
      state.successTimer = 0;
    }

    const record = state.pendingRecord || getActiveRecord();
    state.pendingRecord = null;
    if (!record) return;

    if (state.autoClicks >= MAX_AUTO_CLICKS) {
      notify("自动登录已暂停，请手动登录");
      return;
    }

    const hostMatched = fillPanel(panel.comp, record);
    if (!record.host) {
      notify("该账号未记录线路，请手动选择后登录");
      return;
    }
    if (!hostMatched) {
      notify("未找到线路「" + record.host.text + "」，请手动选择后登录");
      return;
    }
    armAutoClick(panel, record);
  }

  function panelTick() {
    const panel = resolvePanel();

    if (!panel) {
      // 面板此前存在，现在消失了 → 大概率是点了「登录」并被销毁
      onPanelGone();
      return;
    }

    patchPanel(panel.comp);

    // 持续缓存面板当前内容，作为「面板消失即记录」的兜底数据
    if (panel.node !== state.lastPanelNode) {
      state.lastPanelNode = panel.node;
      state.lastSnapshot = null;
    }
    const snapshot = readSnapshot(panel.comp);
    if (snapshot.deviceId && snapshot.serverId >= 1) state.lastSnapshot = snapshot;

    if (state.handledNode !== panel.node) {
      state.handledNode = panel.node;
      log("检测到 DevLoginOptions，已挂钩采集", "patch=", !!panel.comp.__dlpaPatched);
      onPanelAppeared(panel);
    }
    publish();
  }

  /** 面板消失的兜底记录：即使 onConfirmClick 钩子没生效也能收集到账号 */
  function onPanelGone() {
    const snapshot = state.lastSnapshot;
    state.lastPanelNode = null;
    state.lastSnapshot = null;

    if (!snapshot) return;
    if (!snapshot.deviceId || !(snapshot.serverId >= 1)) return;

    const key = makeKey(snapshot.serverId, snapshot.deviceId);
    if (state.recordedKey === key && Date.now() - state.recordedAt < 1500) return;

    recordLogin(snapshot);
  }

  function startPanelWatch() {
    if (state.panelWatchTimer) return;
    state.panelWatchTimer = setInterval(panelTick, POLL_INTERVAL);
  }

  //#endregion

  //#region 业务操作

  function getActiveRecord() {
    const store = state.store;
    if (!store.activeKey) return null;
    return store.accounts.find((a) => a.key === store.activeKey) || null;
  }

  function touchAccount(key) {
    const now = Date.now();
    updateStore((store) => {
      const index = store.accounts.findIndex((a) => a.key === key);
      if (index < 0) return;
      const rec = store.accounts[index];
      rec.lastUseAt = now;
      rec.useCount = (rec.useCount || 0) + 1;
      store.accounts.splice(index, 1);
      store.accounts.unshift(rec);
    });
  }

  function removeAccount(key) {
    cancelAutoTimer();
    if (state.pendingRecord && state.pendingRecord.key === key) state.pendingRecord = null;
    updateStore((store) => {
      store.accounts = store.accounts.filter((a) => a.key !== key);
      if (store.activeKey === key) store.activeKey = null;
    });
    log("已删除账号", key);
  }

  function reopenPanel() {
    const loginFlow = findLoginFlowComponent();
    if (!loginFlow) return false;
    loginFlow.loadDevLoginPanel();
    return true;
  }

  function openPanelAndAutoLogin(record) {
    cancelAutoTimer();
    state.pendingRecord = record;
    state.autoClicks = 0;

    if (!reopenPanel()) {
      state.pendingRecord = null;
      notify("未找到登录流程节点，请刷新页面后重试");
      return;
    }

    const startedAt = Date.now();
    const check = setInterval(() => {
      if (state.panelNode && state.panelNode.isValid) {
        clearInterval(check);
        return;
      }
      if (Date.now() - startedAt > 2000) {
        clearInterval(check);
        state.pendingRecord = null;
        notify("无法打开开发登录面板，请刷新页面后重试");
      }
    }, 200);
  }

  function onItemClick(record) {
    cancelAutoTimer();
    const panel = resolvePanel();

    if (panel) {
      const hostMatched = fillPanel(panel.comp, record);
      if (!record.host) notify("该账号未记录线路，请手动选择");
      else if (!hostMatched) notify("未找到线路「" + record.host.text + "」，请手动选择");
      else notify("已填入账号，请确认后登录");
      touchAccount(record.key);
      return;
    }

    // 面板未打开：唤起 → 填入 → 0.5s 后自动登录（一次性，不改变开关状态）
    openPanelAndAutoLogin(record);
  }

  function onToggle(record, checked) {
    cancelAutoTimer();
    cancelReload();
    state.autoClicks = 0;

    const previousKey = state.store.activeKey;

    updateStore((store) => {
      if (checked) store.activeKey = record.key;
      else if (store.activeKey === record.key) store.activeKey = null;
    });

    if (!checked) return;

    // 打开开关：先持久化 activeKey，再提示 1 秒后刷新页面，由刷新后的脚本自动登录
    state.reloadFallback = { previousKey: previousKey };
    state.reloadStartedAt = Date.now();
    state.reloadTimer = setTimeout(() => {
      state.reloadTimer = 0;
      doReload(record);
    }, RELOAD_DELAY);

    showReloadPrompt(record);
  }

  /** 刷新页面；浏览器不允许时退回页内直接登录 */
  function doReload(record) {
    state.reloadFallback = null;
    showReloadPromptHide();

    try {
      location.reload();
    } catch (e) {
      warn("刷新页面失败，改为页内直接登录", e);
      notify("无法自动刷新页面，请手动刷新");
      fallbackFillAndLogin(record);
    }
  }

  /** 刷新被取消：回滚 activeKey */
  function cancelReload(rollback) {
    if (state.reloadTimer) {
      clearTimeout(state.reloadTimer);
      state.reloadTimer = 0;
    }
    const fallback = state.reloadFallback;
    state.reloadFallback = null;
    showReloadPromptHide();

    if (!rollback || !fallback) return;

    updateStore((store) => {
      store.activeKey = fallback.previousKey || null;
    });
  }

  /** 刷新不可用时的页内兜底：直接填入并登录 */
  function fallbackFillAndLogin(record) {
    const panel = resolvePanel();
    if (!panel) {
      openPanelAndAutoLogin(record);
      return;
    }
    patchPanel(panel.comp);
    const hostMatched = fillPanel(panel.comp, record);
    if (!record.host || !hostMatched) {
      notify("线路未匹配，请手动选择后登录");
      return;
    }
    state.handledNode = panel.node;
    armAutoClick(panel, record);
  }

  function onCollapseToggle() {
    updateStore((store) => {
      store.collapsed = !store.collapsed;
    });
  }

  /** 手动记录当前面板内容（自动收集失效时的兜底手段） */
  function onGrabClick() {
    const panel = resolvePanel();
    if (!panel) {
      notify("当前没有打开 DevLoginOptions 面板");
      return;
    }

    const snapshot = readSnapshot(panel.comp);
    if (!snapshot.deviceId) {
      notify("面板中「Device ID」为空，无法记录");
      return;
    }
    if (!(snapshot.serverId >= 1)) {
      notify("面板中「Server ID」需为大于 0 的整数");
      return;
    }

    recordLogin(snapshot);
    notify("已记录 " + snapshot.deviceId + " / 服务器 " + snapshot.serverId);
  }

  //#endregion

  //#region 礼包开关（devServerWXPay）

  function onWXPayToggle(checked) {
    if (writeWXPay(checked)) {
      updateStore((store) => {
        store.devServerWXPay = !!checked;
      });
      notify(checked ? "已开启测试服假支付" : "已关闭测试服假支付");
      syncWXPayUI();
      return;
    }

    // 取不到控制器时回滚 UI
    notify("设置失败：未取到 DevConfigController");
  }

  /**
   * 与游戏的 devServerWXPay 保持双向同步：
   * 控制器为准；但游戏复位为 false 而本地记录为 true 时（如 onDisconnect），重新置为 true。
   */
  function syncWXPay() {
    const actual = readWXPay();
    const wanted = !!state.store.devServerWXPay;

    if (actual === null) {
      syncWXPayUI();
      return;
    }

    if (actual !== wanted) {
      if (wanted) {
        writeWXPay(true);
      } else {
        updateStore((store) => {
          store.devServerWXPay = actual;
        });
      }
    }
    syncWXPayUI();
  }


  //#endregion

  //#region 一键开新号

  /** 输入框里的模板号；非法返回 null */
  /** 模板号由面板下发（state.templateInput），非法/缺失时回落到已保存值 */
  function readTemplateValue() {
    const raw = state.templateInput === null || state.templateInput === undefined ? storedTemplate() : Number(state.templateInput);
    return isTemplateValue(raw) ? raw : null;
  }

  /** 已保存的模板号（非法/缺失时回到默认 7） */
  function storedTemplate() {
    const value = Number(state.store.newTemplate);
    return isTemplateValue(value) ? value : NEW_ACCOUNT_TEMPLATE_DEFAULT;
  }

  function findRecordByDeviceId(deviceId) {
    if (!deviceId) return null;
    return state.store.accounts.find((a) => a.deviceId === deviceId) || null;
  }

  /**
   * 取「当前账号」作为新号的基准：
   * 已打开的登录面板 → 游戏内登录态（GLOBAL.accountId）→ 自动登录开关指向的账号 → 列表最近使用的一条。
   * 服务器 / 线路跟着当前账号走；当前账号没记录时，服务器优先用游戏内的当前服（DATA.UserData.ServerId）。
   */
  function resolveBaseAccount() {
    const panel = resolvePanel();
    if (panel) {
      const snapshot = readSnapshot(panel.comp);
      if (snapshot.deviceId) {
        const record = findRecordByDeviceId(snapshot.deviceId);
        return {
          deviceId: snapshot.deviceId,
          serverId: snapshot.serverId >= 1 ? snapshot.serverId : record ? record.serverId : readGameServerId(),
          host: snapshot.host || (record ? record.host : null),
          source: "panel",
        };
      }
    }

    const gameId = readGameAccountId();
    const gameServerId = readGameServerId();
    const active = getActiveRecord();
    const recent = state.store.accounts.length ? sortAccounts(state.store.accounts.slice())[0] : null;
    const matched = findRecordByDeviceId(gameId);
    const fallback = matched || active || recent || null;
    const deviceId = gameId || (fallback ? fallback.deviceId : "");

    let serverId = 0;
    if (matched && matched.serverId >= 1) serverId = matched.serverId;
    else if (gameId && gameServerId >= 1) serverId = gameServerId;
    else if (fallback && fallback.serverId >= 1) serverId = fallback.serverId;

    return {
      deviceId: deviceId,
      serverId: serverId,
      host: fallback ? fallback.host : null,
      source: deviceId ? (gameId ? "game" : "record") : "none",
    };
  }

  /** 数字段 +1，保留原有位数（acc007 → acc008，acc099 → acc100） */
  function incrementDigits(digits) {
    const chars = digits.split("");
    let i = chars.length - 1;
    while (i >= 0) {
      const next = chars[i].charCodeAt(0) - 48 + 1;
      if (next <= 9) {
        chars[i] = String(next);
        return chars.join("");
      }
      chars[i] = "0";
      i--;
    }
    chars.unshift("1");
    return chars.join("");
  }

  /** 末位数字自增；不以数字结尾则补 1；没有基准账号则用当前时间戳 */
  function bumpAccountId(current) {
    if (!current) return String(Date.now());
    const match = /^(.*?)(\d+)$/.exec(current);
    if (!match) return current + "1";
    return match[1] + incrementDigits(match[2]);
  }

  /** 跳过已记录过的账号，避免重开一个已有进度的号（那样不会加载 FirstAniScene） */
  function makeUniqueAccountId(deviceId, serverId) {
    let candidate = bumpAccountId(deviceId);
    for (let i = 0; i < 50; i++) {
      const key = makeKey(serverId, candidate);
      if (!state.store.accounts.some((a) => a.key === key)) return candidate;
      candidate = bumpAccountId(candidate);
    }
    return candidate;
  }

  function onCreateNewAccount() {
    if (state.newAccount) {
      notify("新号创建中，请等待流程结束");
      return;
    }

    const template = readTemplateValue();
    if (template === null) {
      notify("模板号需为不小于 0 的整数");
      return;
    }

    const base = resolveBaseAccount();
    const serverId = base.serverId >= 1 ? base.serverId : 0;
    if (!(serverId >= 1)) {
      notify("未取到服务器信息，请先打开登录面板登录一次");
      return;
    }

    const deviceId = base.deviceId ? makeUniqueAccountId(base.deviceId, serverId) : String(Date.now());
    const host = normalizeHost(base.host);
    const key = makeKey(serverId, deviceId);
    const previousKey = state.store.activeKey;
    const now = Date.now();

    cancelAutoTimer();
    cancelReload(false);

    // 先把新号写进列表并设为默认选择（activeKey），刷新后由自动登录流程填入并登录
    updateStore((store) => {
      store.newTemplate = template;
      store.accounts = store.accounts.filter((a) => a.key !== key);
      store.accounts.unshift({
        key: key,
        deviceId: deviceId,
        serverId: serverId,
        host: host,
        firstUseAt: now,
        lastUseAt: now,
        useCount: 1,
      });
      store.activeKey = key;
    });

    const pending = {
      deviceId: deviceId,
      serverId: serverId,
      host: host,
      template: template,
      stage: "login",
      createdAt: now,
    };

    state.newAccount = pending;
    state.newAccountStartedAt = now;
    saveNewAccount(pending);
    syncNewAccountUI();

    log(
      "一键开新号",
      "基准账号=" + (base.deviceId || "(无)") + "(" + base.source + ")",
      "新号=" + deviceId,
      "服务器=" + serverId,
      "线路=" + (host ? host.text : "未记录"),
      "模板=" + template
    );
    if (!host) warn("新号未记录线路，刷新后需要手动选择线路再登录");

    try {
      location.reload();
    } catch (e) {
      warn("刷新页面失败，回滚本次开新号", e);
      updateStore((store) => {
        store.accounts = store.accounts.filter((a) => a.key !== key);
        store.activeKey = previousKey || null;
      });
      state.newAccount = null;
      clearNewAccount();
      syncNewAccountUI();
      notify("无法自动刷新页面，请手动刷新后重试");
    }
  }

  /** 刷新后恢复未完成的新号创建流程 */
  function resumeNewAccount() {
    if (state.newAccount) return;

    const pending = loadNewAccount();
    if (!pending) {
      syncNewAccountUI();
      return;
    }

    state.newAccount = pending;
    state.newAccountStartedAt = Date.now();
    syncNewAccountUI();
    startFirstAniWatch();
    log("恢复一键开新号流程", pending.deviceId, "服务器=" + pending.serverId, "模板=" + pending.template);
  }

  function hasAncestorNamed(node, name) {
    let parent = node.parent || node._parent;
    while (parent) {
      if (parent.name === name) return true;
      parent = parent.parent || parent._parent;
    }
    return false;
  }

  /** 新号进入主城后实例化到 Home/Canvas/HomeMap/decorationDownLayer 下 */
  function findFirstAniSceneNode() {
    let found = null;
    walkScene((node) => {
      if (node.name !== FIRST_ANI_NODE_NAME || !node.activeInHierarchy) return false;
      if (!hasAncestorNamed(node, "decorationDownLayer")) return false;
      found = node;
      return true;
    });
    return found;
  }

  function startFirstAniWatch() {
    if (!state.newAccount || state.newAniTimer) return;

    state.newAniTimer = setInterval(() => {
      if (!state.newAccount) {
        stopFirstAniWatch();
        return;
      }

      if (findFirstAniSceneNode()) {
        stopFirstAniWatch();
        onFirstAniSceneShown();
        return;
      }

      if (Date.now() - state.newAccountStartedAt > NEW_ACCOUNT_TIMEOUT) {
        abortNewAccount("新号创建超时：未检测到 FirstAniScene，请确认是否登录成功");
      }
    }, FIRST_ANI_POLL_INTERVAL);
  }

  function stopFirstAniWatch() {
    if (state.newAniTimer) {
      clearInterval(state.newAniTimer);
      state.newAniTimer = 0;
    }
  }

  function clearNewStepTimer() {
    if (state.newStepTimer) {
      clearTimeout(state.newStepTimer);
      state.newStepTimer = 0;
    }
  }

  /** FirstAniScene 出现 → 等 1s → GM uplv 模板号 → 0.5s → 提示 → 1s → 刷新 */
  function onFirstAniSceneShown() {
    const pending = state.newAccount;
    if (!pending) return;

    // 流程可能被中止后又重新开始，所有异步回调都要确认还是同一个任务
    const stillMine = () => state.newAccount === pending;

    log("检测到 FirstAniScene，" + NEW_ACCOUNT_SCENE_DELAY / 1000 + "s 后发送 GM uplv " + pending.template);

    state.newStepTimer = setTimeout(() => {
      state.newStepTimer = 0;
      if (!stillMine()) return;

      sendGmUpLevel(pending.template, (ok, detail) => {
        if (!stillMine()) return;

        if (!ok) {
          abortNewAccount("新号创建失败：GM uplv " + pending.template + " 未成功（" + detail + "）");
          return;
        }

        log("GM uplv 成功，0.5s 后提示新号创建成功");
        state.newStepTimer = setTimeout(() => {
          state.newStepTimer = 0;
          if (!stillMine()) return;

          showGameTips("新号创建成功");
          state.newStepTimer = setTimeout(() => {
            state.newStepTimer = 0;
            if (!stillMine()) return;
            finishNewAccount();
          }, NEW_ACCOUNT_RELOAD_DELAY);
        }, NEW_ACCOUNT_SUCCESS_DELAY);
      });
    }, NEW_ACCOUNT_SCENE_DELAY);
  }

  function finishNewAccount() {
    log("新号创建流程结束，刷新页面");
    stopFirstAniWatch();
    clearNewStepTimer();
    state.newAccount = null;
    clearNewAccount();
    syncNewAccountUI();

    try {
      location.reload();
    } catch (e) {
      warn("刷新页面失败", e);
      notify("新号创建完成，请手动刷新页面");
    }
  }

  function abortNewAccount(reason) {
    warn("新号创建中止：" + reason);
    stopFirstAniWatch();
    clearNewStepTimer();
    state.newAccount = null;
    clearNewAccount();
    syncNewAccountUI();
    notify(reason);
  }


  //#endregion

  //#region 与面板通信 / 对外 API

  /** 面板 → 页面：executeJavaScript 调 window.__mcpAccountLogin.*  */

  /**
   * 项目模块捕获：必须挂钩 cc._RF.push 并按脚本名记下模块。
   * DevConfigController 没写 @ccclass，不在类注册表里，只有这条路能拿到。
   *
   * 注意：不要靠 preload 挂钩——bridge 的 webview 里 preload 跑在隔离世界，
   * 它在自己的 window 上挂的 cc 访问器页面看不到（这也是探针要用 <script> 注入的原因）。
   * 探针在 DOMContentLoaded 注入，而预览的项目脚本是 boot.js 在 window.onload 里才加载的，
   * 比这里晚，所以在页面世界里挂钩足够早。
   */
  let moduleCaptureTimer = 0;
  let moduleCaptureWarned = false;

  function hookModuleCapture(cc) {
    if (!cc || !cc._RF || typeof cc._RF.push !== "function") return false;
    if (cc._RF.mcpAccountHooked) return true;

    const push = cc._RF.push;
    cc._RF.push = function (module, uuid, script) {
      try {
        if (script && module) capturedModules[script] = module;
      } catch (e) {
        /* 捕获失败不影响游戏 */
      }
      return push.apply(this, arguments);
    };
    cc._RF.mcpAccountHooked = true;
    log("已挂钩 cc._RF，可捕获项目模块");
    return true;
  }

  /** 拿到 cc 就挂钩；拿不到时短轮询（覆盖个别模板先解析后加载的时序） */
  function ensureModuleCapture() {
    if (hookModuleCapture(getCC())) return true;
    if (moduleCaptureTimer) return false;

    let tries = 0;
    moduleCaptureTimer = setInterval(() => {
      tries++;
      if (hookModuleCapture(getCC()) || tries > 120) {
        clearInterval(moduleCaptureTimer);
        moduleCaptureTimer = 0;
        if (!moduleCaptureWarned && tries > 120) {
          moduleCaptureWarned = true;
          warn("30s 内没挂到 cc._RF：假支付 / 一键开新号不可用");
        }
        publish();
      }
    }, 250);
    return false;
  }

  function postToHost(channel, payload) {
    try {
      window.postMessage({ __mcp_ipc_proxy: true, channel: channel, args: [payload] }, "*");
    } catch (e) {
      /* preload 缺失时静默（例如被当作普通脚本注入到别的页面） */
    }
  }

  /** 面板弹提示 */
  function notify(message) {
    log("提示:", message);
    postToHost("account-login:toast", { message: String(message) });
  }

  /** 上报一份面板能直接渲染的状态 */
  function snapshotForPanel() {
    ensureModuleCapture();

    let current = null;
    try {
      const panel = resolvePanel();
      if (panel) current = readSnapshot(panel.comp);
    } catch (e) {
      current = null;
    }

    let wxPay = null;
    try {
      wxPay = readWXPay();
    } catch (e) {
      wxPay = null;
    }

    return {
      ready: true,
      version: STORE_VERSION,
      activeKey: state.store.activeKey,
      accounts: sortAccounts(state.store.accounts.slice()).map((a) => ({
        key: a.key,
        deviceId: a.deviceId,
        serverId: a.serverId,
        host: a.host ? a.host.text : "",
        firstUseAt: a.firstUseAt,
        lastUseAt: a.lastUseAt,
        useCount: a.useCount || 0,
      })),
      devServerWXPay: !!state.store.devServerWXPay,
      wxPayAvailable: wxPay !== null,
      newTemplate: storedTemplate(),
      newAccount: state.newAccount
        ? { deviceId: state.newAccount.deviceId, stage: state.newAccount.stage }
        : null,
      engineReady: !!getCC(),
      hasCanvas: !!getCanvas(),
      panelOpen: !!(state.panelNode && state.panelNode.isValid),
      current: current
        ? { deviceId: current.deviceId, serverId: current.serverId, host: current.host ? current.host.text : "" }
        : null,
      modulesCaptured: Object.keys(capturedModules).length,
      modulesHooked: !!getCC() && !!getCC()._RF && !!getCC()._RF.mcpAccountHooked,
    };
  }

  function publish() {
    postToHost("account-login:state", snapshotForPanel());
  }

  // 刷新前提示条改由面板显示（1 秒后真的刷新）
  function showReloadPrompt(record) {
    notify("即将刷新页面并自动登录 " + record.deviceId + " / 服务器 " + record.serverId + "（1s）");
  }

  function showReloadPromptHide() {
    /* 面板侧的提示条自己会消失 */
  }

  /** 切换假支付后由面板刷新状态 */
  function syncWXPayUI() {
    publish();
  }

  /** 「一键开新号」区块的可用状态同样交给面板渲染，这里推一份最新的 */
  function syncNewAccountUI() {
    publish();
  }

  function findRecord(key) {
    return state.store.accounts.find((a) => a.key === key) || null;
  }

  function copyTemplate(name) {
    return (capturedModules[name] && capturedModules[name].exports) || null;
  }

  window.__mcpAccountLogin = {
    // 面板轮询这一份
    state: () => JSON.stringify(snapshotForPanel()),
    publish: () => {
      publish();
      return true;
    },

    // 列表操作
    use: (key) => {
      const record = findRecord(key);
      if (!record) return false;
      onItemClick(record);
      return true;
    },
    toggle: (key, on) => {
      const record = findRecord(key);
      if (!record) return false;
      onToggle(record, !!on);
      return true;
    },
    remove: (key) => {
      removeAccount(key);
      return true;
    },
    grab: () => {
      onGrabClick();
      return true;
    },

    // 假支付
    setWXPay: (on) => {
      onWXPayToggle(!!on);
      return true;
    },

    // 一键开新号
    setTemplate: (value) => {
      const template = Number(value);
      if (!isTemplateValue(template)) return false;
      state.templateInput = template;
      updateStore((store) => {
        store.newTemplate = template;
      });
      return true;
    },
    startNewAccount: () => {
      onCreateNewAccount();
      return true;
    },
    cancelNewAccount: () => {
      if (!state.newAccount) return false;
      abortNewAccount("已取消新号创建");
      return true;
    },

    // 刷新倒计时取消
    cancelReload: () => {
      cancelReload(true);
      return true;
    },

    // 排查用
    clear: () => {
      updateStore((store) => {
        store.accounts = [];
        store.activeKey = null;
      });
      return true;
    },
    debug: () => JSON.stringify({
      capturedModules: Object.keys(capturedModules),
      hasExports: {
        DevConfig: !!copyTemplate("DevConfigController"),
        GlobalData: !!copyTemplate("GlobalData"),
        NetMgr: !!copyTemplate("NetMgr"),
        RequestId: !!copyTemplate("RequestId"),
        DataCenter: !!copyTemplate("DataCenter"),
        UIManager: !!copyTemplate("UIManager"),
      },
      engineReady: !!getCC(),
      panelNode: !!state.panelNode,
      autoClicks: state.autoClicks,
      newAccount: state.newAccount || null,
    }),
  };

  //#endregion

  //#region 启动

  function reloadFromDisk() {
    state.store = loadStore();
    publish();
  }

  /** 等引擎对象就绪后再启动面板轮询（内嵌模式没有画布要求） */
  function watchEngine(waited) {
    if (state.engineReady) return;
    if (getCC()) {
      state.engineReady = true;
      startPanelWatch();
      log("引擎就绪，开始监听 DevLoginOptions");
      publish();
      return;
    }
    if (waited === 15000) {
      warn("仍未检测到 Cocos 引擎对象 cc：面板已显示，但采集/自动填入需页面暴露 window.cc");
    }
    setTimeout(() => watchEngine(waited + POLL_INTERVAL), waited >= 15000 ? 2000 : POLL_INTERVAL);
  }

  function start() {
    log("账号助手已加载（mcp-inspector-bridge 内嵌）", location.href);

    try {
      state.store = loadStore();
    } catch (e) {
      warn("读取本地数据失败，使用空数据", e);
    }

    ensureModuleCapture();
    watchEngine(0);

    // 假支付开关：启动时恢复，之后每秒与游戏实际值对齐
    syncWXPay();
    if (!state.wxPayTimer) state.wxPayTimer = setInterval(syncWXPay, 1000);

    // 上一次刷新前点过「开始」：继续新号创建流程
    if (!state.newAccount) resumeNewAccount();

    // 刷新/重登后若已开启自动登录，等待面板出现，超时只提示、不主动打开
    if (state.store.activeKey && !state.panelWaitTimer) {
      state.panelWaitTimer = setTimeout(() => {
        state.panelWaitTimer = 0;
        if (state.handledNode || state.panelWaitWarned) return;
        const record = getActiveRecord();
        if (!record) return;
        state.panelWaitWarned = true;
        warn("等待面板超时，未检测到 DevLoginOptions");
        notify("未检测到登录面板，请手动打开登录面板");
      }, PANEL_WAIT_TIMEOUT);
    }

    publish();
  }

  start();

  //#endregion
})();
