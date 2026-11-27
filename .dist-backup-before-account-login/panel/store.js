"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalState = void 0;
const { reactive } = require('vue');
exports.globalState = reactive({
    cocosInfo: null,
    nodeTree: null,
    lastTreeUpdate: 0,
    isFallbackMode: false,
    showFallbackWarning: false,
    devToolsError: null,
    nodeDetail: null,
    isGamePaused: false,
    isNarrow: false,
    webviewSrc: '',
    profiler: {
        tick: {
            fps: 0,
            avgFps: 0,
            fps1pLow: 0,
            fps01pLow: 0,
            drawCall: 0,
            logicTime: 0,
            renderTime: 0,
            totalMemory: 0,
            nodeCount: 0,
            gpuTime: 0,
            shaderSwitches: 0,
            textureBinds: 0,
            vertices: 0,
            triangles: 0,
            physicsTime: 0,
            jsHeapUsed: 0,
            jsHeapTotal: 0
        },
        memoryStats: null,
        expandedBundles: {},
        frameTimeline: {
            frameTimes: [],
            capacity: 600,
            lastUpdate: 0
        },
        memoryTimeline: {
            history: [],
            capacity: 150,
            lastUpdate: 0
        },
        leakDetection: {
            leakDetected: false,
            confidence: 0,
            trend: 'stable',
            slopeKBPerSample: 0,
            rSquared: 0,
            sampleCount: 0,
            details: '',
            lastCheck: 0
        },
        shaderTextureDetails: {
            shaderCount: 0,
            textureCount: 0,
            shaders: [],
            textures: [],
            summary: { shaderPerFrame: 0, shaderPerSec: 0, texturePerFrame: 0, texturePerSec: 0 },
            lastUpdate: 0
        }
    },
    renderDebugger: {
        snapshots: [],
        batchBreaks: []
    },
    isInspectorHovered: false,
    isInspectorFocused: false,
    isEditorSceneActive: false,
    isNodePickerActive: false,
    mcpStatus: { active: false, port: 4456, error: '', projectName: '', projectPath: '' },
    previewPort: 7456,
    uiScale: 1.0,
    baseFontSize: 13,
    inspectorLayout: 'horizontal',
    mcpClientList: [],
    mcpSelectedClientId: 0,
    mcpPayload: '',
    mcpScanning: false,
    mcpInjectLog: '',
    mcpLogs: [],
    // 用户脚本系统
    scriptList: [],
    scriptEditorVisible: false,
    scriptEditorContent: '',
    scriptEditorFileName: '',
    /** 运行模式：'preview' (预览模式) | 'build' (Build 模式) | 'custom' (自定义页面) */
    runMode: 'preview',
    /** 自定义 URL 页面地址 */
    customUrl: '',
    /** 是否正在进行模式切换（用于防抖与重置保护） */
    isSwitchingMode: false,
    /** Build 模式下是否成功检测到 Web 构建包产物 */
    isBuildPackageFound: true,
});
//# sourceMappingURL=store.js.map