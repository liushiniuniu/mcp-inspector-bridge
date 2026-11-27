'use strict';

// 「在资源管理器中定位并打开预制体」自检：用假的 Editor.Ipc 跑一遍通道表。
//   node scripts/check-locate-open.js
//
// 期望：
//   1. 预制体：先 assets:hint 定位，再 query-asset-info 确认类型，最后走 open-asset 打开；
//   2. open-asset 无回执时降级到 scene:enter-prefab-edit-mode；
//   3. 非预制体（组件脚本等）只定位、不打开。

const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const failures = [];

// composable 初始化时会碰 window（面板环境一定存在），这里给个最小替身
const fakeDocument = {
  addEventListener() {},
  removeEventListener() {},
  createElement() { return { style: {}, appendChild() {}, addEventListener() {} }; },
  body: { appendChild() {} },
  documentElement: { appendChild() {} }
};
global.window = {
  addEventListener() {},
  removeEventListener() {},
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  innerWidth: 1500,
  innerHeight: 900,
  document: fakeDocument
};
global.document = fakeDocument;

function check(name, condition, detail) {
  if (condition) console.log('  ✓ ' + name);
  else {
    failures.push(name);
    console.log('  ✗ ' + name + (detail ? '（' + detail + '）' : ''));
  }
}

const UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** 造一个假的 Editor；openAck 控制 open-asset 通道是否回执 */
function makeEditor(options) {
  const settings = options || {};
  const calls = [];
  const respond = (name, args, ack) => {
    const list = args.slice();
    const cb = typeof list[list.length - 1] === 'function' ? list.pop() : null;
    calls.push({ api: name, args: list });
    if (!cb) return;
    if (ack && ack.skip) return;            // 模拟「通道没注册」：回调永不触发
    setTimeout(() => cb(ack && ack.error ? ack.error : null, ack && ack.result !== undefined ? ack.result : {}), 0);
  };
  const Ipc = {
    sendToAll(message, ...rest) { calls.push({ api: 'sendToAll', args: [message, ...rest.filter((x) => typeof x !== 'function')] }); },
    sendToMain(...args) {
      // 2.4 写法：('pkg', 'msg', ...args, cb) 或 ('msg', ...args, cb)
      const list = args.slice();
      const cb = typeof list[list.length - 1] === 'function' ? list.pop() : null;
      calls.push({ api: 'sendToMain', args: list });
      if (!cb) return;
      const isQuery = list[0] === 'asset-db' && list[1] === 'query-asset-info';
      const isOpen = list[0] === 'asset-db' && list[1] === 'open-asset';
      if (isQuery) return cb(null, { type: settings.assetType || 'prefab', url: 'db://assets/x.prefab' });
      if (isOpen) {
        if (settings.openAck === 'skip') return;   // 无回执
        if (settings.openAck === 'error') return cb(new Error('Failed to find message'));
        return cb(null, {});
      }
      cb(null, {});
    },
    sendToPanel(...args) {
      const list = args.slice();
      const cb = typeof list[list.length - 1] === 'function' ? list.pop() : null;
      calls.push({ api: 'sendToPanel', args: list });
      if (cb && settings.panelAck) cb(null, {});
    }
  };
  return { editor: { Ipc }, calls };
}

async function run(options, kind) {
  const { editor, calls } = makeEditor(options);
  global.Editor = editor;

  // 每次重新 require，确保用最新的 global.Editor
  delete require.cache[require.resolve(path.join(ROOT, 'dist/panel/composables/useNodeSystem.js'))];
  const { useNodeSystem } = require(path.join(ROOT, 'dist/panel/composables/useNodeSystem.js'));

  const globalState = { nodeDetail: null, nodeTree: null, isGamePaused: false };
  const gameView = { value: null };
  const nodeTreeRef = { value: null };
  const activeTab = { value: 0 };

  const api = useNodeSystem(globalState, gameView, nodeTreeRef, activeTab);
  api.onLocateAsset(UUID, kind);
  await new Promise((resolve) => setTimeout(resolve, 1600));
  return calls;
}

(async function main() {
  console.log('[1] 预制体：定位后自动打开');
  {
    const calls = await run({ assetType: 'prefab' }, 'prefab');
    const hint = calls.find((c) => c.api === 'sendToAll' && c.args[0] === 'assets:hint');
    const query = calls.find((c) => c.api === 'sendToMain' && c.args[0] === 'asset-db' && c.args[1] === 'query-asset-info');
    const open = calls.find((c) => c.api === 'sendToMain' && c.args[0] === 'asset-db' && c.args[1] === 'open-asset');
    check('发出 assets:hint 定位', !!hint);
    check('先查资源类型', !!query);
    check('用 asset-db/open-asset 打开', !!open);
    check('打开发生在定位之后', !!open && calls.indexOf(hint) < calls.indexOf(open));
    check('拿到回执后不再发其它通道', !calls.some((c) => c.api === 'sendToPanel'));
  }

  console.log('[2] open-asset 无回执 → 降级 enter-prefab-edit-mode');
  {
    const calls = await run({ assetType: 'prefab', openAck: 'skip', panelAck: true }, 'prefab');
    const panel = calls.find((c) => c.api === 'sendToPanel' && c.args[0] === 'scene' && c.args[1] === 'scene:enter-prefab-edit-mode');
    check('降级到 sendToPanel(scene/enter-prefab-edit-mode)', !!panel);
    check('降级时参数带 uuid', !!panel && panel.args[2] === UUID);
  }

  console.log('[3] 非预制体（如组件脚本）：只定位不打开');
  {
    const calls = await run({ assetType: 'javascript' }, 'script');
    check('发出 assets:hint 定位', calls.some((c) => c.api === 'sendToAll' && c.args[0] === 'assets:hint'));
    check('没有调用任何打开通道', !calls.some((c) => c.api === 'sendToMain' && c.args[1] === 'open-asset'));
  }

  console.log('[4] 查不到类型时按调用方标注当预制体处理');
  {
    const { editor, calls } = makeEditor({ assetType: 'prefab' });
    // 让 query-asset-info 永远不回执
    editor.Ipc.sendToMain = ((original) => function (...args) {
      const list = args.slice();
      const cb = typeof list[list.length - 1] === 'function' ? list.pop() : null;
      calls.push({ api: 'sendToMain', args: list });
      if (list[0] === 'asset-db' && list[1] === 'query-asset-info') return; // 无回执
      if (cb) cb(null, {});
    })(editor.Ipc.sendToMain);
    global.Editor = editor;

    delete require.cache[require.resolve(path.join(ROOT, 'dist/panel/composables/useNodeSystem.js'))];
    const { useNodeSystem } = require(path.join(ROOT, 'dist/panel/composables/useNodeSystem.js'));
    const api = useNodeSystem({ nodeDetail: null }, { value: null }, { value: null }, { value: 0 });
    api.onLocateAsset(UUID, 'prefab');
    await new Promise((resolve) => setTimeout(resolve, 2200));
    check('仍会尝试 open-asset', calls.some((c) => c.api === 'sendToMain' && c.args[1] === 'open-asset'));
  }

  if (failures.length) {
    console.error('\n自检失败：\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('\n自检全部通过。');
  // composable 会留下轮询定时器，跑完显式退出
  process.exit(0);
})().catch((error) => {
  console.error('自检脚本异常：', error);
  process.exit(1);
});
