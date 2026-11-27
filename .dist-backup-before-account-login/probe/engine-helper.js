"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCcEngine = getCcEngine;
exports.safeGetCcEngine = safeGetCcEngine;
// @ts-nocheck
/**
 * 引擎实例查找器
 * 兼容 Preview 模式（直接挂在 window.cc）与 Build 模式（可能挂在 window.cc、iframe#GameDiv 或 window.frames 内）
 */
function getCcEngine() {
    if (typeof window === 'undefined')
        return null;
    // 1. 优先检测当前全局 window.cc
    if (window.cc && window.cc.director) {
        return window.cc;
    }
    // 2. 检测 typeof cc 变量
    if (typeof cc !== 'undefined' && cc && cc.director) {
        window.cc = cc;
        return cc;
    }
    // 3. 检测 iframe#GameDiv 容器 (Cocos 2.4.x 某些模板)
    try {
        const gameDiv = document.getElementById('GameDiv');
        if (gameDiv && gameDiv.contentWindow && gameDiv.contentWindow.cc && gameDiv.contentWindow.cc.director) {
            const iframeCc = gameDiv.contentWindow.cc;
            window.cc = iframeCc;
            return iframeCc;
        }
    }
    catch (e) { }
    // 4. 遍历所有子框架 window.frames
    try {
        if (window.frames && window.frames.length > 0) {
            for (let i = 0; i < window.frames.length; i++) {
                try {
                    const frameCc = window.frames[i].cc;
                    if (frameCc && frameCc.director) {
                        window.cc = frameCc;
                        return frameCc;
                    }
                }
                catch (e) { }
            }
        }
    }
    catch (e) { }
    return null;
}
function safeGetCcEngine() {
    try {
        if (typeof getCcEngine === 'function')
            return getCcEngine();
    }
    catch (e) { }
    if (typeof window !== 'undefined') {
        if (typeof window.getCcEngine === 'function')
            return window.getCcEngine();
        if (typeof window.__mcpGetCcEngine === 'function')
            return window.__mcpGetCcEngine();
        if (window.cc && window.cc.director)
            return window.cc;
    }
    if (typeof cc !== 'undefined' && cc && cc.director)
        return cc;
    return null;
}
// 保证挂载到全局 window 作用域，防止闭包内调用引发 ReferenceError
if (typeof window !== 'undefined') {
    window.getCcEngine = getCcEngine;
    window.__mcpGetCcEngine = getCcEngine;
    window.safeGetCcEngine = safeGetCcEngine;
}
//# sourceMappingURL=engine-helper.js.map