const { computed } = require('vue');

// 账号自动登录（内嵌版）：
// 页面侧的引擎在探针里（window.__mcpAccountLogin，见 src/probe/account-login.ts），
// 这里只负责「轮询状态 + 转发指令 + 收提示」。
// 界面全部是 bridge 面板自己的 DOM，挂在录屏按钮下方，所以不受预览 webview
// 设备帧 transform: scale(k) 的影响，字号永远是面板字号。
export function useAccountLogin(globalState: any, gameView: any) {
    let pollTimer: any = null;
    let ipcBound = false;
    let toastTimer: any = null;

    const EMPTY_DATA = {
        accounts: [],
        activeKey: null,
        devServerWXPay: false,
        wxPayAvailable: false,
        newTemplate: 7,
        newAccount: null,
        engineReady: false,
        hasCanvas: false,
        panelOpen: false,
        current: null,
        modulesCaptured: 0
    };

    const accountData = computed(() => globalState.accountLogin.data || EMPTY_DATA);
    const accountAccounts = computed(() => (accountData.value.accounts || []).slice());
    const accountActiveKey = computed(() => accountData.value.activeKey || '');
    const accountToast = computed(() => {
        const entry = globalState.accountLogin.lastToast;
        return entry && entry.message ? entry.message : '';
    });

    const accountStatusColor = computed(() => {
        const data = accountData.value;
        if (!accountData.value || !globalState.accountLogin.ready) return '#6b7280';
        if (!data.engineReady) return '#6b7280';
        if (!data.hasCanvas) return '#eab308';
        return '#22c55e';
    });

    const accountStatusTip = computed(() => {
        const data = accountData.value;
        const lines: string[] = [];
        lines.push(globalState.accountLogin.ready ? '✓ 已连上面板内嵌引擎' : '✗ 页面里没有账号引擎（先刷新预览）');
        lines.push(data.engineReady ? '✓ 已拿到 cc 引擎对象' : '✗ 未取到 cc 引擎对象');
        lines.push(data.hasCanvas ? '✓ 已找到游戏画布' : '✗ 未找到游戏画布');
        lines.push(data.panelOpen ? '✓ 当前打开了 DevLoginOptions 面板' : '— 当前无 DevLoginOptions 面板');
        if (data.current && data.current.deviceId) {
            lines.push('当前面板：' + data.current.deviceId + ' / 服务器 ' + data.current.serverId);
        }
        lines.push('模块挂钩：' + (data.modulesHooked ? '✓ 已挂上 cc._RF' : '✗ 未挂上（假支付/开新号不可用）'));
        lines.push('已捕获项目模块：' + (data.modulesCaptured || 0) + ' 个（假支付/开新号需要）');
        return lines.join('\n');
    });

    function webview(): any {
        const wv: any = gameView.value;
        if (!wv) return null;
        if (typeof wv.isConnected === 'boolean' && !wv.isConnected) return null;
        try { wv.getWebContentsId(); } catch (e) { return null; }
        return wv;
    }

    function run(code: string) {
        const wv = webview();
        if (!wv) return;
        try { wv.executeJavaScript(code).catch(() => {}); } catch (e) { /* 未就绪，忽略 */ }
    }

    /** 调页面侧 window.__mcpAccountLogin.<method>(...args)，返回值忽略 */
    function call(method: string, args?: any[]) {
        const list = (args || []).map((value) => JSON.stringify(value === undefined ? null : value)).join(',');
        run('(function(){var api=window.__mcpAccountLogin;' +
            'if(!api||typeof api.' + method + '!=="function")return false;' +
            'try{api.' + method + '(' + list + ');return true;}catch(e){return false;}})()');
    }

    function applyState(data: any) {
        if (!data || !data.ready) return;
        globalState.accountLogin.data = data;
        globalState.accountLogin.ready = true;
        globalState.accountLogin.lastUpdate = Date.now();
    }

    function poll() {
        const wv = webview();
        if (!wv) {
            globalState.accountLogin.ready = false;
            return;
        }
        try {
            wv.executeJavaScript('window.__mcpAccountLogin ? window.__mcpAccountLogin.state() : null')
                .then((res: string) => {
                    if (!res) {
                        globalState.accountLogin.ready = false;
                        return;
                    }
                    try { applyState(JSON.parse(res)); } catch (e) { /* 解析失败忽略 */ }
                })
                .catch(() => {});
        } catch (e) { /* webview 未就绪 */ }
    }

    function pushToast(message: string) {
        if (!message) return;
        globalState.accountLogin.lastToast = { message: message, at: Date.now() };
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toastTimer = null;
            const current = globalState.accountLogin.lastToast;
            if (current && Date.now() - current.at >= 3000) globalState.accountLogin.lastToast = null;
        }, 3200);
    }

    function onIpcMessage(event: any) {
        if (!event) return;
        if (event.channel === 'account-login:toast') {
            const payload = event.args && event.args[0];
            if (payload && payload.message) pushToast(String(payload.message));
        } else if (event.channel === 'account-login:state') {
            applyState(event.args && event.args[0]);
        }
    }

    function bindIpc() {
        if (ipcBound) return;
        const wv = webview();
        if (!wv) return;
        try {
            wv.addEventListener('ipc-message', onIpcMessage);
            ipcBound = true;
        } catch (e) { /* 忽略 */ }
    }

    /** 面板打开后开始轮询（1s 一次，和性能轮询比可以忽略） */
    function start() {
        bindIpc();
        if (pollTimer) return;
        pollTimer = setInterval(() => {
            bindIpc();
            poll();
        }, 1000);
        poll();
    }

    function stop() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    // ===== 界面动作 =====
    function accountTogglePanel() {
        globalState.accountLogin.open = !globalState.accountLogin.open;
        if (globalState.accountLogin.open) {
            start();
            poll();
        }
    }

    function accountGrab() { call('grab'); }
    function accountUse(key: string) { call('use', [key]); }
    function accountToggleAuto(key: string, on: boolean) { call('toggle', [key, !!on]); }
    function accountRemove(key: string) { call('remove', [key]); }
    function accountSetTemplate(value: any) {
        const template = Number(value);
        if (!isFinite(template) || template < 0) {
            pushToast('模板号需为不小于 0 的整数');
            return;
        }
        call('setTemplate', [Math.floor(template)]);
    }
    function accountStartNew() { call('startNewAccount'); }
    function accountCancelNew() { call('cancelNewAccount'); }
    function accountToggleWXPay(on: boolean) { call('setWXPay', [!!on]); }
    function accountCancelReload() { call('cancelReload'); }

    // ===== 展示辅助 =====
    function accountShort(deviceId: string) {
        const text = String(deviceId || '');
        if (text.length <= 17) return text;
        return text.slice(0, 8) + '…' + text.slice(-8);
    }

    function accountTime(ts: number) {
        const date = new Date(Number(ts) || Date.now());
        const pad = (n: number) => (n < 10 ? '0' + n : String(n));
        const now = new Date();
        const hm = pad(date.getHours()) + ':' + pad(date.getMinutes());
        if (date.toDateString() === now.toDateString()) return hm;
        return pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + hm;
    }

    return {
        accountData,
        accountAccounts,
        accountActiveKey,
        accountToast,
        accountStatusColor,
        accountStatusTip,
        accountTogglePanel,
        accountGrab,
        accountUse,
        accountToggleAuto,
        accountRemove,
        accountSetTemplate,
        accountStartNew,
        accountCancelNew,
        accountToggleWXPay,
        accountCancelReload,
        accountShort,
        accountTime,
        accountStartPolling: start,
        accountStopPolling: stop
    };
}
