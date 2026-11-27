declare const Editor: any;

/**
 * 预览区空白处按 R 刷新游戏视图。
 *
 * 为什么挂在「预览区容器 + 焦点判定」上，而不是全局快捷键：
 * - 游戏画布（webview）内部按 R 是游戏自己的输入，不能抢；所以只认**空白区域**
 *   （游戏容器外的深灰底板 `#game-mount-wrap`）获得焦点时的按键。
 * - 空白区原本不可聚焦，靠 HTML 上给容器加 `tabindex="-1"` 让点击即可聚焦，
 *   这样按键的 event.target 自然落在容器内，判定不靠猜。
 *
 * 该按键与编辑器菜单加速键无关（纯字母键，无修饰键），因此面板 DOM 的 keydown 就能拦。
 */

/** 纯函数：是否为「刷新键」——r / R，且不带任何修饰键 */
export function isRefreshKey(e: any): boolean {
    if (!e) return false;
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    if (e.isComposing) return false; // 输入法组合中，别抢
    const key = e.key;
    // R 在按住 Shift 时 key 为大写，两者都收；同时兼容无法取到 key 的环境
    return key === 'r' || key === 'R';
}

export function usePreviewHotkey(wrapMount: any, refreshGame: () => void) {
    let installed = false;
    let lastRefreshAt = 0;

    const log = (msg: string) => {
        if (typeof Editor !== 'undefined') Editor.log(`[Bridge] ${msg}`);
    };

    /** 焦点是否在预览区空白处（而非工具栏输入框、其它标签页） */
    const isInPreviewArea = (e: any): boolean => {
        const el = wrapMount ? wrapMount.value : null;
        if (!el) return false;
        const target = e ? e.target : null;
        if (target && (target === el || (typeof el.contains === 'function' && el.contains(target)))) return true;
        // 某些情况下事件 target 落在 body，但焦点确实在预览底板
        try {
            if (typeof document !== 'undefined' && document.activeElement === el) return true;
        } catch (_) { }
        return false;
    };

    const onKeyDown = (e: any) => {
        if (!isRefreshKey(e)) return;
        if (!isInPreviewArea(e)) return;

        // 防止按住不放时连刷（webview 重建很贵）
        const now = Date.now();
        if (now - lastRefreshAt < 500) {
            e.preventDefault();
            return;
        }
        lastRefreshAt = now;

        e.preventDefault();
        log('预览区按 R → 刷新游戏视图');
        try {
            refreshGame();
        } catch (err: any) {
            if (typeof Editor !== 'undefined') Editor.warn('[Bridge] 按 R 刷新游戏视图失败: ' + err.message);
        }
    };

    /** 点击空白区时确保容器拿到焦点，否则后续按键不会落到这里 */
    const onPointerDown = (e: any) => {
        const el = wrapMount ? wrapMount.value : null;
        if (!el || typeof el.focus !== 'function') return;
        // 点在游戏画布（webview）上时绝不能抢焦点，否则游戏内的键盘输入会全部失效
        const target = e ? e.target : null;
        if (target) {
            if (target.tagName === 'WEBVIEW') return;
            if (typeof target.closest === 'function' && target.closest('webview')) return;
        }
        try { el.focus({ preventScroll: true }); } catch (_) {
            try { el.focus(); } catch (__) { }
        }
    };

    const install = () => {
        if (installed) return;
        const el = wrapMount ? wrapMount.value : null;
        if (!el || typeof el.addEventListener !== 'function') {
            if (typeof Editor !== 'undefined') Editor.warn('[Bridge] 预览区容器未就绪，按 R 刷新未启用');
            return;
        }
        installed = true;
        el.addEventListener('pointerdown', onPointerDown);
        // 挂在容器自身：只有焦点在预览区时按键才会冒泡到这里
        el.addEventListener('keydown', onKeyDown);
    };

    return { install, isRefreshKey };
}
