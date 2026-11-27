"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
exports.Logger = {
    get isDebug() {
        return window.__MCP_DEBUG__ === true;
    },
    log(...args) {
        if (this.isDebug) {
            console.log(...args);
        }
    },
    debug(...args) {
        if (this.isDebug) {
            console.debug(...args);
        }
    },
    info(...args) {
        if (this.isDebug) {
            console.info(...args);
        }
    },
    warn(...args) {
        if (this.isDebug) {
            console.warn(...args);
        }
    },
    error(...args) {
        // 错误日志强制输出，不被 debug 开关屏蔽
        console.error(...args);
    }
};
//# sourceMappingURL=logger.js.map