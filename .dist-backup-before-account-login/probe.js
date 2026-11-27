"use strict";
(() => {
  // src/probe/logger.ts
  var Logger = {
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
      console.error(...args);
    }
  };

  // src/probe/engine-helper.ts
  function getCcEngine() {
    if (typeof window === "undefined") return null;
    if (window.cc && window.cc.director) {
      return window.cc;
    }
    if (typeof cc !== "undefined" && cc && cc.director) {
      window.cc = cc;
      return cc;
    }
    try {
      const gameDiv = document.getElementById("GameDiv");
      if (gameDiv && gameDiv.contentWindow && gameDiv.contentWindow.cc && gameDiv.contentWindow.cc.director) {
        const iframeCc = gameDiv.contentWindow.cc;
        window.cc = iframeCc;
        return iframeCc;
      }
    } catch (e) {
    }
    try {
      if (window.frames && window.frames.length > 0) {
        for (let i = 0; i < window.frames.length; i++) {
          try {
            const frameCc = window.frames[i].cc;
            if (frameCc && frameCc.director) {
              window.cc = frameCc;
              return frameCc;
            }
          } catch (e) {
          }
        }
      }
    } catch (e) {
    }
    return null;
  }
  function safeGetCcEngine2() {
    try {
      if (typeof getCcEngine === "function") return getCcEngine();
    } catch (e) {
    }
    if (typeof window !== "undefined") {
      if (typeof window.getCcEngine === "function") return window.getCcEngine();
      if (typeof window.__mcpGetCcEngine === "function") return window.__mcpGetCcEngine();
      if (window.cc && window.cc.director) return window.cc;
    }
    if (typeof cc !== "undefined" && cc && cc.director) return cc;
    return null;
  }
  if (typeof window !== "undefined") {
    window.getCcEngine = getCcEngine;
    window.__mcpGetCcEngine = getCcEngine;
    window.safeGetCcEngine = safeGetCcEngine2;
  }

  // src/probe/crawler-serialize.ts
  function syncNodeTree() {
    const ccEng = safeGetCcEngine2();
    const scene = ccEng ? ccEng.director.getScene() : null;
    if (!scene) return;
    const treeData = serializeNode(scene, 0);
    const pauseStatus = ccEng && typeof ccEng.game !== "undefined" && ccEng.game.isPaused ? ccEng.game.isPaused() : false;
    let atlasCount = void 0;
    try {
      if (ccEng && ccEng.dynamicAtlasManager) {
        atlasCount = ccEng.dynamicAtlasManager.atlasCount;
      }
    } catch (e) {
    }
    if (window.__mcpInspector && window.__mcpInspector.updateTree) {
      window.__mcpInspector.updateTree(JSON.stringify({ tree: treeData, isPaused: pauseStatus, atlasCount }));
    }
  }
  function serializeNode(node, currentPrefabDepth = 0) {
    if (!node) return null;
    if (node.name === "__mcp_hover_overlay__" || node.name === "__mcp_select_overlay__" || node.name === "McpInspectorRoot" || node.name === "InspectorCamera") return null;
    let isActive = true;
    let isActiveInHierarchy = true;
    let isScene = false;
    const ccEng = safeGetCcEngine2();
    if (ccEng && node instanceof ccEng.Scene) {
      isActive = true;
      isActiveInHierarchy = true;
      isScene = true;
    } else {
      try {
        isActive = node.active !== false;
        isActiveInHierarchy = node.activeInHierarchy !== false;
      } catch (e) {
      }
    }
    let isPrefab = !!node._prefab;
    let prefabRoot = isPrefab && node._prefab.root === node;
    let nextPrefabDepth = currentPrefabDepth;
    if (prefabRoot) {
      nextPrefabDepth++;
    }
    const componentNames = [];
    if (node._components) {
      for (let k = 0; k < node._components.length; k++) {
        const comp = node._components[k];
        let cClass = comp.name || (comp.constructor ? comp.constructor.name : "");
        if (typeof window.cc !== "undefined" && window.cc.js && typeof window.cc.js.getClassName === "function") {
          const cName = window.cc.js.getClassName(comp);
          if (cName) cClass = cName;
        }
        if (cClass) {
          const m = cClass.match(/<(.+)>/);
          componentNames.push(m ? m[1] : cClass);
        }
      }
    }
    const data = {
      id: node.uuid || node.id,
      name: node.name,
      active: isActive,
      activeInHierarchy: isActiveInHierarchy,
      childrenCount: node.childrenCount || 0,
      components: node._components ? node._components.length : 0,
      componentNames,
      children: [],
      isScene,
      isPrefab,
      prefabRoot,
      prefabDepth: nextPrefabDepth
    };
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const childData = serializeNode(node.children[i], nextPrefabDepth);
        if (childData) {
          data.children.push(childData);
        }
      }
    }
    return data;
  }

  // src/probe/crawler.ts
  function initVisualFeedbackStyle() {
    if (document.getElementById("__mcp_simulate_style")) return;
    const style = document.createElement("style");
    style.id = "__mcp_simulate_style";
    style.textContent = `
    .mcp-visual-base {
        position: fixed;
        pointer-events: none;
        z-index: 2147483647;
        transform: translate(-50%, -50%);
    }
    .mcp-visual-click {
        width: 20px; height: 20px;
        border: 2px solid rgba(255, 0, 0, 0.8);
        border-radius: 50%;
        animation: mcp-ripple 0.5s ease-out forwards;
    }
    .mcp-visual-click::after, .mcp-visual-click::before {
        content: ""; position: absolute; background: rgba(255, 0, 0, 0.8);
    }
    .mcp-visual-click::before { top: 50%; left: -5px; right: -5px; height: 1px; }
    .mcp-visual-click::after { left: 50%; top: -5px; bottom: -5px; width: 1px; }
    
    .mcp-visual-long-press {
        width: 40px; height: 40px;
        border-radius: 50%;
        border: 4px solid rgba(255, 165, 0, 0.3);
        border-top-color: rgba(255, 165, 0, 1);
        animation: mcp-spin linear forwards;
    }
    .mcp-visual-swipe {
        width: 16px; height: 16px;
        background-color: rgba(0, 150, 255, 0.8);
        border-radius: 50%;
        box-shadow: 0 0 8px rgba(0, 150, 255, 1);
    }
    @keyframes mcp-ripple {
        0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
    }
    @keyframes mcp-spin {
        0% { transform: translate(-50%, -50%) rotate(0deg); }
        100% { transform: translate(-50%, -50%) rotate(360deg); }
    }
    `;
    if (document.head) {
      document.head.appendChild(style);
    } else {
      document.body.appendChild(style);
    }
  }
  function getComponentClassName(comp) {
    if (!comp) return "UnknownComponent";
    let cname = "UnknownComponent";
    const ccEng = safeGetCcEngine();
    if (ccEng && ccEng.js && typeof ccEng.js.getClassName === "function") {
      cname = ccEng.js.getClassName(comp);
    }
    if (!cname) {
      cname = comp.name || (comp.constructor ? comp.constructor.name : "UnknownComponent");
    }
    const match = cname.match(/<([^>]+)>/);
    return match ? match[1] : cname;
  }
  function initCrawler() {
    window.__mcpCrawler = {
      findNodeByUuid: function(uuid, root) {
        const eng = safeGetCcEngine();
        if (!eng || !eng.director) return null;
        const startNode = root || eng.director.getScene();
        if (!startNode) return null;
        if (startNode.uuid === uuid || startNode.id === uuid) return startNode;
        for (let i = 0; i < startNode.childrenCount; i++) {
          const found = this.findNodeByUuid(uuid, startNode.children[i]);
          if (found) return found;
        }
        return null;
      },
      getNodeDetail: function(uuid) {
        const node = this.findNodeByUuid(uuid);
        if (!node) return null;
        const ccEng = safeGetCcEngine();
        if (ccEng && node instanceof ccEng.Scene) {
          return {
            id: node.uuid || node.id,
            name: node.name,
            isScene: true,
            active: true,
            components: []
          };
        }
        let isActive = true;
        try {
          isActive = node.active !== false;
        } catch (e) {
        }
        let prefabUuid = null;
        try {
          if (node._prefab) {
            if (node._prefab.asset) {
              prefabUuid = node._prefab.asset._uuid || node._prefab.asset.uuid || node._prefab.asset.id;
            }
            if (!prefabUuid && node._prefab.fileId) {
              prefabUuid = node._prefab.fileId;
            }
            if (!prefabUuid && node._prefab._prefab) {
              prefabUuid = node._prefab._prefab._uuid || node._prefab._prefab.uuid;
            }
            if (!prefabUuid) {
              var cur = node;
              while (cur) {
                if (cur._prefab && cur._prefab.root === cur && cur._prefab.asset) {
                  prefabUuid = cur._prefab.asset._uuid || cur._prefab.asset.uuid || cur._prefab.asset.id;
                  break;
                }
                cur = cur.parent;
              }
            }
          }
        } catch (e) {
        }
        let sx = 1, sy = 1;
        if ("scale" in node && typeof node.scale === "object" && "x" in node.scale) {
          sx = node.scale.x !== void 0 ? node.scale.x : 1;
          sy = node.scale.y !== void 0 ? node.scale.y : 1;
        } else {
          sx = node.scaleX !== void 0 ? node.scaleX : 1;
          sy = node.scaleY !== void 0 ? node.scaleY : 1;
        }
        const detail = {
          id: node.uuid || node.id,
          name: node.name,
          isScene: false,
          prefabUuid,
          active: isActive,
          x: node.x !== void 0 ? node.x : 0,
          y: node.y !== void 0 ? node.y : 0,
          worldPolygon: this.getNodeWorldPolygon(node),
          interactable: window.cc && window.cc.Button && node.getComponent(window.cc.Button) ? node.getComponent(window.cc.Button).interactable : null,
          hasAngle: "angle" in node,
          rotation: "angle" in node ? -node.angle : node.rotation !== void 0 ? node.rotation : 0,
          scaleX: sx,
          scaleY: sy,
          width: node.width !== void 0 ? node.width : 0,
          height: node.height !== void 0 ? node.height : 0,
          anchorX: node.anchorX !== void 0 ? node.anchorX : 0.5,
          anchorY: node.anchorY !== void 0 ? node.anchorY : 0.5,
          color: node.color ? "#" + node.color.toHEX() : "#ffffff",
          opacity: node.opacity !== void 0 ? node.opacity : 255,
          skewX: node.skewX || 0,
          skewY: node.skewY || 0,
          groupIndex: node.groupIndex !== void 0 ? node.groupIndex : 0,
          groupList: window.cc && window.cc.game ? window.cc.game.groupList : null,
          components: []
        };
        if (node._components) {
          for (let i = 0; i < node._components.length; i++) {
            const comp = node._components[i];
            const cname = getComponentClassName(comp);
            const props = [];
            let propKeys = [];
            const registeredProps = /* @__PURE__ */ new Set();
            if (comp.constructor) {
              if (Array.isArray(comp.constructor.__props__)) {
                comp.constructor.__props__.forEach((p) => registeredProps.add(p));
              }
              if (comp.constructor.__attrs__) {
                Object.keys(comp.constructor.__attrs__).forEach((attrKey) => {
                  const idx = attrKey.indexOf("|");
                  if (idx > 0) {
                    registeredProps.add(attrKey.substring(0, idx));
                  }
                });
              }
            }
            if (registeredProps.size > 0) {
              propKeys = Array.from(registeredProps);
            } else {
              propKeys = Object.keys(comp);
            }
            const hiddenBuiltins = ["name", "uuid", "node", "enabled", "enabledInHierarchy", "_scriptAsset", "__scriptAsset", "_isOnLoadCalled", "_objFlags", "AnimList"];
            for (let j = 0; j < propKeys.length; j++) {
              const key = propKeys[j];
              try {
                if (hiddenBuiltins.indexOf(key) !== -1) continue;
                let isVisible = true;
                if (comp.constructor && comp.constructor.__attrs__) {
                  const visibleAttr = comp.constructor.__attrs__[key + "|visible"];
                  if (visibleAttr !== void 0) {
                    isVisible = typeof visibleAttr === "function" ? !!visibleAttr.call(comp) : !!visibleAttr;
                  } else if (key.startsWith("_")) {
                    isVisible = false;
                  }
                } else if (key.startsWith("_")) {
                  isVisible = false;
                }
                if (!isVisible) continue;
                const val = comp[key];
                if (typeof val === "function") continue;
                let type = "unsupported";
                let exportValue = val;
                if (val === null || val === void 0) type = "unsupported";
                else if (typeof val === "number") type = "number";
                else if (typeof val === "string") type = "string";
                else if (typeof val === "boolean") type = "boolean";
                else if (Array.isArray(val)) {
                  type = "array";
                  exportValue = val.map((item) => {
                    if (item === null) return "null";
                    if (item === void 0) return "undefined";
                    if (typeof item === "number" || typeof item === "string" || typeof item === "boolean") return item;
                    const eng = window.cc;
                    if (eng && eng.Node && item instanceof eng.Node) {
                      return { type: "node_ref", value: { uuid: item.uuid || item.id, name: item.name } };
                    } else if (eng && eng.Component && item instanceof eng.Component) {
                      let cname2 = item.name || item.__classname__ || "Component";
                      const m = cname2.match(/<([^>]+)>/);
                      if (m) cname2 = m[1];
                      return { type: "comp_ref", value: { uuid: item.node.uuid || item.node.id, name: item.node.name, className: cname2 } };
                    } else if (eng && eng.Vec2 && item instanceof eng.Vec2) {
                      return { type: "vec2", value: { x: item.x, y: item.y } };
                    } else if (eng && eng.Vec3 && item instanceof eng.Vec3) {
                      return { type: "vec3", value: { x: item.x, y: item.y, z: item.z } };
                    } else if (eng && eng.Size && item instanceof eng.Size) {
                      return { type: "size", value: { width: item.width, height: item.height } };
                    } else if (eng && eng.Rect && item instanceof eng.Rect) {
                      return { type: "rect", value: { x: item.x, y: item.y, width: item.width, height: item.height } };
                    } else if (eng && eng.Color && item instanceof eng.Color) {
                      return { type: "color", value: { r: item.r, g: item.g, b: item.b, a: item.a, hex: item.toHEX() } };
                    } else if (eng && eng.Asset && item instanceof eng.Asset) {
                      let clsName = "cc.Asset";
                      if (item.__classname__) clsName = item.__classname__;
                      else if (item.constructor && item.constructor.name) clsName = item.constructor.name;
                      return { type: "asset_ref", value: { uuid: item._uuid || item.uuid || item.id || "unknown", name: item.name || "Unnamed Asset", className: clsName } };
                    }
                    if (item.__classname__ || item.name) return `[${item.__classname__ || "\u5BF9\u8C61"}] ${item.name || ""}`;
                    return "[\u590D\u6742\u5BF9\u8C61]";
                  });
                } else if (typeof val === "object") {
                  const eng = window.cc;
                  if (eng && eng.Node && val instanceof eng.Node) {
                    type = "node_ref";
                    exportValue = { uuid: val.uuid || val.id, name: val.name };
                  } else if (eng && eng.Component && val instanceof eng.Component) {
                    type = "comp_ref";
                    let cname2 = val.name || val.__classname__ || "Component";
                    const m = cname2.match(/<([^>]+)>/);
                    if (m) cname2 = m[1];
                    exportValue = { uuid: val.node.uuid || val.node.id, name: val.node.name, className: cname2 };
                  } else if (eng && eng.Vec2 && val instanceof eng.Vec2) {
                    type = "vec2";
                    exportValue = { x: val.x, y: val.y };
                  } else if (eng && eng.Vec3 && val instanceof eng.Vec3) {
                    type = "vec3";
                    exportValue = { x: val.x, y: val.y, z: val.z };
                  } else if (eng && eng.Size && val instanceof eng.Size) {
                    type = "size";
                    exportValue = { width: val.width, height: val.height };
                  } else if (eng && eng.Rect && val instanceof eng.Rect) {
                    type = "rect";
                    exportValue = { x: val.x, y: val.y, width: val.width, height: val.height };
                  } else if (eng && eng.Color && val instanceof eng.Color) {
                    type = "color";
                    exportValue = { r: val.r, g: val.g, b: val.b, a: val.a, hex: val.toHEX() };
                  } else if (eng && eng.Asset && val instanceof eng.Asset) {
                    type = "asset_ref";
                    let clsName = "cc.Asset";
                    if (val.__classname__) clsName = val.__classname__;
                    else if (val.constructor && val.constructor.name) clsName = val.constructor.name;
                    exportValue = { uuid: val._uuid || val.uuid || val.id || "unknown", name: val.name || "Unnamed Asset", className: clsName };
                  }
                }
                if (type !== "unsupported") {
                  let enumList = null;
                  let eList = null;
                  if (window.cc && window.cc.Class && typeof window.cc.Class.attr === "function") {
                    const attrObj = window.cc.Class.attr(comp.constructor, key);
                    if (attrObj && attrObj.enumList) {
                      eList = attrObj.enumList;
                    }
                  }
                  if (!eList && comp.constructor && comp.constructor.__attrs__) {
                    eList = comp.constructor.__attrs__[key + "|enumList"];
                  }
                  if (eList && Array.isArray(eList)) {
                    if (eList.length > 0 && eList[0].name !== void 0 && eList[0].value !== void 0) {
                      enumList = eList;
                      type = "Enum";
                    } else {
                      enumList = eList.map((e) => typeof e === "object" ? e : { name: e.toString(), value: e });
                      type = "Enum";
                    }
                  }
                  if (cname === "sp.Skeleton" || cname === "Skeleton") {
                    if ((key === "animation" || key === "defaultAnimation") && comp.skeletonData) {
                      try {
                        const rd = comp.skeletonData.getRuntimeData();
                        if (rd && rd.animations) enumList = ["<None>"].concat(rd.animations.map((a) => a.name));
                      } catch (e) {
                      }
                    } else if (key === "defaultSkin" && comp.skeletonData) {
                      try {
                        const rd = comp.skeletonData.getRuntimeData();
                        if (rd && rd.skins) enumList = rd.skins.map((s) => s.name);
                      } catch (e) {
                      }
                    }
                  } else if (cname === "dragonBones.ArmatureDisplay" || cname === "ArmatureDisplay") {
                    if (key === "armatureName") {
                      try {
                        if (typeof comp.getArmatureNames === "function") {
                          enumList = ["<None>"].concat(comp.getArmatureNames() || []);
                        }
                      } catch (e) {
                      }
                    } else if (key === "animationName") {
                      try {
                        if (typeof comp.getAnimationNames === "function") {
                          enumList = ["<None>"].concat(comp.getAnimationNames(comp.armatureName) || []);
                        }
                      } catch (e) {
                      }
                    }
                  }
                  const propData = { key, value: exportValue, type };
                  if (enumList) propData.enumList = enumList;
                  props.push(propData);
                }
              } catch (e) {
              }
            }
            let scriptUuid = null;
            if (comp.__scriptAsset) {
              scriptUuid = comp.__scriptAsset._uuid || comp.__scriptAsset.uuid || comp.__scriptAsset.id;
            }
            if (!scriptUuid && window.cc && window.cc.js) {
              const classId = window.cc.js._getClassId(comp.constructor);
              if (classId && typeof classId === "string" && classId.indexOf("cc.") !== 0 && classId.indexOf("sp.") !== 0 && classId !== "Widget" && classId !== "dragonBones.ArmatureDisplay") {
                scriptUuid = classId;
              }
            }
            detail.components.push({
              name: cname,
              realIndex: i,
              enabled: comp.enabled !== false,
              scriptUuid,
              properties: props
            });
          }
        }
        return detail;
      },
      updateNodeProperty: function(uuid, compName, propKey, value, compIndex, arrayIndex) {
        const node = this.findNodeByUuid(uuid);
        if (!node || !node.isValid) {
          Logger.warn("[MCP Crawler] Node " + uuid + " is invalid or already destroyed.");
          return false;
        }
        try {
          if (!compName || compName === "null") {
            if (propKey === "rotation" && "angle" in node) {
              node.angle = -value;
            } else if (propKey === "color" && window.cc && window.cc.Color) {
              let hex = String(value);
              if (hex.startsWith("#")) hex = hex.slice(1);
              let r = parseInt(hex.slice(0, 2), 16) || 0;
              let g = parseInt(hex.slice(2, 4), 16) || 0;
              let b = parseInt(hex.slice(4, 6), 16) || 0;
              node.color = new window.cc.Color(r, g, b, node.color ? node.color.a : 255);
            } else if (propKey === "opacity") {
              node.opacity = Math.max(0, Math.min(255, parseInt(value, 10) || 0));
            } else if (propKey === "scaleX" || propKey === "scaleY") {
              if ("scale" in node && typeof node.scale === "object" && "x" in node.scale) {
                let vec = node.scale;
                if (propKey === "scaleX") vec.x = value;
                if (propKey === "scaleY") vec.y = value;
                node.scale = vec;
              } else {
                node[propKey] = value;
              }
            } else {
              node[propKey] = value;
            }
            return true;
          } else {
            if (node._components) {
              let targetComp = null;
              if (compIndex !== void 0 && compIndex >= 0 && compIndex < node._components.length) {
                targetComp = node._components[compIndex];
              } else {
                for (let i = 0; i < node._components.length; i++) {
                  const comp = node._components[i];
                  const cname = getComponentClassName(comp);
                  if (cname === compName) {
                    targetComp = comp;
                    break;
                  }
                }
              }
              if (targetComp) {
                if (arrayIndex !== void 0 && arrayIndex !== null && arrayIndex !== -1) {
                  const arr = targetComp[propKey];
                  if (Array.isArray(arr) && arr[arrayIndex] !== void 0) {
                    if (typeof value === "object" && value !== null) {
                      Object.assign(arr[arrayIndex], value);
                    } else {
                      arr[arrayIndex] = value;
                    }
                  }
                } else {
                  if (typeof value === "object" && value !== null && targetComp[propKey] && typeof targetComp[propKey] === "object") {
                    Object.assign(targetComp[propKey], value);
                  } else {
                    targetComp[propKey] = value;
                  }
                }
                if (typeof targetComp.updateAlignment === "function") {
                  targetComp.updateAlignment();
                }
                return true;
              }
              Logger.warn("[MCP Crawler] Component " + compName + " not found on node " + node.name);
              return false;
            }
          }
        } catch (e) {
          console.error("[MCP Crawler] Exception in updateNodeProperty: ", e);
        }
        return false;
      },
      printComponentData: function(uuid, compIndex) {
        const node = this.findNodeByUuid(uuid);
        if (!node || !node._components || compIndex < 0 || compIndex >= node._components.length) {
          Logger.warn("[MCP Crawler] Target node or component not found for printing.", uuid, compIndex);
          return;
        }
        const comp = node._components[compIndex];
        const eng = window.cc || {};
        function getNodePath(n) {
          try {
            if (!n) return "";
            let isValidStr = n.isValid === false ? " (Destroyed)" : "";
            let path = (n.name || "Unnamed") + isValidStr;
            let current = n.parent;
            while (current) {
              let curValidStr = current.isValid === false ? " (Destroyed)" : "";
              path = (current.name || "Unnamed") + curValidStr + "/" + path;
              current = current.parent;
            }
            return path;
          } catch (e) {
            return "[Unknown Node Path]";
          }
        }
        const seen = /* @__PURE__ */ new WeakSet();
        const replacer = function(key, value) {
          try {
            if (value === null || value === void 0) return value;
            if (value === window || value === document || typeof value === "object" && value.nodeType !== void 0) {
              return "[DOM Element]";
            }
            if (eng.Node && (value instanceof eng.Node || value.constructor && value.constructor.name === "Node")) {
              return `[ cc.Node: ${getNodePath(value)} ]`;
            }
            if (eng.Component && (value instanceof eng.Component || value.constructor && value.constructor.prototype instanceof eng.Component)) {
              let compName = value.name || value.__classname__ || (value.constructor ? value.constructor.name : "Component");
              const match = compName.match(/<([^>]+)>/);
              if (match) compName = match[1];
              return `[ Component: ${compName} on Node: ${getNodePath(value.node)} ]`;
            }
            if (eng.Asset && (value instanceof eng.Asset || value.constructor && value.constructor.prototype instanceof eng.Asset)) {
              let clsName = "cc.Asset";
              if (value.__classname__) clsName = value.__classname__;
              else if (value.constructor && value.constructor.name) clsName = value.constructor.name;
              return `[ ${clsName}: ${value.name || value._name || "Unnamed"} ]`;
            }
            if (typeof value === "object") {
              if (seen.has(value)) {
                return "[Circular]";
              }
              seen.add(value);
            }
            return value;
          } catch (e) {
            return "[Error Serializing Property]";
          }
        };
        try {
          const jsonStr = JSON.stringify(comp, replacer, 4);
          const compName = getComponentClassName(comp);
          console.log(`%c[MCP] \u7EC4\u4EF6 (${compName}) \u6570\u636E\u5BFC\u51FA\u6210\u529F \u{1F447}`, "color: #00ff00; font-weight: bold;");
          console.log(jsonStr);
          console.log(`%c---------------------------------------`, "color: #00ff00; font-weight: bold;");
          if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(jsonStr).catch(function(err) {
            });
          }
        } catch (err) {
          console.error("[MCP Crawler] \u5E8F\u5217\u5316\u7EC4\u4EF6\u6570\u636E\u5931\u8D25: ", err);
        }
      },
      printNodeData: function(uuid) {
        const node = this.findNodeByUuid(uuid);
        if (!node || !node.isValid) {
          console.warn("[MCP Crawler] Target node not found for printing.", uuid);
          return;
        }
        try {
          console.log("%c[MCP] \u8282\u70B9 (" + node.name + ") \u6570\u636E\u5DF2\u6253\u5370 \u{1F447}", "color: #00ff00; font-weight: bold;");
          console.dir(node);
        } catch (err) {
          console.error("[MCP Crawler] \u6253\u5370\u8282\u70B9\u6570\u636E\u65F6\u53D1\u751F\u5F02\u5E38: ", err);
        }
      },
      getNodeWorldPolygon: function(target) {
        const eng = window.cc;
        if (!target || typeof target.convertToWorldSpaceAR !== "function") return null;
        const width = target.width || 0;
        const height = target.height || 0;
        if (width === 0 && height === 0) return null;
        const ax = target.anchorX !== void 0 ? target.anchorX : 0.5;
        const ay = target.anchorY !== void 0 ? target.anchorY : 0.5;
        const ptLeft = -ax * width;
        const ptRight = (1 - ax) * width;
        const ptBottom = -ay * height;
        const ptTop = (1 - ay) * height;
        let bl = target.convertToWorldSpaceAR(eng.v2(ptLeft, ptBottom));
        let br = target.convertToWorldSpaceAR(eng.v2(ptRight, ptBottom));
        let tr = target.convertToWorldSpaceAR(eng.v2(ptRight, ptTop));
        let tl = target.convertToWorldSpaceAR(eng.v2(ptLeft, ptTop));
        return [bl, br, tr, tl];
      },
      setHoverTarget: function(uuid) {
        if (window.__mcpHighlightData) {
          window.__mcpHighlightData.hoverId = uuid;
        }
      },
      setSelectionTarget: function(uuid) {
        if (window.__mcpHighlightData) {
          Logger.log(`[Selection-Debug] Trigger: Probe-Crawler-setSelectionTarget | NodeID: ${uuid}`);
          window.__mcpHighlightData.selectId = uuid;
        }
      },
      getSimplifiedNode: function(uuid) {
        const node = this.findNodeByUuid(uuid);
        if (!node || !node.isValid) return null;
        let compNames = [];
        if (node._components) {
          compNames = node._components.map(function(c) {
            let cname = c.name || c.__classname__ || "Unknown";
            const m = cname.match(/<([^>]+)>/);
            return m ? m[1] : cname;
          });
        }
        return {
          name: node.name,
          uuid: node.uuid || node.id,
          active: node.active !== false,
          position: { x: node.x || 0, y: node.y || 0 },
          size: { width: node.width || 0, height: node.height || 0 },
          components: compNames
        };
      },
      simulateInput: function(args) {
        const eng = window.cc;
        if (!eng || !eng.director) return { error: "ENGINE_NOT_READY" };
        let screenPt = eng.v2(0, 0);
        let targetSource = "";
        if (args && args.uuid) {
          const node = this.findNodeByUuid(args.uuid);
          if (!node || !node.isValid) return { error: "NODE_NOT_FOUND", msg: "Node not found or destroyed." };
          let worldPos = eng.v2(0, 0);
          if (typeof node.convertToWorldSpaceAR === "function") {
            worldPos = node.convertToWorldSpaceAR(eng.v2(0, 0));
          }
          let camera = null;
          if (eng.Camera && eng.Camera.cameras) {
            camera = eng.Camera.cameras.sort(function(a, b) {
              return b.depth - a.depth;
            })[0];
          }
          screenPt = camera && typeof camera.getWorldToScreenPoint === "function" ? camera.getWorldToScreenPoint(worldPos) : worldPos;
          targetSource = "UUID " + args.uuid.substring(0, 6) + " (World " + Math.round(worldPos.x) + "," + Math.round(worldPos.y) + ")";
        } else if (args && (args.x !== void 0 || args.y !== void 0)) {
          screenPt.x = args.x || 0;
          screenPt.y = args.y || 0;
          targetSource = "Raw ScreenPos (" + screenPt.x + ", " + screenPt.y + ")";
        } else {
          return { error: "INVALID_ARGS", msg: "Please provide either uuid or x/y coordinates" };
        }
        const canvas = document.getElementById("GameCanvas") || document.querySelector("canvas");
        if (!canvas) return { error: "CANVAS_NOT_FOUND" };
        const rect = canvas.getBoundingClientRect();
        const frameSize = eng.view.getFrameSize();
        const visibleOrigin = eng.view.getVisibleOrigin ? eng.view.getVisibleOrigin() : { x: 0, y: 0 };
        const visibleSize = eng.view.getVisibleSize ? eng.view.getVisibleSize() : { width: frameSize.width, height: frameSize.height };
        const clientX = rect.left + (screenPt.x - visibleOrigin.x) * (rect.width / visibleSize.width);
        const clientY = rect.bottom - (screenPt.y - visibleOrigin.y) * (rect.height / visibleSize.height);
        function dispatchNativeEvent(type, cx, cy) {
          let dispatched = false;
          try {
            const evt = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0 });
            canvas.dispatchEvent(evt);
            dispatched = true;
          } catch (e) {
          }
          try {
            const touchMap = { "mousedown": "touchstart", "mousemove": "touchmove", "mouseup": "touchend" };
            const tType = touchMap[type];
            if (tType && typeof Touch !== "undefined" && typeof TouchEvent !== "undefined") {
              const touch = new Touch({ identifier: 0, target: canvas, clientX: cx, clientY: cy });
              const touchEvt = new TouchEvent(tType, {
                bubbles: true,
                cancelable: true,
                touches: [touch],
                targetTouches: [touch],
                changedTouches: [touch]
              });
              canvas.dispatchEvent(touchEvt);
            }
          } catch (e) {
          }
        }
        const mode = args && args.inputType ? args.inputType : "click";
        const duration = Math.min(args && args.duration ? args.duration : 100, 3e3);
        try {
          initVisualFeedbackStyle();
        } catch (e) {
        }
        dispatchNativeEvent("mousedown", clientX, clientY);
        let visualPointer = document.createElement("div");
        visualPointer.className = "mcp-visual-base";
        visualPointer.style.left = clientX + "px";
        visualPointer.style.top = clientY + "px";
        document.body.appendChild(visualPointer);
        if (mode === "click") {
          visualPointer.className += " mcp-visual-click";
          setTimeout(function() {
            dispatchNativeEvent("mouseup", clientX, clientY);
          }, 50);
          setTimeout(function() {
            if (visualPointer && visualPointer.parentNode) visualPointer.parentNode.removeChild(visualPointer);
          }, 500);
        } else if (mode === "long_press") {
          visualPointer.className += " mcp-visual-long-press";
          visualPointer.style.animationDuration = duration + "ms";
          setTimeout(function() {
            dispatchNativeEvent("mouseup", clientX, clientY);
            if (visualPointer && visualPointer.parentNode) visualPointer.parentNode.removeChild(visualPointer);
          }, duration);
        } else if (mode === "swipe") {
          let step2 = function() {
            let progress = (Date.now() - startTime) / duration;
            if (progress >= 1) {
              visualPointer.style.left = endX + "px";
              visualPointer.style.top = endY + "px";
              dispatchNativeEvent("mousemove", endX, endY);
              dispatchNativeEvent("mouseup", endX, endY);
              if (visualPointer && visualPointer.parentNode) visualPointer.parentNode.removeChild(visualPointer);
            } else {
              let curX = clientX + (endX - clientX) * progress;
              let curY = clientY + (endY - clientY) * progress;
              visualPointer.style.left = curX + "px";
              visualPointer.style.top = curY + "px";
              dispatchNativeEvent("mousemove", curX, curY);
              requestAnimationFrame(step2);
            }
          };
          var step = step2;
          visualPointer.className += " mcp-visual-swipe";
          const endX = clientX + (args && args.swipeDeltaX ? args.swipeDeltaX : 0);
          const endY = clientY - (args && args.swipeDeltaY ? args.swipeDeltaY : 0);
          let startTime = Date.now();
          requestAnimationFrame(step2);
        }
        return { success: true, msg: "Simulated " + mode + " from " + targetSource + " -> Screen DOM (" + Math.round(clientX) + "px, " + Math.round(clientY) + "px)" };
      },
      exportNodeAsPsdData: function(uuid) {
        const rootNode = this.findNodeByUuid(uuid);
        if (!rootNode) return null;
        const exportList = [];
        const rootWidth = rootNode.width;
        const rootHeight = rootNode.height;
        const rootAnchorX = rootNode.anchorX;
        const rootAnchorY = rootNode.anchorY;
        function getTextureCanvasOrImage(texture) {
          if (!texture) return null;
          const img = texture.getHtmlElementObj && texture.getHtmlElementObj() || texture.getHtmlElement && texture.getHtmlElement() || texture.image;
          if (img) {
            const isValid = img.width > 0 && img.height > 0 && img.naturalWidth !== 0;
            if (isValid) {
              return img;
            }
          }
          try {
            const eng = window.cc;
            const gl = eng.game._renderContext;
            if (!gl) return null;
            const textureImpl = texture._texture || texture.getHtmlElementObj && texture.getHtmlElementObj();
            if (!textureImpl) return null;
            const glID = textureImpl._glID || texture._glID;
            if (!glID) return null;
            const fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, glID, 0);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
              gl.bindFramebuffer(gl.FRAMEBUFFER, null);
              gl.deleteFramebuffer(fbo);
              return null;
            }
            const w = texture.width;
            const h = texture.height;
            const pixels = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(fbo);
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            const imgData = ctx.createImageData(w, h);
            imgData.data.set(pixels);
            ctx.putImageData(imgData, 0, 0);
            return canvas;
          } catch (e) {
            return null;
          }
        }
        function getSpineWorldBounds(node) {
          const eng = window.cc;
          const spineComp = node.getComponent(eng.sp ? eng.sp.Skeleton : null) || node.getComponent(eng.dragonBones ? eng.dragonBones.ArmatureDisplay : null);
          if (!spineComp) return null;
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          try {
            if (typeof spineComp._updateRenderData === "function") {
              spineComp._updateRenderData();
            }
            const skel = spineComp._skeleton;
            if (skel && skel.slots) {
              for (let i = 0; i < skel.slots.length; i++) {
                const slot = skel.slots[i];
                if (!slot || slot.bone && slot.bone.active === false) continue;
                const attachment = slot.getAttachment ? slot.getAttachment() : slot.attachment;
                if (!attachment) continue;
                let verts = new Float32Array(8);
                if (typeof attachment.computeWorldVertices === "function") {
                  attachment.computeWorldVertices(slot, 0, 8, verts, 0, 2);
                  for (let j = 0; j < verts.length; j += 2) {
                    const vx = verts[j];
                    const vy = verts[j + 1];
                    if (!isNaN(vx) && !isNaN(vy) && isFinite(vx) && isFinite(vy)) {
                      minX = Math.min(minX, vx);
                      maxX = Math.max(maxX, vx);
                      minY = Math.min(minY, vy);
                      maxY = Math.max(maxY, vy);
                    }
                  }
                }
              }
            }
          } catch (e) {
          }
          if (minX < maxX && minY < maxY && isFinite(minX) && isFinite(maxX)) {
            const blWorld = node.convertToWorldSpaceAR(eng.v2(minX, minY));
            const trWorld = node.convertToWorldSpaceAR(eng.v2(maxX, maxY));
            const brWorld = node.convertToWorldSpaceAR(eng.v2(maxX, minY));
            const tlWorld = node.convertToWorldSpaceAR(eng.v2(minX, maxY));
            const wx = Math.min(blWorld.x, trWorld.x, brWorld.x, tlWorld.x);
            const wy = Math.min(blWorld.y, trWorld.y, brWorld.y, tlWorld.y);
            const ww = Math.max(blWorld.x, trWorld.x, brWorld.x, tlWorld.x) - wx;
            const wh = Math.max(blWorld.y, trWorld.y, brWorld.y, tlWorld.y) - wy;
            return new eng.Rect(wx, wy, ww, wh);
          }
          if (typeof node.getBoundingBoxToWorld === "function") {
            try {
              const box = node.getBoundingBoxToWorld();
              if (box && box.width > 2 && box.height > 2) return box;
            } catch (e) {
            }
          }
          return null;
        }
        function getRelativeTransform(node) {
          const eng = window.cc;
          const spineComp = node.getComponent(eng.sp ? eng.sp.Skeleton : null) || node.getComponent(eng.dragonBones ? eng.dragonBones.ArmatureDisplay : null);
          if (spineComp) {
            const wBox = getSpineWorldBounds(node);
            if (wBox && wBox.width > 2 && wBox.height > 2) {
              const blWorld = eng.v2(wBox.x, wBox.y);
              const trWorld = eng.v2(wBox.x + wBox.width, wBox.y + wBox.height);
              const blLocal2 = rootNode.convertToNodeSpaceAR(blWorld);
              const trLocal2 = rootNode.convertToNodeSpaceAR(trWorld);
              const toPsd2 = (pt) => ({
                x: pt.x + rootAnchorX * rootWidth,
                y: rootHeight - (pt.y + rootAnchorY * rootHeight)
              });
              const blPsd2 = toPsd2(blLocal2);
              const trPsd2 = toPsd2(trLocal2);
              const left2 = Math.min(blPsd2.x, trPsd2.x);
              const top2 = Math.min(blPsd2.y, trPsd2.y);
              const right2 = Math.max(blPsd2.x, trPsd2.x);
              const bottom2 = Math.max(blPsd2.y, trPsd2.y);
              return {
                box: {
                  left: Math.round(left2),
                  top: Math.round(top2),
                  width: Math.round(Math.max(1, right2 - left2)),
                  height: Math.round(Math.max(1, bottom2 - top2))
                },
                angle: 0,
                scaleX: 1,
                scaleY: 1
              };
            }
          }
          let width = node.width || 0;
          let height = node.height || 0;
          const ax = node.anchorX !== void 0 ? node.anchorX : 0.5;
          const ay = node.anchorY !== void 0 ? node.anchorY : 0.5;
          const ptLeft = -ax * width;
          const ptRight = (1 - ax) * width;
          const ptBottom = -ay * height;
          const ptTop = (1 - ay) * height;
          const bl = node.convertToWorldSpaceAR(eng.v2(ptLeft, ptBottom));
          const br = node.convertToWorldSpaceAR(eng.v2(ptRight, ptBottom));
          const tr = node.convertToWorldSpaceAR(eng.v2(ptRight, ptTop));
          const tl = node.convertToWorldSpaceAR(eng.v2(ptLeft, ptTop));
          const blLocal = rootNode.convertToNodeSpaceAR(bl);
          const brLocal = rootNode.convertToNodeSpaceAR(br);
          const trLocal = rootNode.convertToNodeSpaceAR(tr);
          const tlLocal = rootNode.convertToNodeSpaceAR(tl);
          const toPsd = (pt) => ({
            x: pt.x + rootAnchorX * rootWidth,
            y: rootHeight - (pt.y + rootAnchorY * rootHeight)
          });
          const blPsd = toPsd(blLocal);
          const brPsd = toPsd(brLocal);
          const trPsd = toPsd(trLocal);
          const tlPsd = toPsd(tlLocal);
          const left = Math.min(blPsd.x, brPsd.x, trPsd.x, tlPsd.x);
          const top = Math.min(blPsd.y, brPsd.y, trPsd.y, tlPsd.y);
          const right = Math.max(blPsd.x, brPsd.x, trPsd.x, tlPsd.x);
          const bottom = Math.max(blPsd.y, brPsd.y, trPsd.y, tlPsd.y);
          let localScaleX = 1;
          let localScaleY = 1;
          if ("scale" in node && typeof node.scale === "object") {
            localScaleX = node.scale.x;
            localScaleY = node.scale.y;
          } else {
            localScaleX = node.scaleX !== void 0 ? node.scaleX : 1;
            localScaleY = node.scaleY !== void 0 ? node.scaleY : 1;
          }
          const signX = Math.sign(localScaleX) || 1;
          const signY = Math.sign(localScaleY) || 1;
          const dx = (brPsd.x - blPsd.x) * signX;
          const dy = (brPsd.y - blPsd.y) * signX;
          const angleRelative = Math.atan2(dy, dx);
          const lenX = Math.sqrt(dx * dx + dy * dy);
          const scaleXRelative = width > 0 ? lenX / width : 1;
          const dyY = (tlPsd.y - blPsd.y) * signY;
          const dxY = (tlPsd.x - blPsd.x) * signY;
          const lenY = Math.sqrt(dxY * dxY + dyY * dyY);
          const scaleYRelative = height > 0 ? lenY / height : 1;
          const sx = localScaleX < 0 ? -scaleXRelative : scaleXRelative;
          const sy = localScaleY < 0 ? -scaleYRelative : scaleYRelative;
          return {
            box: {
              left: Math.round(left),
              top: Math.round(top),
              width: Math.round(Math.max(1, right - left)),
              height: Math.round(Math.max(1, bottom - top))
            },
            angle: angleRelative,
            scaleX: sx,
            scaleY: sy
          };
        }
        function rasterizeSprite(sprite, transform) {
          if (!sprite || !sprite.spriteFrame) return null;
          const spriteFrame = sprite.spriteFrame;
          const texture = spriteFrame.getTexture();
          if (!texture) return null;
          const img = getTextureCanvasOrImage(texture);
          if (!img) return null;
          const { box, angle, scaleX, scaleY } = transform;
          const canvas = document.createElement("canvas");
          canvas.width = box.width;
          canvas.height = box.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          const rect = spriteFrame.getRect();
          const rotated = spriteFrame.isRotated();
          const offset = spriteFrame.getOffset();
          const originalSize = spriteFrame.getOriginalSize();
          const useTrim = sprite.trim && sprite.type !== 1;
          const tempCanvas = document.createElement("canvas");
          const tempCtx = tempCanvas.getContext("2d");
          if (!tempCtx) return null;
          if (useTrim) {
            const origW = Math.max(2, originalSize.width) || 2;
            const origH = Math.max(2, originalSize.height) || 2;
            tempCanvas.width = origW;
            tempCanvas.height = origH;
            tempCtx.save();
            if (rotated) {
              const cx = origW / 2 + offset.x;
              const cy = origH / 2 - offset.y;
              tempCtx.translate(cx, cy);
              tempCtx.rotate(-Math.PI / 2);
              tempCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, -rect.height / 2, -rect.width / 2, rect.height, rect.width);
            } else {
              const dx = origW / 2 - rect.width / 2 + offset.x;
              const dy = origH / 2 - rect.height / 2 - offset.y;
              tempCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, dx, dy, rect.width, rect.height);
            }
            tempCtx.restore();
          } else {
            const unrotatedW = rotated ? rect.height : rect.width;
            const unrotatedH = rotated ? rect.width : rect.height;
            const rectW = Math.max(2, unrotatedW) || 2;
            const rectH = Math.max(2, unrotatedH) || 2;
            tempCanvas.width = rectW;
            tempCanvas.height = rectH;
            tempCtx.save();
            if (rotated) {
              tempCtx.translate(rectW / 2, rectH / 2);
              tempCtx.rotate(-Math.PI / 2);
              tempCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, -rect.height / 2, -rect.width / 2, rect.height, rect.width);
            } else {
              tempCtx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
            }
            tempCtx.restore();
          }
          const nodeWorldCenter = sprite.node.convertToWorldSpaceAR(window.cc.v2(0, 0));
          const nodeLocalCenter = rootNode.convertToNodeSpaceAR(nodeWorldCenter);
          const nodePsdCenter = {
            x: nodeLocalCenter.x + rootAnchorX * rootWidth,
            y: rootHeight - (nodeLocalCenter.y + rootAnchorY * rootHeight)
          };
          const rx = nodePsdCenter.x - box.left;
          const ry = nodePsdCenter.y - box.top;
          ctx.translate(rx, ry);
          ctx.rotate(angle);
          ctx.scale(scaleX, scaleY);
          const ax = sprite.node.anchorX;
          const ay = sprite.node.anchorY;
          ctx.globalAlpha = (sprite.node.opacity !== void 0 ? sprite.node.opacity : 255) / 255;
          const drawW = sprite.node.width;
          const drawH = sprite.node.height;
          function drawNineSlice(targetCtx, srcCanvas, w, h, ax2, ay2, insetL, insetR, insetT, insetB) {
            const imgW = srcCanvas.width;
            const imgH = srcCanvas.height;
            const x0 = -ax2 * w;
            const y0 = -(1 - ay2) * h;
            const trimLeft = Math.max(0, originalSize.width / 2 - rect.width / 2 + offset.x);
            const trimRight = Math.max(0, originalSize.width / 2 - rect.width / 2 - offset.x);
            const trimTop = Math.max(0, originalSize.height / 2 - rect.height / 2 - offset.y);
            const trimBottom = Math.max(0, originalSize.height / 2 - rect.height / 2 + offset.y);
            const effectiveInsetL = Math.max(0, insetL - trimLeft);
            const effectiveInsetR = Math.max(0, insetR - trimRight);
            const effectiveInsetT = Math.max(0, insetT - trimTop);
            const effectiveInsetB = Math.max(0, insetB - trimBottom);
            let sL = effectiveInsetL;
            let sR = effectiveInsetR;
            if (sL + sR >= imgW && sL + sR > 0) {
              const ratio = imgW / (sL + sR);
              sL = Math.floor(sL * ratio);
              sR = imgW - sL;
            }
            const srcX0 = 0;
            const srcX1 = sL;
            const srcX2 = Math.max(sL, imgW - sR);
            const srcX3 = imgW;
            let sT = effectiveInsetT;
            let sB = effectiveInsetB;
            if (sT + sB >= imgH && sT + sB > 0) {
              const ratio = imgH / (sT + sB);
              sT = Math.floor(sT * ratio);
              sB = imgH - sT;
            }
            const srcY0 = 0;
            const srcY1 = sT;
            const srcY2 = Math.max(sT, imgH - sB);
            const srcY3 = imgH;
            let dL = insetL;
            let dR = insetR;
            if (dL + dR > w && dL + dR > 0) {
              const ratio = w / (dL + dR);
              dL = dL * ratio;
              dR = w - dL;
            }
            const dstX0 = x0;
            const dstX1 = x0 + dL;
            const dstX2 = x0 + w - dR;
            const dstX3 = x0 + w;
            let dT = insetT;
            let dB = insetB;
            if (dT + dB > h && dT + dB > 0) {
              const ratio = h / (dT + dB);
              dT = dT * ratio;
              dB = h - dT;
            }
            const dstY0 = y0;
            const dstY1 = y0 + dT;
            const dstY2 = y0 + h - dB;
            const dstY3 = y0 + h;
            const sXs = [[srcX0, srcX1], [srcX1, Math.max(srcX1 + 1, srcX2)], [srcX2, srcX3]];
            const sYs = [[srcY0, srcY1], [srcY1, Math.max(srcY1 + 1, srcY2)], [srcY2, srcY3]];
            const dXs = [[dstX0, dstX1], [dstX1, dstX2], [dstX2, dstX3]];
            const dYs = [[dstY0, dstY1], [dstY1, dstY2], [dstY2, dstY3]];
            for (let row = 0; row < 3; row++) {
              const [sy1, sy2] = sYs[row];
              const [dy1, dy2] = dYs[row];
              const sh = sy2 - sy1;
              const dh = dy2 - dy1;
              if (sh <= 0 || dh <= 0) continue;
              for (let col = 0; col < 3; col++) {
                const [sx1, sx2] = sXs[col];
                const [dx1, dx2] = dXs[col];
                const sw = sx2 - sx1;
                const dw = dx2 - dx1;
                if (sw > 0 && dw > 0) {
                  targetCtx.drawImage(srcCanvas, sx1, sy1, sw, sh, dx1, dy1, dw, dh);
                }
              }
            }
          }
          const isSliced = sprite.type === 1;
          const hasInsets = spriteFrame.insetLeft > 0 || spriteFrame.insetRight > 0 || spriteFrame.insetTop > 0 || spriteFrame.insetBottom > 0;
          if (isSliced && hasInsets) {
            drawNineSlice(
              ctx,
              tempCanvas,
              drawW,
              drawH,
              ax,
              ay,
              spriteFrame.insetLeft,
              spriteFrame.insetRight,
              spriteFrame.insetTop,
              spriteFrame.insetBottom
            );
          } else {
            ctx.drawImage(tempCanvas, -ax * drawW, -(1 - ay) * drawH, drawW, drawH);
          }
          const color = sprite.node.color;
          if (color && (color.r !== 255 || color.g !== 255 || color.b !== 255)) {
            ctx.save();
            ctx.globalCompositeOperation = "source-atop";
            ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
            ctx.fillRect(-ax * drawW, -(1 - ay) * drawH, drawW, drawH);
            ctx.restore();
          }
          return canvas.toDataURL("image/png");
        }
        function rasterizeLabel(label, transform) {
          if (!label || !label.string) return null;
          const { box, angle, scaleX, scaleY } = transform;
          const canvas = document.createElement("canvas");
          canvas.width = box.width;
          canvas.height = box.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) return null;
          const nodeWorldCenter = label.node.convertToWorldSpaceAR(window.cc.v2(0, 0));
          const nodeLocalCenter = rootNode.convertToNodeSpaceAR(nodeWorldCenter);
          const nodePsdCenter = {
            x: nodeLocalCenter.x + rootAnchorX * rootWidth,
            y: rootHeight - (nodeLocalCenter.y + rootAnchorY * rootHeight)
          };
          const rx = nodePsdCenter.x - box.left;
          const ry = nodePsdCenter.y - box.top;
          ctx.translate(rx, ry);
          ctx.rotate(angle);
          ctx.scale(scaleX, scaleY);
          const fontSize = label.fontSize || 20;
          let fontFamily = label.fontFamily || "Arial";
          if (label.font && !label.useSystemFont) {
            fontFamily = label.font._fontFamily || label.font.name || label.font._name || fontFamily;
          }
          ctx.font = `${fontSize}px ${fontFamily}`;
          let textX = 0;
          let textAlign = "center";
          const ax = label.node.anchorX !== void 0 ? label.node.anchorX : 0.5;
          const width = label.node.width || 0;
          if (label.horizontalAlign === 0) {
            textAlign = "left";
            textX = -ax * width;
          } else if (label.horizontalAlign === 2) {
            textAlign = "right";
            textX = (1 - ax) * width;
          } else {
            textAlign = "center";
            textX = (0.5 - ax) * width;
          }
          ctx.textAlign = textAlign;
          const ay = label.node.anchorY !== void 0 ? label.node.anchorY : 0.5;
          const height = label.node.height || 0;
          const lines = [];
          if (label.enableWrapText && label.overflow !== 0 && width > 0) {
            const rawString = label.string;
            let currentLine = "";
            for (let i = 0; i < rawString.length; i++) {
              const char = rawString[i];
              if (char === "\n") {
                lines.push(currentLine);
                currentLine = "";
                continue;
              }
              const testLine = currentLine + char;
              const metrics = ctx.measureText(testLine);
              if (metrics.width > width && currentLine !== "") {
                lines.push(currentLine);
                currentLine = char;
              } else {
                currentLine = testLine;
              }
            }
            if (currentLine !== "") {
              lines.push(currentLine);
            }
          } else {
            lines.push(...label.string.split("\n"));
          }
          const lineHeight = label.lineHeight || fontSize * 1.25;
          const totalHeight = lines.length * lineHeight;
          let startY = 0;
          const verticalAlign = label.verticalAlign;
          if (verticalAlign === 0) {
            startY = -(1 - ay) * height;
          } else if (verticalAlign === 2) {
            startY = ay * height - totalHeight;
          } else {
            startY = -(0.5 - ay) * height - totalHeight / 2;
          }
          ctx.textBaseline = "top";
          const color = label.node.color || { r: 255, g: 255, b: 255 };
          ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
          ctx.globalAlpha = (label.node.opacity !== void 0 ? label.node.opacity : 255) / 255;
          const outline = label.node.getComponent(window.cc.LabelOutline);
          for (let i = 0; i < lines.length; i++) {
            const lineY = startY + i * lineHeight;
            if (outline && outline.enabled) {
              ctx.strokeStyle = `rgb(${outline.color.r},${outline.color.g},${outline.color.b})`;
              ctx.lineWidth = outline.width * 2;
              ctx.strokeText(lines[i], textX, lineY);
            }
            ctx.fillText(lines[i], textX, lineY);
          }
          return canvas.toDataURL("image/png");
        }
        function rasterizeSkeletal(node, transform) {
          const eng = window.cc;
          const spineComp = node.getComponent(eng.sp ? eng.sp.Skeleton : null) || node.getComponent(eng.dragonBones ? eng.dragonBones.ArmatureDisplay : null);
          if (spineComp) {
            if (typeof spineComp._updateRenderData === "function") {
              try {
                spineComp._updateRenderData();
              } catch (e) {
              }
            }
          }
          let wBox = null;
          if (typeof node.getBoundingBoxToWorld === "function") {
            try {
              wBox = node.getBoundingBoxToWorld();
            } catch (e) {
            }
          }
          if (!wBox || wBox.width <= 2 || wBox.height <= 2) {
            const w = Math.max(2, Math.round(node.width)) || 100;
            const h = Math.max(2, Math.round(node.height)) || 100;
            const worldPos = node.convertToWorldSpaceAR(eng.v2(0, 0));
            wBox = new eng.Rect(worldPos.x - w / 2, worldPos.y - h / 2, w, h);
          }
          const width = Math.max(2, Math.round(wBox.width));
          const height = Math.max(2, Math.round(wBox.height));
          const scene = eng.director.getScene();
          if (!scene) return null;
          let cameraNode = null;
          let rt = null;
          try {
            cameraNode = new eng.Node("__mcp_temp_spine_camera");
            scene.addChild(cameraNode);
            const worldCenterX = wBox.x + wBox.width / 2;
            const worldCenterY = wBox.y + wBox.height / 2;
            cameraNode.setPosition(worldCenterX, worldCenterY);
            const camera = cameraNode.addComponent(eng.Camera);
            camera.ortho = true;
            camera.orthoSize = height / 2;
            camera.cullingMask = 4294967295;
            camera.clearFlags = eng.Camera.ClearFlags.COLOR;
            camera.backgroundColor = new eng.Color(0, 0, 0, 0);
            rt = new eng.RenderTexture();
            rt.initWithSize(width, height);
            camera.targetTexture = rt;
            camera.render(node);
            const pixels = rt.readPixels();
            if (!pixels || pixels.length === 0) return null;
            let hasAlpha = false;
            for (let i = 3; i < pixels.length; i += 4) {
              if (pixels[i] > 0) {
                hasAlpha = true;
                break;
              }
            }
            if (!hasAlpha) {
              return null;
            }
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            const imgData = ctx.createImageData(width, height);
            imgData.data.set(pixels);
            ctx.putImageData(imgData, 0, 0);
            const flipCanvas = document.createElement("canvas");
            flipCanvas.width = width;
            flipCanvas.height = height;
            const flipCtx = flipCanvas.getContext("2d");
            if (flipCtx) {
              flipCtx.translate(0, height);
              flipCtx.scale(1, -1);
              flipCtx.drawImage(canvas, 0, 0);
              return flipCanvas.toDataURL("image/png");
            }
            return canvas.toDataURL("image/png");
          } catch (e) {
            return null;
          } finally {
            if (cameraNode) {
              cameraNode.removeFromParent();
              cameraNode.destroy();
            }
            if (rt) {
              rt.destroy();
            }
          }
        }
        function traverse(node, results) {
          if (!node || node.active === false) return;
          let hasChildren = node.childrenCount > 0;
          let sprite = node.getComponent(window.cc.Sprite);
          let label = node.getComponent(window.cc.Label);
          let isSkeletal = false;
          const eng = window.cc;
          if (window.sp && window.sp.Skeleton && node.getComponent(window.sp.Skeleton)) {
            isSkeletal = true;
          } else if (window.dragonBones && window.dragonBones.ArmatureDisplay && node.getComponent(window.dragonBones.ArmatureDisplay)) {
            isSkeletal = true;
          } else {
            const comps = node._components || [];
            for (let i = 0; i < comps.length; i++) {
              if (comps[i] && comps[i].constructor) {
                const name = comps[i].constructor.name;
                if (name === "Skeleton" || name === "ArmatureDisplay") {
                  isSkeletal = true;
                  break;
                }
              }
            }
          }
          if (hasChildren && !isSkeletal) {
            results.push({
              name: node.name,
              type: "group",
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              opacity: node.opacity !== void 0 ? node.opacity : 255,
              visible: node.active !== false
            });
            if (sprite || label) {
              const transform = getRelativeTransform(node);
              let imgBase64 = null;
              if (sprite) {
                try {
                  imgBase64 = rasterizeSprite(sprite, transform);
                } catch (e) {
                }
              } else if (label) {
                try {
                  imgBase64 = rasterizeLabel(label, transform);
                } catch (e) {
                }
              }
              if (imgBase64) {
                results.push({
                  name: node.name + "_bg",
                  type: "image",
                  left: transform.box.left,
                  top: transform.box.top,
                  width: transform.box.width,
                  height: transform.box.height,
                  opacity: node.opacity !== void 0 ? node.opacity : 255,
                  visible: node.active !== false,
                  imageBase64: imgBase64
                });
              }
            }
            for (let i = 0; i < node.childrenCount; i++) {
              traverse(node.children[i], results);
            }
            results.push({
              name: node.name,
              type: "group_end",
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              opacity: 0,
              visible: false
            });
          } else {
            if (sprite || label || isSkeletal) {
              const transform = getRelativeTransform(node);
              let imgBase64 = null;
              if (isSkeletal) {
                try {
                  imgBase64 = rasterizeSkeletal(node, transform);
                } catch (e) {
                }
              } else if (sprite) {
                try {
                  imgBase64 = rasterizeSprite(sprite, transform);
                } catch (e) {
                }
              } else if (label) {
                try {
                  imgBase64 = rasterizeLabel(label, transform);
                } catch (e) {
                }
              }
              if (imgBase64) {
                results.push({
                  name: node.name,
                  type: "image",
                  left: transform.box.left,
                  top: transform.box.top,
                  width: transform.box.width,
                  height: transform.box.height,
                  opacity: node.opacity !== void 0 ? node.opacity : 255,
                  visible: node.active !== false,
                  imageBase64: imgBase64
                });
              }
            }
          }
        }
        traverse(rootNode, exportList);
        return JSON.stringify({
          width: Math.round(rootWidth),
          height: Math.round(rootHeight),
          layers: exportList
        });
      }
    };
  }

  // src/probe/highlighter.ts
  function initHighlighter() {
    window.__mcpHighlightData = {
      hoverId: null,
      selectId: null,
      hoverNode: null,
      hoverGraphics: null,
      selectNode: null,
      selectGraphics: null,
      rootNode: null,
      lastLoggedDrawID: null
    };
  }
  function startHighlighterHook() {
    Logger.log("[Highlighter] startHighlighterHook \u88AB\u89E6\u53D1\uFF0C\u51C6\u5907\u9996\u6B21\u8C03\u7528 _initHighlightLayer");
    _initHighlightLayer();
    if (window.cc && window.cc.director) {
      window.cc.director.on(window.cc.Director.EVENT_AFTER_SCENE_LAUNCH, () => {
        Logger.log("[Highlighter] EVENT_AFTER_SCENE_LAUNCH \u89E6\u53D1 \u2014 \u6E05\u9664\u65E7\u573A\u666F\u9009\u4E2D\u72B6\u6001");
        window.__mcpHighlightData.selectId = null;
        window.__mcpHighlightData.hoverId = null;
        _initHighlightLayer();
        if (window.__mcpInspector && window.__mcpInspector.sendClearSelection) {
          window.__mcpInspector.sendClearSelection();
        }
      });
      window.cc.director.on(window.cc.Director.EVENT_AFTER_UPDATE, () => {
        const heartBeat = (window.__mcpHighlightData._heartbeat || 0) + 1;
        window.__mcpHighlightData._heartbeat = heartBeat;
        if (heartBeat % 60 === 0) {
          Logger.log(`[Highlighter] \u5FC3\u8DF3: ${heartBeat}, selectId=${window.__mcpHighlightData.selectId}, hoverId=${window.__mcpHighlightData.hoverId}`);
        }
        const data = window.__mcpHighlightData;
        const eng = window.cc;
        if (!data.hoverGraphics || !data.hoverNode || !data.hoverNode.isValid || !data.selectGraphics || !data.selectNode || !data.selectNode.isValid) {
          if (data.selectNode && !data.selectNode.isValid && data.selectId) {
            Logger.log("[Highlighter] \u9009\u4E2D\u8282\u70B9\u5DF2\u9500\u6BC1\uFF0C\u6E05\u9664 selectId");
            data.selectId = null;
            if (window.__mcpInspector && window.__mcpInspector.sendClearSelection) {
              window.__mcpInspector.sendClearSelection();
            }
          }
          if (data.hoverNode && !data.hoverNode.isValid && data.hoverId) {
            data.hoverId = null;
          }
          if (eng && eng.director && eng.director.getScene()) {
            _initHighlightLayer();
          }
          return;
        }
        const hoverG = data.hoverGraphics;
        const selectG = data.selectGraphics;
        hoverG.clear();
        selectG.clear();
        function getAccurateWorldCorners(node) {
          if (!node || typeof node.convertToWorldSpaceAR !== "function") return null;
          const width = node.width || 0;
          const height = node.height || 0;
          const ax = node.anchorX !== void 0 ? node.anchorX : 0.5;
          const ay = node.anchorY !== void 0 ? node.anchorY : 0.5;
          const l = -ax * width;
          const b = -ay * height;
          const r = (1 - ax) * width;
          const t = (1 - ay) * height;
          const corners = [
            eng.v2(l, b),
            // bl
            eng.v2(r, b),
            // br
            eng.v2(r, t),
            // tr
            eng.v2(l, t)
            // tl
          ];
          const worldCorners = [];
          for (let i = 0; i < corners.length; i++) {
            const pt = node.convertToWorldSpaceAR(corners[i]);
            worldCorners.push(pt);
          }
          return worldCorners;
        }
        function drawNodeBox(uuid, g, isHover, graphicsNode) {
          if (!uuid) return;
          const target = window.__mcpCrawler ? window.__mcpCrawler.findNodeByUuid(uuid) : null;
          if (!target || !target.isValid || target === data.hoverNode || target === data.selectNode) return;
          let effectiveGroupIndex = target.groupIndex || 0;
          if (effectiveGroupIndex === 0) {
            let p = target.parent;
            while (p) {
              if (p.groupIndex !== 0 && p.groupIndex !== void 0) {
                effectiveGroupIndex = p.groupIndex;
                break;
              }
              p = p.parent;
            }
          }
          if (graphicsNode.groupIndex !== effectiveGroupIndex) {
            graphicsNode.groupIndex = effectiveGroupIndex;
          }
          if (isHover) {
            g.strokeColor = new eng.Color(0, 204, 255, 255);
            g.fillColor = new eng.Color(0, 204, 255, 40);
          } else {
            g.strokeColor = new eng.Color(255, 80, 0, 255);
            g.fillColor = new eng.Color(255, 80, 0, 80);
          }
          const width = target.width || 0;
          const height = target.height || 0;
          if (width === 0 && height === 0) {
            let center = eng.v2(0, 0);
            if (typeof target.convertToWorldSpaceAR === "function") {
              center = target.convertToWorldSpaceAR(center);
            }
            if (isNaN(center.x) || isNaN(center.y)) return;
            g.circle(center.x, center.y, 8);
            g.fill();
            g.moveTo(center.x - 12, center.y);
            g.lineTo(center.x + 12, center.y);
            g.moveTo(center.x, center.y - 12);
            g.lineTo(center.x, center.y + 12);
            g.stroke();
            return;
          }
          let worldCorners = getAccurateWorldCorners(target);
          if (worldCorners && (isNaN(worldCorners[0].x) || isNaN(worldCorners[0].y))) {
            worldCorners = null;
          }
          if (!worldCorners) return;
          if (!isHover && window.__mcpHighlightData && window.__mcpHighlightData.lastLoggedDrawID !== uuid) {
            window.__mcpHighlightData.lastLoggedDrawID = uuid;
            Logger.log(`[Highlight Render] Selecting Node: ${target.name} (${uuid})`);
            Logger.log(`[Highlight Render] Size: ${width}x${height}`);
            Logger.log(`[Highlight Render] W_P0: x=${worldCorners[0].x.toFixed(2)}, y=${worldCorners[0].y.toFixed(2)}`);
          }
          g.moveTo(worldCorners[0].x, worldCorners[0].y);
          g.lineTo(worldCorners[1].x, worldCorners[1].y);
          g.lineTo(worldCorners[2].x, worldCorners[2].y);
          g.lineTo(worldCorners[3].x, worldCorners[3].y);
          g.close();
          g.fill();
          g.stroke();
        }
        if (data.selectId) {
          drawNodeBox(data.selectId, selectG, false, data.selectNode);
        }
        if (data.hoverId && data.hoverId !== data.selectId) {
          drawNodeBox(data.hoverId, hoverG, true, data.hoverNode);
        }
      });
    }
  }
  function _initHighlightLayer() {
    Logger.log("[Highlighter] _initHighlightLayer \u89E6\u53D1\u8C03\u7528");
    try {
      let getOrCreateOverlay2 = function(name) {
        let existing = scene.getChildByName(name);
        if (existing) {
          let g = existing.getComponent(eng.Graphics);
          if (!g) g = existing.addComponent(eng.Graphics);
          existing.zIndex = eng.macro ? eng.macro.MAX_ZINDEX : 2147483647;
          return { node: existing, graphics: g };
        }
        const node = new eng.Node(name);
        node.setAnchorPoint(0, 0);
        node.setPosition(0, 0);
        const graphics = node.addComponent(eng.Graphics);
        graphics.lineWidth = 2;
        node.zIndex = eng.macro ? eng.macro.MAX_ZINDEX : 2147483647;
        scene.addChild(node);
        return { node, graphics };
      };
      var getOrCreateOverlay = getOrCreateOverlay2;
      const eng = window.cc;
      if (!eng || !eng.director) {
        Logger.warn("[Highlighter] _initHighlightLayer \u7EC8\u6B62\uFF1Awindow.cc \u6216 window.cc.director \u4E0D\u5B58\u5728");
        return;
      }
      const scene = eng.director.getScene();
      if (!scene) {
        Logger.warn("[Highlighter] _initHighlightLayer \u7EC8\u6B62\uFF1Adirector.getScene() \u8FD4\u56DE\u4E3A\u7A7A");
        return;
      }
      let root = scene.getChildByName("McpInspectorRoot");
      if (root) {
        Logger.log("[Highlighter] \u6E05\u7406\u5386\u53F2\u9057\u7559\u7684 McpInspectorRoot");
        root.destroy();
      }
      const oldCam = scene.getChildByName("InspectorCamera");
      if (oldCam) {
        oldCam.destroy();
      }
      const hover = getOrCreateOverlay2("__mcp_hover_overlay__");
      window.__mcpHighlightData.hoverNode = hover.node;
      window.__mcpHighlightData.hoverGraphics = hover.graphics;
      const select = getOrCreateOverlay2("__mcp_select_overlay__");
      window.__mcpHighlightData.selectNode = select.node;
      window.__mcpHighlightData.selectGraphics = select.graphics;
      Logger.log("[Highlighter] _initHighlightLayer \u5B8C\u6574\u6267\u884C\u6210\u529F\uFF0C\u76F8\u5173 Graphics \u5DE5\u5177\u5DF2\u5C31\u7EEA\uFF01");
    } catch (err) {
      console.error("[Highlighter] _initHighlightLayer \u6267\u884C\u4E2D\u53D1\u751F\u4E25\u91CD\u9519\u8BEF\u800C\u4E2D\u65AD\uFF01", err);
    }
  }

  // src/probe/mask-diag.ts
  var FRAME_TRACE_LIMIT = 240;
  var DS_FUNC_NAMES = {
    512: "NEVER",
    513: "LESS",
    514: "EQUAL",
    515: "LEQUAL",
    516: "GREATER",
    517: "NOTEQUAL",
    518: "GEQUAL",
    519: "ALWAYS"
  };
  var STENCIL_OP_NAMES = {
    0: "ZERO",
    7680: "KEEP",
    7681: "REPLACE",
    7682: "INCR",
    7683: "DECR",
    5386: "INVERT",
    34055: "INCR_WRAP",
    34056: "DECR_WRAP"
  };
  var GFX_STENCIL_TEST_NAMES = { 0: "DISABLE", 1: "ENABLE", 2: "INHERIT" };
  var MASK_TYPE_NAMES = { 0: "RECT", 1: "ELLIPSE", 2: "IMAGE_STENCIL" };
  var RENDER_COMP_KEYWORDS = [
    "Sprite",
    "Label",
    "RichText",
    "Graphics",
    "Skeleton",
    "Particle",
    "Mesh",
    "MotionStreak",
    "DragonBones",
    "Tiled",
    "VideoPlayer",
    "WebView"
  ];
  var state = {
    gl: null,
    glSource: "unknown",
    hooked: false,
    backup: null,
    frames: 0,
    frameStamp: 0,
    opsThisFrame: 0,
    opsLastFrame: 0,
    opsTotal: 0,
    framesWithOps: 0,
    traces: [],
    lastFrameTraces: [],
    directorBound: false
  };
  function safe(fn, fallback = null) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }
  function getEngine() {
    return safe(() => getCcEngine(), null);
  }
  function fmtFunc(v) {
    return DS_FUNC_NAMES[v] !== void 0 ? DS_FUNC_NAMES[v] : String(v);
  }
  function fmtOp(v) {
    return STENCIL_OP_NAMES[v] !== void 0 ? STENCIL_OP_NAMES[v] : String(v);
  }
  function getStore() {
    return safe(() => window.__mcpMaskDiagState = state, state);
  }
  function pushTrace(entry) {
    state.traces.push(entry);
    if (state.traces.length > FRAME_TRACE_LIMIT) state.traces.shift();
  }
  function installMaskDiagnostics(gl, source) {
    if (!gl || state.hooked || state.gl === gl) return;
    state.gl = gl;
    state.glSource = source || (() => {
      try {
        const ccEng = getEngine();
        if (ccEng && ccEng.game && ccEng.game._renderContext === gl) return "cc.game._renderContext";
        if (window.__mcpGLContext === gl) return "getContext-capture";
      } catch (e) {
      }
      return "unknown";
    })();
    state.hooked = true;
    const backup = {};
    const wrap = (name, recorder) => {
      const original = gl[name];
      if (typeof original !== "function") return;
      backup[name] = original;
      gl[name] = function(...args) {
        if (recorder) {
          try {
            recorder(args);
          } catch (e) {
          }
          state.opsThisFrame++;
          state.opsTotal++;
        }
        return original.apply(this, args);
      };
    };
    const record = (name, args, detail) => {
      const entry = {
        f: state.frameStamp,
        t: Math.round(performance.now()),
        c: name,
        d: detail
      };
      pushTrace(entry);
    };
    wrap("stencilFunc", (args) => record("stencilFunc", args, `func=${fmtFunc(args[0])} ref=${args[1]} mask=${args[2]}`));
    wrap("stencilFuncSeparate", (args) => record("stencilFuncSeparate", args, `face=${args[0]} func=${fmtFunc(args[1])} ref=${args[2]} mask=${args[3]}`));
    wrap("stencilOp", (args) => record("stencilOp", args, `fail=${fmtOp(args[0])} zfail=${fmtOp(args[1])} zpass=${fmtOp(args[2])}`));
    wrap("stencilOpSeparate", (args) => record("stencilOpSeparate", args, `face=${args[0]} fail=${fmtOp(args[1])} zfail=${fmtOp(args[2])} zpass=${fmtOp(args[3])}`));
    wrap("stencilMask", (args) => record("stencilMask", args, `mask=${args[0]}`));
    wrap("stencilMaskSeparate", (args) => record("stencilMaskSeparate", args, `face=${args[0]} mask=${args[1]}`));
    wrap("clearStencil", (args) => record("clearStencil", args, `s=${args[0]}`));
    const STENCIL_TEST = gl.STENCIL_TEST;
    const originalEnable = gl.enable;
    if (typeof originalEnable === "function") {
      backup.enable = originalEnable;
      gl.enable = function(cap) {
        if (cap === STENCIL_TEST) {
          state.opsThisFrame++;
          state.opsTotal++;
          pushTrace({ f: state.frameStamp, t: Math.round(performance.now()), c: "enable", d: "STENCIL_TEST" });
        }
        return originalEnable.apply(this, arguments);
      };
    }
    const originalDisable = gl.disable;
    if (typeof originalDisable === "function") {
      backup.disable = originalDisable;
      gl.disable = function(cap) {
        if (cap === STENCIL_TEST) {
          state.opsThisFrame++;
          state.opsTotal++;
          pushTrace({ f: state.frameStamp, t: Math.round(performance.now()), c: "disable", d: "STENCIL_TEST" });
        }
        return originalDisable.apply(this, arguments);
      };
    }
    const originalClear = gl.clear;
    if (typeof originalClear === "function") {
      backup.clear = originalClear;
      const STENCIL_BUFFER_BIT = gl.STENCIL_BUFFER_BIT;
      gl.clear = function(bits) {
        if (bits & STENCIL_BUFFER_BIT) {
          pushTrace({ f: state.frameStamp, t: Math.round(performance.now()), c: "clear", d: "STENCIL_BUFFER_BIT" });
        }
        return originalClear.apply(this, arguments);
      };
    }
    state.backup = backup;
    try {
      window.__mcpGLStencilRecorder = { state, backup };
      Logger.log("[McpMaskDiag] stencil \u65C1\u8DEF\u8BB0\u5F55\u5668\u5DF2\u6302\u8F7D\uFF08\u53EA\u8BFB\u900F\u4F20\uFF0C\u4E0D\u6539\u6E32\u67D3\u72B6\u6001\uFF09");
    } catch (e) {
    }
  }
  function restoreMaskDiagnostics() {
    if (!state.hooked || !state.gl || !state.backup) return false;
    const gl = state.gl;
    Object.keys(state.backup).forEach((name) => {
      try {
        gl[name] = state.backup[name];
      } catch (e) {
      }
    });
    state.backup = null;
    state.hooked = false;
    Logger.log("[McpMaskDiag] stencil \u65C1\u8DEF\u8BB0\u5F55\u5668\u5DF2\u8FD8\u539F");
    return true;
  }
  function bindDirectorFrames() {
    if (state.directorBound) return;
    const eng = getEngine();
    if (!eng || !eng.director || !eng.Director) return;
    state.directorBound = true;
    safe(() => {
      eng.director.on(eng.Director.EVENT_BEFORE_DRAW, () => {
        state.opsLastFrame = state.opsThisFrame;
        if (state.opsLastFrame > 0) {
          state.framesWithOps++;
          state.lastFrameTraces = state.traces.filter((t) => t.f === state.frameStamp);
        }
        state.opsThisFrame = 0;
        state.frameStamp++;
        state.frames++;
        if (state.traces.length > FRAME_TRACE_LIMIT / 2) {
          state.traces = state.traces.slice(-Math.floor(FRAME_TRACE_LIMIT / 2));
        }
      });
    });
  }
  function componentClassName(comp) {
    const eng = getEngine();
    let name = "";
    if (eng && eng.js && typeof eng.js.getClassName === "function") {
      name = safe(() => eng.js.getClassName(comp), "") || "";
    }
    if (!name) name = comp && (comp.name || comp.constructor && comp.constructor.name) || "";
    const m = String(name).match(/<(.+)>/);
    return m ? m[1] : String(name);
  }
  function isMaskComponent(comp) {
    if (!comp) return false;
    const eng = getEngine();
    if (eng && eng.Mask && safe(() => comp instanceof eng.Mask, false)) return true;
    return componentClassName(comp).indexOf("Mask") !== -1;
  }
  function isRenderComponent(comp) {
    const name = componentClassName(comp);
    if (!name) return false;
    for (let i = 0; i < RENDER_COMP_KEYWORDS.length; i++) {
      if (name.indexOf(RENDER_COMP_KEYWORDS[i]) !== -1) return true;
    }
    return false;
  }
  function getMaskType(mask) {
    const eng = getEngine();
    const typeMap = eng && eng.Mask && eng.Mask.Type ? eng.Mask.Type : null;
    const value = safe(() => mask.type, void 0);
    let name = MASK_TYPE_NAMES[value] || String(value);
    if (typeMap) {
      for (const key in typeMap) {
        if (typeMap[key] === value) {
          name = key;
          break;
        }
      }
    }
    return { value, name };
  }
  function readPassStencil(material) {
    return safe(() => {
      if (!material) return null;
      const rendererMat = material.effect || material._effect || material;
      const passes = rendererMat && (rendererMat._passes || rendererMat.passes);
      const pass = passes && passes[0];
      if (!pass) return null;
      return {
        test: GFX_STENCIL_TEST_NAMES[pass._stencilTest] || String(pass._stencilTest),
        func: fmtFunc(pass._stencilFuncFront),
        ref: pass._stencilRefFront,
        readMask: pass._stencilMaskFront,
        writeMask: pass._stencilWriteMaskFront,
        failOp: fmtOp(pass._stencilFailOpFront),
        zFailOp: fmtOp(pass._stencilZFailOpFront),
        zPassOp: fmtOp(pass._stencilZPassOpFront)
      };
    }, null);
  }
  function getSpriteFrameTextures(spriteFrame) {
    const eng = getEngine();
    return safe(() => {
      if (!spriteFrame) return null;
      const tex = spriteFrame.getTexture ? spriteFrame.getTexture() : spriteFrame._texture;
      const info = {
        loaded: typeof spriteFrame.textureLoaded === "function" ? !!spriteFrame.textureLoaded() : null,
        uuid: spriteFrame._uuid || spriteFrame.uuid || "",
        name: spriteFrame.name || spriteFrame._name || "",
        texture: null
      };
      if (tex) {
        info.texture = {
          uuid: tex._uuid || tex.uuid || "",
          name: tex.name || tex._name || "",
          width: tex.width || 0,
          height: tex.height || 0,
          isDynamicAtlas: !!tex._isDynamicAtlas,
          isRenderTexture: !!(eng && eng.RenderTexture && safe(() => tex instanceof eng.RenderTexture, false))
        };
      }
      return info;
    }, null);
  }
  function countDescendantRenderComponents(node, limit = 500) {
    let count = 0;
    let visited = 0;
    const walk = (n) => {
      if (!n || visited >= limit) return;
      visited++;
      const comps = n._components || [];
      for (let i = 0; i < comps.length; i++) {
        if (isRenderComponent(comps[i])) {
          count++;
          break;
        }
      }
      const children = n.children || [];
      for (let i = 0; i < children.length; i++) walk(children[i]);
    };
    walk(node);
    return count;
  }
  function buildNodePath(node) {
    const names = [];
    let cur = node;
    let guard = 0;
    while (cur && cur.name && guard < 40) {
      names.unshift(cur.name);
      cur = cur.parent;
      guard++;
    }
    return names.join("/");
  }
  function collectMasks() {
    const eng = getEngine();
    const scene = safe(() => eng.director.getScene(), null);
    if (!scene) return [];
    const result = [];
    const walk = (node, parentMaskDepth) => {
      if (!node || node.isValid === false) return;
      const comps = node._components || [];
      let maskComp = null;
      for (let i = 0; i < comps.length; i++) {
        if (isMaskComponent(comps[i])) {
          maskComp = comps[i];
          break;
        }
      }
      if (maskComp) {
        const type = getMaskType(maskComp);
        const spriteFrame = safe(() => maskComp.spriteFrame, null);
        const sfTextures = getSpriteFrameTextures(spriteFrame);
        const mainMaterial = safe(() => maskComp._materials && maskComp._materials[0] || null, null);
        const enableMaterial = safe(() => maskComp._enableMaterial || null, null);
        const clearMaterial = safe(() => maskComp._clearMaterial || null, null);
        const exitMaterial = safe(() => maskComp._exitMaterial || null, null);
        let textureMatches = null;
        if (type.name === "IMAGE_STENCIL" && spriteFrame) {
          const expected = safe(() => spriteFrame.getTexture(), null);
          const actual = safe(() => mainMaterial && mainMaterial.getProperty && mainMaterial.getProperty("texture"), null);
          if (expected && actual) {
            const a = expected._uuid || expected.uuid || expected.id;
            const b = actual._uuid || actual.uuid || actual.id;
            textureMatches = !!(a && b && a === b);
          }
        }
        const sameNodeRenderComps = [];
        for (let i = 0; i < comps.length; i++) {
          if (comps[i] !== maskComp && isRenderComponent(comps[i])) sameNodeRenderComps.push(componentClassName(comps[i]));
        }
        const cameras = eng && eng.Camera && eng.Camera.cameras ? eng.Camera.cameras : [];
        let renderedByCamera = null;
        if (cameras && cameras.length) {
          const group = safe(() => node.groupIndex, 0) || 0;
          renderedByCamera = false;
          for (let c = 0; c < cameras.length; c++) {
            const cam = cameras[c];
            if (!cam || cam.enabled === false) continue;
            if ((cam.cullingMask >>> 0 & 1 << group) !== 0) {
              renderedByCamera = true;
              break;
            }
          }
        }
        result.push({
          path: buildNodePath(node),
          uuid: safe(() => node.uuid, "") || "",
          active: safe(() => node.active !== false, null),
          activeInHierarchy: safe(() => node.activeInHierarchy !== false, null),
          enabled: safe(() => maskComp.enabled !== false, null),
          type: type.name,
          typeValue: type.value,
          inverted: safe(() => !!maskComp.inverted, false),
          alphaThreshold: safe(() => maskComp.alphaThreshold, null),
          nestingDepth: parentMaskDepth + 1,
          groupIndex: safe(() => node.groupIndex, null),
          renderedByCamera,
          spriteFrame: sfTextures,
          maskTextureMatchesSpriteFrame: textureMatches,
          materials: {
            main: !!mainMaterial,
            enable: !!enableMaterial,
            exit: !!exitMaterial,
            clear: !!clearMaterial
          },
          stencil: {
            main: readPassStencil(mainMaterial),
            enable: readPassStencil(enableMaterial),
            clear: readPassStencil(clearMaterial)
          },
          sameNodeRenderComponents: sameNodeRenderComps,
          descendantRenderComponents: countDescendantRenderComponents(node)
        });
      }
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) {
        walk(children[i], maskComp ? parentMaskDepth + 1 : parentMaskDepth);
      }
    };
    walk(scene, 0);
    return result;
  }
  function decodeStencilTrace(traces) {
    const writes = [];
    let lastTest = null;
    let enabled = null;
    for (let i = 0; i < traces.length; i++) {
      const t = traces[i];
      if (t.c === "enable" || t.c === "disable") {
        enabled = t.c === "enable";
        continue;
      }
      if (t.c === "stencilFunc" || t.c === "stencilFuncSeparate") {
        const func = t.c === "stencilFunc" ? t.d.match(/func=(\w+)/) : t.d.match(/func=(\w+)/);
        const ref = t.d.match(/ref=(-?\d+)/);
        const mask = t.d.match(/mask=(-?\d+)/);
        const funcName = func ? func[1] : "";
        if (funcName === "NEVER" && ref && mask) {
          writes.push({ func: funcName, ref: Number(ref[1]), mask: Number(mask[1]) });
        } else if (funcName === "EQUAL" && ref && mask) {
          lastTest = { func: funcName, ref: Number(ref[1]), mask: Number(mask[1]) };
        }
        continue;
      }
      if (t.c === "stencilOp" || t.c === "stencilOpSeparate") {
        const fail = t.d.match(/fail=(\w+)/);
        if (fail && writes.length) writes[writes.length - 1].failOp = fail[1];
      }
    }
    let refMatch = null;
    if (lastTest && writes.length) {
      let written = 0;
      for (let i = 0; i < writes.length; i++) {
        if (writes[i].failOp === "REPLACE") written |= writes[i].ref & writes[i].mask;
        else if (writes[i].failOp === "ZERO") written &= ~((writes[i].ref & writes[i].mask) >>> 0);
      }
      refMatch = (lastTest.ref & lastTest.mask) === (written & lastTest.mask);
    }
    return { enabled, writes, lastTest, refMatch };
  }
  function collectMaskReport() {
    const eng = getEngine();
    const gl = state.gl || safe(() => eng.game._renderContext, null);
    const masks = collectMasks();
    const attrs = safe(() => gl && gl.getContextAttributes ? gl.getContextAttributes() : null, null);
    const stencilBits = safe(() => gl ? gl.getParameter(gl.STENCIL_BITS) : null, null);
    const depthBits = safe(() => gl ? gl.getParameter(gl.DEPTH_BITS) : null, null);
    const contextLost = safe(() => gl && gl.isContextLost ? gl.isContextLost() : null, null);
    const renderType = safe(() => eng.game.renderType, null);
    const webglRenderType = safe(() => eng.game.RENDER_TYPE_WEBGL, 1);
    const probeInfo = safe(() => window.__mcpGLContextInfo || null, null);
    const lastFrame = state.lastFrameTraces && state.lastFrameTraces.length ? state.lastFrameTraces : state.traces;
    const lastFrameTrace = lastFrame.slice(-80).map((t) => `f${t.f} ${t.c} ${t.d}`);
    const decoded = decodeStencilTrace(lastFrame);
    const warnings = [];
    if (eng && renderType !== null && webglRenderType !== null && renderType !== webglRenderType) {
      warnings.push(`\u5F15\u64CE\u5F53\u524D\u4E0D\u662F WebGL \u6E32\u67D3\u6A21\u5F0F\uFF08renderType=${renderType}\uFF09\uFF0Ccc.Mask \u5728 Canvas \u6A21\u5F0F\u4E0B\u4E0D\u53D7\u652F\u6301`);
    }
    if (attrs && attrs.stencil === false) {
      warnings.push("WebGL \u4E0A\u4E0B\u6587\u7684 stencil \u5C5E\u6027\u4E3A false\uFF1A\u6A21\u677F\u7F13\u51B2\u7F3A\u5931\uFF0Ccc.Mask \u4F1A\u5931\u6548\uFF08\u6CE8\u610F\uFF1A\u65E0\u6A21\u677F\u7F13\u51B2\u65F6 clear-stencil \u7684\u5168\u5C4F\u767D\u8272\u77E9\u5F62\u4F1A\u901A\u8FC7\u6A21\u677F\u6D4B\u8BD5\uFF0C\u53EF\u80FD\u6574\u7247\u5237\u767D\uFF09");
    }
    if (stencilBits === 0) {
      warnings.push("gl.getParameter(STENCIL_BITS) = 0\uFF1A\u5F53\u524D\u5E27\u7F13\u51B2\u6CA1\u6709\u6A21\u677F\u4F4D\uFF0Ccc.Mask \u65E0\u6CD5\u5DE5\u4F5C");
    }
    if (stencilBits !== null && stencilBits > 0 && stencilBits < 8 && masks.length) {
      warnings.push(`STENCIL_BITS=${stencilBits}\uFF08\u5F15\u64CE\u6309 8 \u5C42\u906E\u7F69\u8BBE\u8BA1\uFF09\uFF0C\u5D4C\u5957\u906E\u7F69\u8D85\u8FC7 ${stencilBits} \u5C42\u4F1A\u88C1\u526A\u5F02\u5E38`);
    }
    if (contextLost) warnings.push("WebGL \u4E0A\u4E0B\u6587\u5DF2\u4E22\u5931\uFF08isContextLost=true\uFF09\uFF0C\u6240\u6709\u906E\u7F69\u72B6\u6001\u90FD\u4F1A\u5931\u6548");
    if (masks.length && state.frames > 30 && state.opsTotal === 0) {
      warnings.push(`\u573A\u666F\u4E2D\u5B58\u5728 ${masks.length} \u4E2A Mask\uFF0C\u4F46\u4ECE\u672A\u89C2\u5BDF\u5230\u4EFB\u4F55 stencil \u8C03\u7528\uFF08\u906E\u7F69\u53EF\u80FD\u6CA1\u6709\u8D70\u6A21\u677F\u8DEF\u5F84\uFF09`);
    } else if (masks.length && state.frames > 30 && state.opsLastFrame === 0) {
      warnings.push(`\u573A\u666F\u4E2D\u5B58\u5728 ${masks.length} \u4E2A Mask\uFF0C\u4F46\u4E0A\u4E00\u5E27\u6CA1\u6709\u4EFB\u4F55 stencil \u8C03\u7528\uFF08\u906E\u7F69\u53EF\u80FD\u88AB\u8DF3\u8FC7/\u672A\u6E32\u67D3\uFF09`);
    }
    if (decoded.lastTest && decoded.writes.length && decoded.refMatch === false) {
      warnings.push(`\u7591\u4F3C\u906E\u7F69\u5199\u5165\u4F4D\u4E0E\u6D4B\u8BD5\u4F4D\u4E0D\u5339\u914D\uFF1A\u6700\u540E\u6D4B\u8BD5 ref=${decoded.lastTest.ref}/mask=${decoded.lastTest.mask}\uFF0C\u5199\u5165\u6279\u6B21=${JSON.stringify(decoded.writes)}\u3002\u8FD9\u4F1A\u8BA9\u906E\u7F69\u5B50\u8282\u70B9\u6574\u4F53\u88AB\u88C1\u6389\uFF0C\u9732\u51FA\u7236\u7EA7\u5E95\u8272`);
    }
    masks.forEach((m) => {
      if (!m.materials.main || !m.materials.enable || !m.materials.clear) {
        warnings.push(`[${m.path}] Mask \u6750\u8D28\u4E0D\u5B8C\u6574\uFF08main/enable/clear=${m.materials.main}/${m.materials.enable}/${m.materials.clear}\uFF09\uFF0C\u4F1A\u89E6\u53D1 Error 9000 \u7C7B\u95EE\u9898`);
      }
      if (m.type === "IMAGE_STENCIL") {
        if (!m.spriteFrame || !m.spriteFrame.texture) {
          warnings.push(`[${m.path}] IMAGE_STENCIL \u906E\u7F69\u6CA1\u6709 spriteFrame/\u8D34\u56FE\uFF0Cstencil \u5F62\u72B6\u4E0D\u4F1A\u88AB\u5199\u5165`);
        } else if (m.spriteFrame.loaded === false) {
          warnings.push(`[${m.path}] IMAGE_STENCIL \u906E\u7F69\u8D34\u56FE\u5C1A\u672A\u52A0\u8F7D\u5B8C\u6210\uFF08textureLoaded=false\uFF09`);
        }
        if (m.maskTextureMatchesSpriteFrame === false) {
          warnings.push(`[${m.path}] \u906E\u7F69\u6750\u8D28\u4E0A\u7684\u8D34\u56FE\u4E0E spriteFrame \u5F53\u524D\u8D34\u56FE\u4E0D\u4E00\u81F4\uFF08\u52A8\u6001\u56FE\u96C6\u91CD\u6253\u5305\u540E\u6750\u8D28\u672A\u5237\u65B0\uFF09`);
        }
      }
      if (m.sameNodeRenderComponents.length) {
        warnings.push(`[${m.path}] Mask \u4E0E\u6E32\u67D3\u7EC4\u4EF6\u6302\u5728\u540C\u4E00\u8282\u70B9\uFF08${m.sameNodeRenderComponents.join(",")}\uFF09\uFF0C\u5B98\u65B9\u9650\u5236\u4F1A\u5BFC\u81F4\u906E\u7F69\u533A\u57DF\u663E\u793A\u4E3A\u767D\u5E95`);
      }
      if (m.renderedByCamera === false) {
        warnings.push(`[${m.path}] \u6CA1\u6709\u4EFB\u4F55\u542F\u7528\u7684\u76F8\u673A cullingMask \u5305\u542B\u8BE5\u8282\u70B9\u5206\u7EC4\uFF08groupIndex=${m.groupIndex}\uFF09\uFF0C\u5176\u5B50\u8282\u70B9\u4E0D\u4F1A\u88AB\u7ED8\u5236`);
      }
      if (m.activeInHierarchy === false) {
        warnings.push(`[${m.path}] Mask \u8282\u70B9\u5728\u5C42\u7EA7\u4E2D\u672A\u6FC0\u6D3B\uFF08activeInHierarchy=false\uFF09`);
      }
    });
    return {
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      engine: {
        version: safe(() => eng.ENGINE_VERSION, null),
        renderType,
        webglRenderType,
        isWebGL: renderType !== null && webglRenderType !== null ? renderType === webglRenderType : null,
        maskClassPresent: !!(eng && eng.Mask)
      },
      context: {
        attributes: attrs,
        stencilBits,
        depthBits,
        contextLost,
        versionString: safe(() => gl ? gl.getParameter(gl.VERSION) : null, null),
        rendererString: safe(() => gl ? gl.getParameter(gl.RENDERER) : null, null),
        probeSource: state.glSource || safe(() => window.__mcpGLContextSource || probeInfo && probeInfo.source || "unknown", "unknown"),
        capturedByProbe: probeInfo,
        hookedByProbe: state.hooked
      },
      stencil: {
        framesObserved: state.frames,
        opsTotal: state.opsTotal,
        opsLastFrame: state.opsLastFrame,
        framesWithOps: state.framesWithOps,
        lastFrameDecoded: decoded,
        lastFrameTrace
      },
      masks,
      warnings
    };
  }
  function formatMaskReport(report) {
    const lines = [];
    lines.push("==================== \u906E\u7F69(Mask)\u8BCA\u65AD\u62A5\u544A ====================");
    lines.push(`\u751F\u6210\u65F6\u95F4: ${report.generatedAt}`);
    const e = report.engine || {};
    lines.push(`\u5F15\u64CE: ${e.version || "?"} | renderType=${e.renderType} | WebGL\u6A21\u5F0F=${e.isWebGL} | cc.Mask=${e.maskClassPresent}`);
    const c = report.context || {};
    const attrs = c.attributes || {};
    lines.push(`\u4E0A\u4E0B\u6587: ${c.probeSource} | stencil\u5C5E\u6027=${attrs.stencil} | STENCIL_BITS=${c.stencilBits} | DEPTH_BITS=${c.depthBits} | lost=${c.contextLost}`);
    lines.push(`\u6E32\u67D3\u5668: ${c.rendererString} | ${c.versionString}`);
    if (c.capturedByProbe) {
      lines.push(`\u4E0A\u4E0B\u6587\u6355\u83B7: type=${c.capturedByProbe.type} canvas=#${c.capturedByProbe.canvasId} size=${c.capturedByProbe.canvasSize} \u8BF7\u6C42\u5C5E\u6027=${JSON.stringify(c.capturedByProbe.attrs)}`);
    }
    const s = report.stencil || {};
    lines.push(`stencil \u8C03\u7528: \u603B\u8BA1=${s.opsTotal} \u4E0A\u4E00\u5E27=${s.opsLastFrame} \u6709\u8C03\u7528\u7684\u5E27\u6570=${s.framesWithOps}/${s.framesObserved}`);
    const d = s.lastFrameDecoded || {};
    if (d.lastTest) {
      lines.push(`\u4E00\u5E27\u89E3\u7801: \u6D4B\u8BD5=${d.lastTest.func}(ref=${d.lastTest.ref},mask=${d.lastTest.mask}) \u5199\u5165\u6279\u6B21=${JSON.stringify(d.writes)} \u4F4D\u5339\u914D=${d.refMatch}`);
    }
    lines.push(`Mask \u6570\u91CF: ${report.masks.length}`);
    report.masks.forEach((m, idx) => {
      lines.push(`  [${idx}] ${m.path}`);
      lines.push(`      \u7C7B\u578B=${m.type} inverted=${m.inverted} alphaThreshold=${m.alphaThreshold} \u5D4C\u5957\u5C42=${m.nestingDepth} active=${m.active}/${m.activeInHierarchy} enabled=${m.enabled} group=${m.groupIndex} \u76F8\u673A\u53EF\u89C1=${m.renderedByCamera}`);
      lines.push(`      \u6750\u8D28 main/enable/exit/clear=${m.materials.main}/${m.materials.enable}/${m.materials.exit}/${m.materials.clear} | \u540C\u8282\u70B9\u6E32\u67D3\u7EC4\u4EF6=${m.sameNodeRenderComponents.length ? m.sameNodeRenderComponents.join(",") : "\u65E0"} | \u5B50\u6811\u6E32\u67D3\u7EC4\u4EF6=${m.descendantRenderComponents}`);
      if (m.spriteFrame) {
        lines.push(`      spriteFrame=${m.spriteFrame.name || m.spriteFrame.uuid} loaded=${m.spriteFrame.loaded} texture=${m.spriteFrame.texture ? (m.spriteFrame.texture.name || m.spriteFrame.texture.uuid) + " " + m.spriteFrame.texture.width + "x" + m.spriteFrame.texture.height + " atlas=" + m.spriteFrame.texture.isDynamicAtlas + " rt=" + m.spriteFrame.texture.isRenderTexture : "null"} \u8D34\u56FE\u4E00\u81F4=${m.maskTextureMatchesSpriteFrame}`);
      }
      if (m.stencil && m.stencil.enable) {
        const st = m.stencil.enable;
        lines.push(`      enable\u6750\u8D28\u6A21\u677F: test=${st.test} func=${st.func} ref=${st.ref} readMask=${st.readMask} writeMask=${st.writeMask} ops=${st.failOp}/${st.zFailOp}/${st.zPassOp}`);
      }
    });
    if (s.lastFrameTrace && s.lastFrameTrace.length) {
      lines.push("\u4E0A\u4E00\u5E27 stencil \u8C03\u7528\u5E8F\u5217:");
      s.lastFrameTrace.forEach((t) => lines.push(`  ${t}`));
    }
    if (report.warnings.length) {
      lines.push("\u26A0 \u544A\u8B66:");
      report.warnings.forEach((w) => lines.push(`  - ${w}`));
    } else {
      lines.push("\u672A\u53D1\u73B0\u6A21\u677F\u7F13\u51B2/\u6750\u8D28\u5C42\u9762\u7684\u786C\u6027\u5F02\u5E38\u3002\u82E5\u753B\u9762\u4ECD\u7136\u5F02\u5E38\uFF0C\u8BF7\u5BF9\u6BD4\u666E\u901A\u6D4F\u89C8\u5668\u9884\u89C8\uFF0C\u5E76\u5BF9\u540C\u4E00\u573A\u666F\u6267\u884C __mcpMaskDiag() \u6BD4\u5BF9\u62A5\u544A\u3002");
    }
    lines.push("===========================================================");
    return lines.join("\n");
  }
  function initMaskDiagnostics() {
    safe(() => getStore());
    const timer = setInterval(() => {
      safe(() => bindDirectorFrames());
      const eng = getEngine();
      if (eng && eng.director && !state.gl) {
        const gl = safe(() => window.__mcpGLContext || eng.game && eng.game._renderContext, null);
        if (gl) installMaskDiagnostics(gl);
      }
    }, 1e3);
    setTimeout(() => {
      try {
        clearInterval(timer);
      } catch (e) {
      }
    }, 3e4);
    safe(() => {
      window.__mcpMaskDiag = function(print = true) {
        const report = collectMaskReport();
        if (print) {
          try {
            console.log("[McpMaskDiag]\n" + formatMaskReport(report));
          } catch (e) {
          }
        }
        return JSON.stringify(report);
      };
      window.__mcpMaskDiagRestore = restoreMaskDiagnostics;
      window.__mcpMaskDiagHelp = function() {
        console.log("[McpMaskDiag] \u53EF\u7528\u547D\u4EE4\uFF1A\n  __mcpMaskDiag()        - \u6253\u5370\u5E76\u8FD4\u56DE\u5B8C\u6574\u906E\u7F69\u8BCA\u65AD\u62A5\u544A(JSON)\n  __mcpDisableGLHooks()  - \u8FD8\u539F\u672C\u63D2\u4EF6\u5168\u90E8 WebGL Hook\uFF08A/B \u6392\u67E5\uFF09\n  __mcpGLHookStatus()    - \u67E5\u770B Hook \u72B6\u6001\n  __mcpMaskDiagRestore() - \u4EC5\u8FD8\u539F stencil \u65C1\u8DEF\u8BB0\u5F55\u5668");
      };
    });
  }

  // src/probe/profiler.ts
  function initProfiler() {
    installContextCapture();
    let lastFrames = 0;
    let lastTime = Date.now();
    let currentFps = 0;
    let accumulatedLogicTime = 0;
    let accumulatedRenderTime = 0;
    let logicFrames = 0;
    let renderFrames = 0;
    let accumulatedGpuTime = 0;
    let gpuFrames = 0;
    let gpuStart = 0;
    let accumulatedShaderSwitches = 0;
    let accumulatedTextureBinds = 0;
    let accumulatedVertices = 0;
    let accumulatedTriangles = 0;
    let accumulatedPhysicsTime = 0;
    let physicsFrames = 0;
    let physicsStart = 0;
    let logicStart = 0;
    let renderStart = 0;
    const FRAME_TIME_WINDOW = 600;
    const frameDeltas = [];
    let lastFrameTime = 0;
    let isEventsHooked = false;
    let isWebGLHooked = false;
    let isPhysicsHooked = false;
    let frameShaderSwitches = 0;
    let frameTextureBinds = 0;
    let frameVertices = 0;
    let frameTriangles = 0;
    let frameDrawCalls = 0;
    const shaderSwitchDetails = /* @__PURE__ */ new Map();
    const textureBindDetails = /* @__PURE__ */ new Map();
    let shaderIdCounter = 0;
    let textureIdCounter = 0;
    let cachedGL = null;
    let rateShaderPerFrame = 0;
    let rateShaderPerSec = 0;
    let rateTexturePerFrame = 0;
    let rateTexturePerSec = 0;
    const textureToAssetMap = /* @__PURE__ */ new Map();
    const shaderToAssetMap = /* @__PURE__ */ new Map();
    const textureNameMap = /* @__PURE__ */ new Map();
    const shaderNameMap = /* @__PURE__ */ new Map();
    function buildAssetMapping() {
      const ccEng = getCcEngine();
      if (!ccEng || !ccEng.assetManager || !ccEng.assetManager.assets) return;
      try {
        ccEng.assetManager.assets.forEach((asset, uuid) => {
          if (!asset) return;
          const isTexture = asset instanceof ccEng.Texture2D || asset.constructor && asset.constructor.name === "Texture2D";
          if (isTexture) {
            const name = asset.name || "Unnamed";
            const findWebGLTexture = (obj, depth = 0) => {
              if (!obj || depth > 3) return null;
              if (obj.constructor && obj.constructor.name === "WebGLTexture") {
                return obj;
              }
              const props = ["_texture", "_webglObj", "_glTexture", "_glID", "texture", "_impl", "impl"];
              for (const prop of props) {
                if (obj[prop]) {
                  const result = findWebGLTexture(obj[prop], depth + 1);
                  if (result) return result;
                }
              }
              if (obj._glTexture !== void 0) {
                return obj._glTexture;
              }
              return null;
            };
            const webglTexture = findWebGLTexture(asset);
            if (webglTexture) {
              textureToAssetMap.set(webglTexture, {
                uuid,
                name,
                type: "Texture2D"
              });
            }
            if (asset._nativeAsset) {
              const nativeAsset = asset._nativeAsset;
              if (nativeAsset && nativeAsset.__uuid) {
              }
            }
          }
          const isSpriteFrame = asset instanceof ccEng.SpriteFrame || asset.constructor && asset.constructor.name === "SpriteFrame";
          if (isSpriteFrame) {
            const name = asset.name || "Unnamed";
            const tex = asset._texture || asset.getTexture && asset.getTexture();
            if (tex) {
              const findWebGLTexture = (obj, depth = 0) => {
                if (!obj || depth > 3) return null;
                if (obj.constructor && obj.constructor.name === "WebGLTexture") {
                  return obj;
                }
                const props = ["_texture", "_webglObj", "_glTexture", "_glID", "texture", "_impl", "impl"];
                for (const prop of props) {
                  if (obj[prop]) {
                    const result = findWebGLTexture(obj[prop], depth + 1);
                    if (result) return result;
                  }
                }
                return null;
              };
              const webglTexture = findWebGLTexture(tex);
              if (webglTexture) {
                textureToAssetMap.set(webglTexture, {
                  uuid,
                  name,
                  type: "SpriteFrame"
                });
              }
            }
          }
          const isMaterial = asset instanceof ccEng.Material || asset.constructor && asset.constructor.name === "Material";
          const isEffectAsset = asset instanceof ccEng.EffectAsset || asset.constructor && asset.constructor.name === "EffectAsset";
          if (isMaterial || isEffectAsset) {
            const name = asset.name || "Unnamed";
            const type = isMaterial ? "Material" : "EffectAsset";
            try {
              const effect = isMaterial ? asset._effect || asset.effect : asset;
              if (effect) {
                const techniques = effect._techniques || effect.techniques;
                if (techniques && Array.isArray(techniques)) {
                  for (const technique of techniques) {
                    const passes = technique.passes || technique._passes;
                    if (passes && Array.isArray(passes)) {
                      for (const pass of passes) {
                        const programKey = pass._programKey || pass.programKey;
                        if (programKey !== void 0 && programKey !== null) {
                          shaderToAssetMap.set(programKey, {
                            uuid,
                            name,
                            type
                          });
                        }
                      }
                    }
                  }
                }
              }
            } catch (e) {
            }
          }
        });
        if (window.__MCP_DEBUG__) {
          console.log("[Profiler] Asset mapping built:", {
            textures: textureToAssetMap.size,
            shaders: shaderToAssetMap.size
          });
        }
      } catch (e) {
        if (window.__MCP_DEBUG__) {
          console.warn("[Profiler] buildAssetMapping error:", e);
        }
      }
    }
    setInterval(buildAssetMapping, 5e3);
    setTimeout(buildAssetMapping, 1e3);
    let glHookTarget = null;
    let glHookBackup = null;
    let glHooksDisabled = false;
    let noContextWarned = false;
    const probeStartTime = Date.now();
    function installContextCapture() {
      if (window.__mcpContextCaptureHooked) return;
      window.__mcpContextCaptureHooked = true;
      try {
        const proto = HTMLCanvasElement.prototype;
        const originalGetContext = proto.getContext;
        proto.getContext = function(type, attrs) {
          const ctx = originalGetContext.apply(this, arguments);
          try {
            if (ctx && (type === "webgl" || type === "webgl2" || type === "experimental-webgl")) {
              const ccEng = getCcEngine();
              const engineGL = ccEng && ccEng.game ? ccEng.game._renderContext : null;
              const isGameCanvas = this.id === "GameCanvas" || ccEng && ccEng.game && ccEng.game.canvas === this;
              if (isGameCanvas || !window.__mcpGLContext) {
                window.__mcpGLContext = ctx;
                window.__mcpGLContextInfo = {
                  type,
                  attrs: attrs || null,
                  actual: typeof ctx.getContextAttributes === "function" ? ctx.getContextAttributes() : null,
                  canvasId: this.id || "",
                  canvasSize: this.width + "x" + this.height,
                  createdAt: Date.now(),
                  engineContextAssignedAtCapture: !!(engineGL && engineGL === ctx),
                  isGameCanvas: !!isGameCanvas
                };
              }
              if (typeof window.__mcpOnGLContextReady === "function") {
                try {
                  window.__mcpOnGLContextReady(ctx);
                } catch (e) {
                }
              }
            }
          } catch (e) {
          }
          return ctx;
        };
      } catch (e) {
      }
    }
    function resolveExistingGL() {
      try {
        const ccEng = getCcEngine();
        if (ccEng && ccEng.game && ccEng.game._renderContext) {
          return { gl: ccEng.game._renderContext, source: "cc.game._renderContext" };
        }
      } catch (e) {
      }
      if (window.__mcpGLContext) {
        return { gl: window.__mcpGLContext, source: "getContext-capture" };
      }
      return null;
    }
    function installGLHooks(gl) {
      const backup = {};
      backup.useProgram = gl.useProgram;
      const originalUseProgram = gl.useProgram.bind(gl);
      gl.useProgram = function(program) {
        frameShaderSwitches++;
        if (program) {
          let info = shaderSwitchDetails.get(program);
          if (!info) {
            info = { count: 0, lastUsed: 0, id: ++shaderIdCounter, frameCount: 0, perFrame: 0, perSec: 0 };
            shaderSwitchDetails.set(program, info);
            try {
              const ccEng = getCcEngine();
              if (ccEng && ccEng.renderer) {
                const mat = ccEng.renderer._material || ccEng.renderer._currentMaterial || ccEng.director && ccEng.director._scene;
                if (mat && mat._effect) {
                }
              }
            } catch (e) {
            }
          }
          info.count++;
          info.frameCount++;
          info.lastUsed = Date.now();
        }
        return originalUseProgram(program);
      };
      backup.createTexture = gl.createTexture;
      const originalCreateTexture = gl.createTexture.bind(gl);
      gl.createTexture = function() {
        const texture = originalCreateTexture();
        if (texture) {
          if (!texture.__mcpId) {
            texture.__mcpId = ++textureIdCounter;
          }
        }
        return texture;
      };
      backup.texImage2D = gl.texImage2D;
      const originalTexImage2D = gl.texImage2D.bind(gl);
      gl.texImage2D = function(...args) {
        const currentTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
        if (currentTexture && !textureToAssetMap.has(currentTexture)) {
          const source = args[5] || args[6];
          if (source) {
            const sourceInfo = {
              uuid: "",
              name: source.__assetName || source.src || "Unknown",
              type: source.constructor ? source.constructor.name : "Unknown"
            };
          }
        }
        return originalTexImage2D.apply(gl, args);
      };
      backup.bindTexture = gl.bindTexture;
      const originalBindTexture = gl.bindTexture.bind(gl);
      gl.bindTexture = function(target, texture) {
        if (texture) {
          frameTextureBinds++;
          if (!texture.__mcpId) {
            texture.__mcpId = ++textureIdCounter;
          }
          let info = textureBindDetails.get(texture);
          if (!info) {
            info = { count: 0, lastUsed: 0, size: "", id: texture.__mcpId, frameCount: 0, perFrame: 0, perSec: 0 };
            textureBindDetails.set(texture, info);
            if (window.__MCP_DEBUG__) {
              const isMapped = textureToAssetMap.has(texture);
              console.log(`[Profiler] New texture bound: #${info.id}, mapped=${isMapped}`);
            }
          }
          info.count++;
          info.frameCount++;
          info.lastUsed = Date.now();
          try {
            const level = 0;
            const width = gl.getTexLevelParameter(target, level, gl.TEXTURE_WIDTH);
            const height = gl.getTexLevelParameter(target, level, gl.TEXTURE_HEIGHT);
            if (width && height) info.size = `${width}x${height}`;
          } catch (e) {
          }
        }
        return originalBindTexture(target, texture);
      };
      backup.drawArrays = gl.drawArrays;
      const originalDrawArrays = gl.drawArrays.bind(gl);
      gl.drawArrays = function(mode, first, count) {
        frameDrawCalls++;
        frameVertices += count;
        if (mode === gl.TRIANGLES) frameTriangles += count / 3;
        else if (mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN) frameTriangles += Math.max(0, count - 2);
        return originalDrawArrays(mode, first, count);
      };
      backup.drawElements = gl.drawElements;
      const originalDrawElements = gl.drawElements.bind(gl);
      gl.drawElements = function(mode, count, type, offset) {
        frameDrawCalls++;
        frameVertices += count;
        if (mode === gl.TRIANGLES) frameTriangles += count / 3;
        else if (mode === gl.TRIANGLE_STRIP || mode === gl.TRIANGLE_FAN) frameTriangles += Math.max(0, count - 2);
        return originalDrawElements(mode, count, type, offset);
      };
      glHookBackup = backup;
      glHookTarget = gl;
    }
    function tryHookWebGL() {
      if (isWebGLHooked || glHooksDisabled) return;
      const resolved = resolveExistingGL();
      if (!resolved) {
        if (!noContextWarned && Date.now() - probeStartTime > 5e3) {
          noContextWarned = true;
          if (window.__MCP_DEBUG__) {
            console.log("[Profiler] \u6682\u672A\u83B7\u53D6\u5230\u5F15\u64CE WebGL \u4E0A\u4E0B\u6587\uFF0C\u6027\u80FD\u7EDF\u8BA1\u7B49\u5F85\u5F15\u64CE\u521D\u59CB\u5316\uFF08\u63A2\u9488\u4E0D\u4F1A\u4E3B\u52A8\u521B\u5EFA\u4E0A\u4E0B\u6587\uFF0C\u4EE5\u514D\u7834\u574F cc.Mask \u7684\u6A21\u677F\u7F13\u51B2\uFF09");
          }
        }
        return;
      }
      isWebGLHooked = true;
      cachedGL = resolved.gl;
      window.__mcpGLContextSource = resolved.source;
      installGLHooks(resolved.gl);
      try {
        installMaskDiagnostics(resolved.gl);
      } catch (e) {
      }
      const ctxAttrs = (() => {
        try {
          return resolved.gl.getContextAttributes ? resolved.gl.getContextAttributes() : null;
        } catch (e) {
          return null;
        }
      })();
      if (window.__MCP_DEBUG__) {
        console.log(`[Profiler] WebGL Hook \u5DF2\u6302\u8F7D | \u4E0A\u4E0B\u6587\u6765\u6E90: ${resolved.source} | stencil=${ctxAttrs ? ctxAttrs.stencil : "?"} | alpha=${ctxAttrs ? ctxAttrs.alpha : "?"} | premultipliedAlpha=${ctxAttrs ? ctxAttrs.premultipliedAlpha : "?"}`);
      }
      window.__mcpGLHookStatus = function() {
        return {
          hooked: !!glHookTarget && !glHooksDisabled,
          disabledByUser: glHooksDisabled,
          contextSource: resolved.source,
          contextIsEngineContext: (() => {
            try {
              const cc2 = getCcEngine();
              return !!(cc2 && cc2.game && cc2.game._renderContext === resolved.gl);
            } catch (e) {
              return false;
            }
          })(),
          contextInfo: window.__mcpGLContextInfo || null,
          contextAttributes: ctxAttrs,
          stencilBits: (() => {
            try {
              return resolved.gl.getParameter(resolved.gl.STENCIL_BITS);
            } catch (e) {
              return null;
            }
          })()
        };
      };
      window.__mcpDisableGLHooks = function() {
        if (!glHookTarget || !glHookBackup) {
          console.warn("[Profiler] \u5F53\u524D\u6CA1\u6709\u53EF\u8FD8\u539F\u7684 WebGL Hook");
          return false;
        }
        Object.keys(glHookBackup).forEach((name) => {
          try {
            glHookTarget[name] = glHookBackup[name];
          } catch (e) {
          }
        });
        try {
          restoreMaskDiagnostics();
        } catch (e) {
        }
        glHooksDisabled = true;
        isWebGLHooked = true;
        console.warn("[Profiler] \u5DF2\u8FD8\u539F\u5168\u90E8 WebGL Hook\uFF08A/B \u6392\u67E5\u6A21\u5F0F\uFF09\u3002\u82E5\u6B64\u65F6\u906E\u7F69\u7ACB\u5373\u6062\u590D\uFF0C\u8BF4\u660E\u95EE\u9898\u51FA\u5728 WebGL \u5305\u88C5\u5C42\uFF1B\u5237\u65B0\u9875\u9762\u5373\u53EF\u6062\u590D\u6027\u80FD\u7EDF\u8BA1\u3002");
        return true;
      };
    }
    function tryHookDirectorEvents() {
      if (isEventsHooked) return;
      const ccEng = getCcEngine();
      if (!ccEng || !ccEng.director) return;
      isEventsHooked = true;
      lastFrames = ccEng.director.getTotalFrames ? ccEng.director.getTotalFrames() : 0;
      ccEng.director.on(ccEng.Director.EVENT_BEFORE_UPDATE, () => {
        logicStart = performance.now();
        if (lastFrameTime > 0) {
          const delta = logicStart - lastFrameTime;
          frameDeltas.push(delta);
          if (frameDeltas.length > FRAME_TIME_WINDOW) frameDeltas.shift();
        }
        lastFrameTime = logicStart;
      });
      ccEng.director.on(ccEng.Director.EVENT_AFTER_UPDATE, () => {
        accumulatedLogicTime += performance.now() - logicStart;
        logicFrames++;
      });
      ccEng.director.on(ccEng.Director.EVENT_BEFORE_DRAW, () => {
        renderStart = performance.now();
        frameShaderSwitches = 0;
        frameTextureBinds = 0;
        frameVertices = 0;
        frameTriangles = 0;
        frameDrawCalls = 0;
      });
      ccEng.director.on(ccEng.Director.EVENT_AFTER_DRAW, () => {
        accumulatedRenderTime += performance.now() - renderStart;
        renderFrames++;
        accumulatedShaderSwitches += frameShaderSwitches;
        accumulatedTextureBinds += frameTextureBinds;
        accumulatedVertices += frameVertices;
        accumulatedTriangles += frameTriangles;
      });
      if (ccEng.PhysicsManager && ccEng.PhysicsManager.instance) {
        const pm = ccEng.PhysicsManager.instance;
        const originalStep = pm.step;
        pm.step = function(dt) {
          physicsStart = performance.now();
          const result = originalStep.apply(this, arguments);
          accumulatedPhysicsTime += performance.now() - physicsStart;
          physicsFrames++;
          return result;
        };
        isPhysicsHooked = true;
      }
    }
    tryHookDirectorEvents();
    tryHookWebGL();
    let displayLogicTime = 0;
    let displayRenderTime = 0;
    let displayGpuTime = 0;
    let displayShaderSwitches = 0;
    let displayTextureBinds = 0;
    let displayVertices = 0;
    let displayTriangles = 0;
    let displayPhysicsTime = 0;
    let displayJsHeapUsed = 0;
    let displayJsHeapTotal = 0;
    setInterval(() => {
      tryHookDirectorEvents();
      tryHookWebGL();
      const ccEng = getCcEngine();
      if (!ccEng || !ccEng.director) return;
      const now = Date.now();
      const frames = ccEng.director.getTotalFrames ? ccEng.director.getTotalFrames() : 0;
      const dt = (now - lastTime) / 1e3;
      if (dt > 0) {
        currentFps = Math.max(0, Math.round((frames - lastFrames) / dt));
      }
      lastTime = now;
      lastFrames = frames;
      displayLogicTime = logicFrames > 0 ? Number((accumulatedLogicTime / logicFrames).toFixed(2)) : 0;
      displayRenderTime = renderFrames > 0 ? Number((accumulatedRenderTime / renderFrames).toFixed(2)) : 0;
      displayGpuTime = gpuFrames > 0 ? Number((accumulatedGpuTime / gpuFrames).toFixed(2)) : 0;
      displayVertices = Math.round(accumulatedVertices / Math.max(renderFrames, 1));
      displayTriangles = Math.round(accumulatedTriangles / Math.max(renderFrames, 1));
      displayPhysicsTime = physicsFrames > 0 ? Number((accumulatedPhysicsTime / physicsFrames).toFixed(2)) : 0;
      const framesInWindow = Math.max(renderFrames, 1);
      const elapsedSec = dt > 0 ? dt : 0.5;
      rateShaderPerFrame = Number((accumulatedShaderSwitches / framesInWindow).toFixed(1));
      rateShaderPerSec = Math.round(accumulatedShaderSwitches / elapsedSec);
      rateTexturePerFrame = Number((accumulatedTextureBinds / framesInWindow).toFixed(1));
      rateTexturePerSec = Math.round(accumulatedTextureBinds / elapsedSec);
      displayShaderSwitches = rateShaderPerFrame;
      displayTextureBinds = rateTexturePerFrame;
      shaderSwitchDetails.forEach((info) => {
        info.perFrame = Number((info.frameCount / framesInWindow).toFixed(2));
        info.perSec = Math.round(info.frameCount / elapsedSec);
        info.frameCount = 0;
      });
      textureBindDetails.forEach((info) => {
        info.perFrame = Number((info.frameCount / framesInWindow).toFixed(2));
        info.perSec = Math.round(info.frameCount / elapsedSec);
        info.frameCount = 0;
      });
      if (typeof performance !== "undefined") {
        if (performance.memory) {
          displayJsHeapUsed = Math.round(performance.memory.usedJSHeapSize / 1024 / 1024 * 100) / 100;
          displayJsHeapTotal = Math.round(performance.memory.totalJSHeapSize / 1024 / 1024 * 100) / 100;
        } else if (typeof process !== "undefined" && process.memoryUsage) {
          try {
            const mem = process.memoryUsage();
            displayJsHeapUsed = Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100;
            displayJsHeapTotal = Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100;
          } catch (e) {
          }
        }
      }
      accumulatedLogicTime = 0;
      logicFrames = 0;
      accumulatedRenderTime = 0;
      renderFrames = 0;
      accumulatedGpuTime = 0;
      gpuFrames = 0;
      accumulatedShaderSwitches = 0;
      accumulatedTextureBinds = 0;
      accumulatedVertices = 0;
      accumulatedTriangles = 0;
      accumulatedPhysicsTime = 0;
      physicsFrames = 0;
    }, 500);
    window.__mcpProfilerTick = function() {
      let drawCall = frameDrawCalls;
      const ccEng = getCcEngine();
      try {
        if (drawCall === 0 && ccEng && ccEng.renderer && typeof ccEng.renderer.drawCalls !== "undefined") {
          drawCall = ccEng.renderer.drawCalls;
        }
      } catch (e) {
      }
      let avgFps = 0, fps1pLow = 0, fps01pLow = 0;
      if (frameDeltas.length > 30) {
        const sorted = [...frameDeltas].sort((a, b) => a - b);
        const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
        avgFps = Math.round(1e3 / avg * 10) / 10;
        const idx99 = Math.min(Math.ceil(sorted.length * 0.99) - 1, sorted.length - 1);
        const idx999 = Math.min(Math.ceil(sorted.length * 0.999) - 1, sorted.length - 1);
        fps1pLow = Math.round(1e3 / Math.max(sorted[idx99], 0.1));
        fps01pLow = Math.round(1e3 / Math.max(sorted[idx999], 0.1));
      }
      return {
        fps: currentFps,
        avgFps,
        fps1pLow,
        fps01pLow,
        drawCall,
        logicTime: displayLogicTime,
        renderTime: displayRenderTime,
        gpuTime: displayGpuTime,
        shaderSwitches: displayShaderSwitches,
        textureBinds: displayTextureBinds,
        vertices: displayVertices,
        triangles: displayTriangles,
        physicsTime: displayPhysicsTime,
        jsHeapUsed: displayJsHeapUsed,
        jsHeapTotal: displayJsHeapTotal
      };
    };
    window.__mcpCountNodes = function() {
      const ccEng = getCcEngine();
      const scene = ccEng ? ccEng.director.getScene() : null;
      if (!scene) return 0;
      function count(node) {
        let n = 1;
        if (node.children) {
          for (let i = 0; i < node.children.length; i++) {
            n += count(node.children[i]);
          }
        }
        return n;
      }
      return count(scene);
    };
    window.__mcpGetShaderTextureDetails = function() {
      let matchedCount = 0;
      let totalCount = 0;
      const shaders = Array.from(shaderSwitchDetails.entries()).map(([program, info]) => {
        totalCount++;
        const assetInfo = shaderToAssetMap.get(program);
        let name = `Shader #${info.id}`;
        let assetUuid = "";
        let assetName = "";
        let assetType = "";
        if (assetInfo) {
          matchedCount++;
          assetUuid = assetInfo.uuid;
          assetName = assetInfo.name;
          assetType = assetInfo.type;
          name = `${assetInfo.name}`;
        } else {
          try {
            if (cachedGL && program) {
              const attachedShaders = cachedGL.getAttachedShaders(program);
              if (attachedShaders && attachedShaders.length > 0) {
                const source = cachedGL.getShaderSource(attachedShaders[0]);
                if (source) {
                  let shaderName = "";
                  const defineMatch = source.match(/#define\s+(\w+)/);
                  if (defineMatch) {
                    shaderName = defineMatch[1];
                  }
                  if (!shaderName) {
                    if (source.indexOf("gl_Position") !== -1) {
                      shaderName = "Vertex";
                    } else if (source.indexOf("gl_FragColor") !== -1 || source.indexOf("gl_FragData") !== -1) {
                      shaderName = "Fragment";
                    }
                  }
                  if (!shaderName) {
                    if (source.indexOf("attribute") !== -1) {
                      shaderName = "Vertex";
                    } else if (source.indexOf("varying") !== -1 && source.indexOf("uniform") !== -1) {
                      shaderName = "Fragment";
                    }
                  }
                  if (shaderName) {
                    name = `${shaderName} Shader #${info.id}`;
                  } else {
                    name = `Shader #${info.id}`;
                  }
                }
              }
            }
          } catch (e) {
          }
        }
        return {
          id: name,
          rawId: info.id,
          count: info.count,
          perFrame: info.perFrame,
          perSec: info.perSec,
          lastUsed: info.lastUsed,
          assetUuid,
          assetName,
          assetType
        };
      }).sort((a, b) => b.perSec - a.perSec || b.count - a.count).slice(0, 50);
      const textures = Array.from(textureBindDetails.entries()).map(([texture, info]) => {
        totalCount++;
        const assetInfo = textureToAssetMap.get(texture);
        let name = `Texture #${info.id}`;
        let assetUuid = "";
        let assetName = "";
        let assetType = "";
        if (assetInfo) {
          matchedCount++;
          assetUuid = assetInfo.uuid;
          assetName = assetInfo.name;
          assetType = assetInfo.type;
          name = assetInfo.name;
        }
        return {
          id: name,
          rawId: info.id,
          count: info.count,
          perFrame: info.perFrame,
          perSec: info.perSec,
          size: info.size,
          lastUsed: info.lastUsed,
          assetUuid,
          assetName,
          assetType
        };
      }).sort((a, b) => b.perSec - a.perSec || b.count - a.count).slice(0, 50);
      if (window.__MCP_DEBUG__) {
        console.log(`[Profiler] ShaderTextureDetails: matched=${matchedCount}/${totalCount}, textureMap=${textureToAssetMap.size}, shaderMap=${shaderToAssetMap.size}`);
      }
      return {
        shaderCount: shaderSwitchDetails.size,
        textureCount: textureBindDetails.size,
        shaders,
        textures,
        summary: {
          // 实时速率（每帧 / 每秒）
          shaderPerFrame: rateShaderPerFrame,
          shaderPerSec: rateShaderPerSec,
          texturePerFrame: rateTexturePerFrame,
          texturePerSec: rateTexturePerSec
        }
      };
    };
    window.__mcpClearShaderTextureDetails = function() {
      shaderSwitchDetails.clear();
      textureBindDetails.clear();
      return { success: true };
    };
    window.__mcpGetFrameTimeline = function() {
      return {
        frameTimes: [...frameDeltas],
        capacity: FRAME_TIME_WINDOW
      };
    };
    const MEMORY_HISTORY_CAPACITY = 150;
    const memoryHistory = [];
    let leakDetectionBaseline = null;
    let leakDetectionSamples = [];
    const LEAK_DETECTION_WINDOW = 30;
    function sampleMemory() {
      const now = Date.now();
      let jsHeapUsed = 0;
      let jsHeapTotal = 0;
      if (typeof performance !== "undefined" && performance.memory) {
        jsHeapUsed = performance.memory.usedJSHeapSize;
        jsHeapTotal = performance.memory.totalJSHeapSize;
      } else if (typeof process !== "undefined" && process.memoryUsage) {
        try {
          const mem = process.memoryUsage();
          jsHeapUsed = mem.heapUsed;
          jsHeapTotal = mem.heapTotal;
        } catch (e) {
        }
      }
      let totalMemory = 0;
      try {
        const ccEng = getCcEngine();
        if (typeof window.__mcpGetMemoryRanking === "function") {
          const ranking = window.__mcpGetMemoryRanking();
          if (ranking && typeof ranking.totalMemory === "number") {
            totalMemory = ranking.totalMemory;
          }
        }
        if (totalMemory === 0 && ccEng && ccEng.assetManager && ccEng.assetManager.assets) {
          ccEng.assetManager.assets.forEach((asset, uuid) => {
            if (!asset) return;
            if (asset._nativeAsset && asset._nativeAsset.byteLength) {
              totalMemory += asset._nativeAsset.byteLength;
            }
          });
        }
      } catch (e) {
      }
      const sample = {
        time: now,
        jsHeapUsed,
        jsHeapTotal,
        totalMemory,
        nodeCount: 0
      };
      memoryHistory.push(sample);
      if (memoryHistory.length > MEMORY_HISTORY_CAPACITY) {
        memoryHistory.shift();
      }
      leakDetectionSamples.push({ time: now, jsHeapUsed, totalMemory });
      if (leakDetectionSamples.length > LEAK_DETECTION_WINDOW) {
        leakDetectionSamples.shift();
      }
      return sample;
    }
    window.__mcpGetMemoryTimeline = function() {
      return {
        history: [...memoryHistory],
        capacity: MEMORY_HISTORY_CAPACITY
      };
    };
    window.__mcpDetectMemoryLeak = function() {
      if (leakDetectionSamples.length < 10) {
        return { leakDetected: false, confidence: 0, trend: "insufficient_data", details: "\u91C7\u6837\u6570\u636E\u4E0D\u8DB3\uFF0C\u81F3\u5C11\u9700\u8981 10 \u4E2A\u6837\u672C" };
      }
      const n = leakDetectionSamples.length;
      const xs = leakDetectionSamples.map((_, i) => i);
      const ys = leakDetectionSamples.map((s) => s.jsHeapUsed);
      const sumX = xs.reduce((s, v) => s + v, 0);
      const sumY = ys.reduce((s, v) => s + v, 0);
      const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
      const sumX2 = xs.reduce((s, v) => s + v * v, 0);
      const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;
      const meanY = sumY / n;
      const ssTotal = ys.reduce((s, v) => s + (v - meanY) * (v - meanY), 0);
      const ssResidual = ys.reduce((s, y, i) => {
        const predicted = slope * xs[i] + intercept;
        return s + (y - predicted) * (y - predicted);
      }, 0);
      const rSquared = 1 - ssResidual / ssTotal;
      const slopeKB = slope / 1024;
      const isLeakDetected = slope > 1024 && rSquared > 0.7;
      let trend = "stable";
      if (Math.abs(slopeKB) > 10) {
        trend = slopeKB > 0 ? "increasing" : "decreasing";
      }
      const futurePredictedMB = (slope * n * 30 + intercept) / 1024 / 1024;
      return {
        leakDetected: isLeakDetected,
        confidence: Math.min(Math.max(rSquared, 0), 1),
        trend,
        slopeKBPerSample: Math.round(slopeKB * 100) / 100,
        rSquared: Math.round(rSquared * 1e3) / 1e3,
        futurePredictedMB: Math.round(futurePredictedMB * 100) / 100,
        sampleCount: n,
        details: isLeakDetected ? `\u68C0\u6D4B\u5230\u6F5C\u5728\u5185\u5B58\u6CC4\u6F0F\uFF1A\u6BCF\u91C7\u6837\u5468\u671F\u589E\u957F ${slopeKB.toFixed(2)} KB\uFF0C\u8D8B\u52BF\u62DF\u5408\u5EA6 ${(rSquared * 100).toFixed(1)}%` : `\u5185\u5B58\u8D8B\u52BF\u7A33\u5B9A\uFF0C\u589E\u957F\u7387 ${slopeKB.toFixed(2)} KB/\u6837\u672C`
      };
    };
    window.__mcpSetLeakBaseline = function() {
      leakDetectionBaseline = sampleMemory();
      leakDetectionSamples = [];
      return { success: true, baseline: leakDetectionBaseline };
    };
    setInterval(() => {
      sampleMemory();
    }, 2e3);
    sampleMemory();
  }

  // src/probe/memory.ts
  function initMemory() {
    const memExtrema = {};
    window.__mcpGetMemoryRanking = function() {
      const eng = window.cc;
      if (!eng || !eng.assetManager || !eng.assetManager.assets) return null;
      const assets = eng.assetManager.assets;
      const bundles = eng.assetManager.bundles;
      const globalResources = [];
      const bundleDataMap = {};
      const ownerMap = {};
      if (assets.forEach) {
        assets.forEach((asset, auuid) => {
          if (!asset) return;
          try {
            if (asset.constructor && asset.constructor.name === "SpriteFrame" || eng.SpriteFrame && asset instanceof eng.SpriteFrame) {
              let tex = asset._texture;
              if (!tex && typeof asset.getTexture === "function") tex = asset.getTexture();
              if (tex) {
                let tid = tex._uuid || tex.id || tex._id;
                if (tid) {
                  if (!ownerMap[tid]) ownerMap[tid] = [];
                  let sName = asset.name || asset._name;
                  if (sName && sName !== "Unnamed" && sName.indexOf(auuid.substring(0, 8)) === -1 && ownerMap[tid].indexOf(sName) === -1) {
                    ownerMap[tid].push(sName);
                  }
                }
              }
            }
          } catch (e) {
          }
        });
      }
      if (bundles && bundles.forEach) {
        bundles.forEach((bundle, name) => {
          bundleDataMap[name] = { name, currentMemory: 0, resources: [] };
        });
      } else if (bundles) {
        for (let name in bundles) {
          if (typeof bundles[name] === "object") {
            bundleDataMap[name] = { name, currentMemory: 0, resources: [] };
          }
        }
      }
      bundleDataMap["[Internal/Global]"] = { name: "[Internal/Global]", currentMemory: 0, resources: [] };
      function getAssetSize(asset) {
        if (!asset) return 0;
        if (asset._nativeSize !== void 0) return asset._nativeSize;
        if (asset._nativeAsset && asset._nativeAsset.byteLength) return asset._nativeAsset.byteLength;
        let cName = "";
        if (asset.__classname__) {
          cName = asset.__classname__;
        } else if (eng.js && typeof eng.js.getClassName === "function") {
          cName = eng.js.getClassName(asset) || "";
        }
        const typeStr = cName || (asset.constructor ? asset.constructor.name : "Unknown");
        if (typeStr.indexOf("Texture2D") !== -1 || eng.Texture2D && asset instanceof eng.Texture2D) {
          const w = asset.width || 0;
          const h = asset.height || 0;
          let bpp = 4;
          return w * h * bpp;
        }
        if ((typeStr.indexOf("AudioClip") !== -1 || eng.AudioClip && asset instanceof eng.AudioClip) && asset._duration) {
          return Math.floor(asset._duration * 128 * 1024 / 8);
        }
        if (typeStr.indexOf("SpriteFrame") !== -1 || eng.SpriteFrame && asset instanceof eng.SpriteFrame) {
          return 128;
        }
        if (typeStr.indexOf("Skeleton") !== -1 || eng.sp && eng.sp.SkeletonData && asset instanceof eng.sp.SkeletonData) {
          return 2048;
        }
        return 512;
      }
      if (assets.forEach) {
        assets.forEach((asset, uuid) => {
          if (!asset) return;
          let typeName = asset.constructor && asset.constructor.name || asset.__classname__ || "Asset";
          if (eng.js && typeof eng.js.getClassName === "function") {
            const cName = eng.js.getClassName(asset);
            if (cName) typeName = cName;
          }
          let foundBundle = false;
          let bNameTarget = "[Internal/Global]";
          let bundleInfoPath = "";
          if (bundles && bundles.forEach) {
            bundles.forEach((bundle, bName) => {
              if (!foundBundle && bundle.getAssetInfo) {
                const info = bundle.getAssetInfo(uuid);
                if (info) {
                  foundBundle = true;
                  bNameTarget = bName;
                  if (info.path) {
                    const parts = info.path.split(/[\/\\]/);
                    bundleInfoPath = parts[parts.length - 1];
                  }
                }
              }
            });
          }
          function isUselessName(n, u) {
            if (!n) return true;
            if (n === "Unnamed" || n === "Unknown") return true;
            const shortU = u.substring(0, 8);
            if (n.indexOf(shortU) !== -1) return true;
            if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(n)) return true;
            return false;
          }
          let name = bundleInfoPath;
          if (isUselessName(name, uuid)) name = asset.name || asset._name;
          if (isUselessName(name, uuid)) {
            if (asset.nativeUrl) {
              const urlParts = String(asset.nativeUrl).split(/[\/\\]/);
              name = urlParts[urlParts.length - 1];
            }
          }
          if (isUselessName(name, uuid) && ownerMap[uuid] && ownerMap[uuid].length > 0) {
            name = "[Tex] " + ownerMap[uuid][0];
          }
          if (isUselessName(name, uuid)) {
            name = "[Unnamed] " + uuid.substring(0, 8);
          }
          const refCount = asset.refCount || 0;
          const size = getAssetSize(asset);
          const resItem = {
            id: uuid,
            name,
            type: typeName,
            memory: size,
            refCount
          };
          if (bundleDataMap[bNameTarget]) {
            bundleDataMap[bNameTarget].resources.push(resItem);
            bundleDataMap[bNameTarget].currentMemory += size;
          }
        });
      }
      const resultList = [];
      const allRes = [];
      let totalMem = 0;
      for (let bName in bundleDataMap) {
        const block = bundleDataMap[bName];
        totalMem += block.currentMemory;
        if (!memExtrema[bName]) {
          memExtrema[bName] = { max: block.currentMemory, min: block.currentMemory };
        } else {
          if (memExtrema[bName].min === 0 && block.currentMemory > 0) {
            memExtrema[bName].min = block.currentMemory;
          } else if (block.currentMemory < memExtrema[bName].min && block.currentMemory > 0) {
            memExtrema[bName].min = block.currentMemory;
          }
          if (block.currentMemory > memExtrema[bName].max) {
            memExtrema[bName].max = block.currentMemory;
          }
        }
        block.maxMemory = memExtrema[bName].max;
        block.minMemory = memExtrema[bName].min;
        block.resourceCount = block.resources.length;
        block.resources.sort((a, b) => b.memory - a.memory);
        for (let i = 0; i < block.resources.length; i++) {
          allRes.push(block.resources[i]);
        }
        resultList.push(block);
      }
      allRes.sort((a, b) => b.memory - a.memory);
      return {
        totalMemory: totalMem,
        bundles: resultList,
        allResources: allRes
      };
    };
  }

  // src/probe/render-debugger.ts
  function initRenderDebugger() {
    window.__mcpRenderDebuggerHook = {
      _isActive: false,
      _originBatcherAddQuad: null,
      _originPushRenderCommand: null,
      _lastPushedNodeName: "Unknown Node",
      _lastQuadInfo: null,
      // --- Frame Snapshot Data ---
      _frames: [],
      _maxFrames: 5,
      _currentFrame: null,
      _isCaptureEnabled: true,
      _originMainLoop: null,
      _originBatcherFlush: null,
      _originDeviceDraw: null,
      _lastSnapshotSendTime: 0,
      // --- 画面重绘回放 ---
      _replayLimit: -1,
      _currentReplayDrawCallCount: 0,
      _requestCaptureThisFrame: false,
      _pendingCommands: [],
      // 收集发往下一个 DrawCall 的 Command 详情
      _tempBatchesData: [[]],
      // 存储同步批处理的数据分片
      _currentMcpBatchIndex: 0,
      // 当前数据分片游标
      _isFlushingBatcher: false,
      _currentFlushingBatchIndex: 0,
      _currentFlushingBatcher: null,
      stepToDrawCall: function(limitIndex, frameSnapshotData) {
        this._replayLimit = limitIndex;
        this._requestCaptureThisFrame = true;
        const eng = window.cc || window.editorEngine;
        if (eng && eng.director && eng.director.isPaused()) {
          eng.director.mainLoop(eng.director._deltaTime);
        }
      },
      injectHooks: function() {
        const self = this;
        if (self._isActive) return;
        let eng = null;
        try {
          const frm = document.getElementById("GameDiv");
          if (frm && frm.contentWindow && frm.contentWindow.cc) {
            eng = frm.contentWindow.cc;
          }
        } catch (e) {
        }
        if (!eng) eng = window.cc;
        if (!eng || !eng.RenderComponent) {
          Logger.warn("[RenderDebugger] \u521D\u59CB\u5316\u5931\u8D25\uFF1A\u672A\u627E\u5230 cc.RenderComponent");
          return;
        }
        const methodName = typeof eng.RenderComponent.prototype._checkBacth === "function" ? "_checkBacth" : "_checkBatch";
        if (typeof eng.RenderComponent.prototype[methodName] !== "function") {
          Logger.warn(`[RenderDebugger] \u65E0\u6CD5\u5B9A\u4F4D\u5408\u6279\u68C0\u6D4B\u51FD\u6570\uFF1A${methodName}() \u4E0D\u5B58\u5728`);
          return;
        }
        if (!self._originCheckBatch) {
          self._originCheckBatch = eng.RenderComponent.prototype[methodName];
        }
        eng.RenderComponent.prototype[methodName] = function(batcher, cullingMask) {
          if (self._isActive && batcher) {
            try {
              const newMaterial = this._materials && this._materials.length > 0 ? this._materials[0] : null;
              if (newMaterial && batcher.material) {
                const newHash = newMaterial.getHash();
                const oldHash = batcher.material.getHash();
                if (newHash !== oldHash || batcher.cullingMask !== cullingMask) {
                  if (batcher.material.name !== "default-material" && batcher.node && batcher.node !== batcher._dummyNode) {
                    const diffs = [];
                    if (newMaterial.name !== batcher.material.name) {
                      diffs.push(`\u6750\u8D28\u5B9E\u4F8B\u4E0D\u540C [${batcher.material.name} -> ${newMaterial.name}]`);
                    } else if (newHash !== oldHash) {
                      diffs.push(`\u6750\u8D28\u5185\u90E8\u53C2\u6570\u53D8\u52A8 (\u7591\u4F3C\u7EB9\u7406\u6216\u5408\u6279\u672A\u5F00)`);
                    }
                    if (batcher.cullingMask !== cullingMask) {
                      diffs.push(`Culling Mask \u53D8\u52A8 [${batcher.cullingMask} -> ${cullingMask}]`);
                    }
                    const culpritNode = this.node;
                    const victimNode = batcher.node;
                    const culpritName = culpritNode ? culpritNode.name : "Unknown";
                    const victimName = victimNode ? victimNode.name : "Unknown";
                    const culpritId = culpritNode ? culpritNode.uuid || culpritNode.id || "" : "";
                    const victimId = victimNode ? victimNode.uuid || victimNode.id || "" : "";
                    const payload = {
                      type: "render-debugger:batch-break",
                      data: {
                        culprit: culpritName,
                        culpritId,
                        victim: victimName,
                        victimId,
                        reasons: diffs
                      }
                    };
                    if (window.__mcpInspector && window.__mcpInspector.sendRenderDebuggerPayload) {
                      window.__mcpInspector.sendRenderDebuggerPayload(payload);
                    } else {
                      Logger.debug(`[RenderDebugger]JSON_DATA:${JSON.stringify(payload)}`);
                    }
                  }
                }
              }
            } catch (e) {
            }
          }
          const ret = self._originCheckBatch.call(this, batcher, cullingMask);
          if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
            if (batcher && !batcher.__mcp_execute_hooked) {
              batcher.__mcp_execute_hooked = true;
              const hookMethod = function(origFunc) {
                if (!origFunc) return origFunc;
                return function() {
                  let ret2;
                  if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                    self._currentFlushingBatcher = this;
                    this.__mcp_flushing_index = 0;
                  }
                  ret2 = origFunc.apply(this, arguments);
                  if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                    if (self._currentFlushingBatcher === this) {
                      self._currentFlushingBatcher = null;
                    }
                    this.__mcp_temp_batches = [];
                  }
                  return ret2;
                };
              };
              if (batcher.execute) batcher.execute = hookMethod(batcher.execute);
              if (batcher.flush) batcher.flush = hookMethod(batcher.flush);
            }
            let mat = this._materials && this._materials.length > 0 ? this._materials[0] : null;
            let matHash = mat ? mat.getHash() : "N/A";
            let bSrc = mat ? mat.getProperty("blendSrc") : void 0;
            let bDst = mat ? mat.getProperty("blendDst") : void 0;
            if (bSrc === void 0 && this.srcBlendFactor !== void 0) bSrc = this.srcBlendFactor;
            if (bDst === void 0 && this.dstBlendFactor !== void 0) bDst = this.dstBlendFactor;
            ["flush", "_flush", "_flushIA", "_flushMaterial"].forEach((fn) => {
              if (typeof batcher[fn] === "function" && !batcher["__mcp_" + fn + "_hooked"]) {
                batcher["__mcp_" + fn + "_hooked"] = true;
                let oldFn = batcher[fn];
                batcher[fn] = function() {
                  if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                    if (self._tempBatchesData[self._currentMcpBatchIndex] && self._tempBatchesData[self._currentMcpBatchIndex].length > 0) {
                      self._currentMcpBatchIndex++;
                      self._tempBatchesData[self._currentMcpBatchIndex] = [];
                    }
                  }
                  return oldFn.apply(this, arguments);
                };
              }
            });
            if (typeof self._currentMcpBatchIndex !== "number") {
              self._currentMcpBatchIndex = 0;
            }
            let targetBatchIndex = self._currentMcpBatchIndex;
            if (!self._tempBatchesData[targetBatchIndex]) {
              self._tempBatchesData[targetBatchIndex] = [];
            }
            self._tempBatchesData[targetBatchIndex].push({
              id: self._tempBatchesData[targetBatchIndex].length,
              type: this.__classname__ || this.constructor.name || "Component",
              name: this.node ? this.node.name : "Unknown",
              nodeUuid: this.node ? this.node.uuid || this.node.id : "",
              materialHash: matHash,
              blendSrc: bSrc,
              blendDst: bDst
            });
          }
          return ret;
        };
        if (!self._originMainLoop && eng.Director && eng.Director.prototype.mainLoop) {
          self._originMainLoop = eng.Director.prototype.mainLoop;
          eng.Director.prototype.mainLoop = function(dt) {
            self._currentReplayDrawCallCount = 0;
            if (self._isActive && self._isCaptureEnabled) {
              self._currentFrame = {
                frameId: eng.director.getTotalFrames(),
                timestamp: performance.now(),
                drawCalls: [],
                totalQuads: 0,
                totalVertices: 0,
                totalDrawCalls: 0
              };
              self._pendingCommands = [];
              self._tempBatchesData = [[]];
              self._currentMcpBatchIndex = 0;
              self._isFlushingBatcher = false;
            }
            self._originMainLoop.call(this, dt);
            if (self._requestCaptureThisFrame) {
              self._requestCaptureThisFrame = false;
              try {
                const canvas = document.getElementById("GameCanvas");
                if (canvas) {
                  const base64 = canvas.toDataURL("image/jpeg", 0.8);
                  const payload = {
                    type: "render-debugger:replay-result",
                    data: base64
                  };
                  if (window.__mcpInspector && window.__mcpInspector.sendRenderDebuggerPayload) {
                    window.__mcpInspector.sendRenderDebuggerPayload(payload);
                  }
                }
              } catch (err) {
                console.error("[RenderDebugger] \u753B\u5E03\u56DE\u8BFB\u5931\u8D25: ", err);
              }
            }
            if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
              self._frames.push(self._currentFrame);
              if (self._frames.length > self._maxFrames) {
                self._frames.shift();
              }
              const now = performance.now();
              if (!self._lastSnapshotSendTime || now - self._lastSnapshotSendTime > 500) {
                self._lastSnapshotSendTime = now;
                const payload = {
                  type: "render-debugger:snapshot",
                  data: self._currentFrame
                };
                if (window.__mcpInspector && window.__mcpInspector.sendRenderDebuggerPayload) {
                  window.__mcpInspector.sendRenderDebuggerPayload(payload);
                } else {
                  Logger.debug(`[RenderDebugger]JSON_DATA:${JSON.stringify(payload)}`);
                }
              }
              self._currentFrame = null;
            }
          };
        }
        if (eng.renderer && eng.renderer._batcher) {
          if (!self._originBatcherFlush) {
            self._originBatcherFlush = eng.renderer._batcher.flush;
            eng.renderer._batcher.flush = function() {
              let ret;
              if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                self._isFlushingBatcher = true;
                self._currentFlushingBatchIndex = 0;
              }
              if (self._originBatcherFlush) {
                ret = self._originBatcherFlush.apply(this, arguments);
              }
              if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                self._isFlushingBatcher = false;
                self._tempBatchesData = [];
              }
              return ret;
            };
          }
        }
        if (eng.renderer && eng.renderer._forward && eng.renderer._forward.constructor && eng.renderer._forward.constructor.prototype) {
          if (!self._originForwardDraw) {
            self._originForwardDraw = eng.renderer._forward.constructor.prototype._draw;
            if (self._originForwardDraw) {
              eng.renderer._forward.constructor.prototype._draw = function(item) {
                self._currentRenderItem = item;
                let ret = self._originForwardDraw.apply(this, arguments);
                self._currentRenderItem = null;
                return ret;
              };
            }
          }
        }
        if (eng.gfx && eng.gfx.Device) {
          if (!self._originDeviceDraw) {
            self._originDeviceDraw = eng.gfx.Device.prototype.draw;
            eng.gfx.Device.prototype.draw = function(primitiveType, indicesStart, indicesCount) {
              let realPrimType = 4;
              let realIndCount = 0;
              if (arguments.length >= 3) {
                realPrimType = arguments[0];
                realIndCount = arguments[2];
              } else if (arguments.length === 2) {
                realIndCount = arguments[1];
              }
              if (self._replayLimit !== -1) {
                if (self._currentReplayDrawCallCount > self._replayLimit) {
                  self._currentReplayDrawCallCount++;
                  return;
                }
              }
              if (self._isActive && self._isCaptureEnabled && self._currentFrame) {
                let activeCommands = [];
                if (self._tempBatchesData && self._tempBatchesData.length > 0) {
                  activeCommands = self._tempBatchesData.shift() || [];
                }
                if (!activeCommands || activeCommands.length === 0) {
                  activeCommands = self._pendingCommands;
                  self._pendingCommands = [];
                  if (self._currentRenderItem && activeCommands.length === 0) {
                    let nodeObj = self._currentRenderItem.node;
                    if (!nodeObj && self._currentRenderItem.model) {
                      nodeObj = self._currentRenderItem.model.node;
                    }
                    if (nodeObj) {
                      activeCommands.push({
                        id: 0,
                        type: "RenderItem",
                        name: nodeObj.name || "Unknown",
                        nodeUuid: nodeObj.uuid || nodeObj.id || ""
                      });
                    }
                  }
                }
                self._currentFrame.drawCalls.push({
                  id: self._currentFrame.drawCalls.length,
                  type: "draw",
                  primitiveType: realPrimType,
                  indiceCount: realIndCount,
                  vertexCount: Math.floor(realIndCount / 1.5),
                  // 粗略估算四边形的顶点数
                  timestamp: performance.now(),
                  commands: activeCommands
                });
                self._currentFrame.totalDrawCalls++;
              }
              self._currentReplayDrawCallCount++;
              if (self._originDeviceDraw) {
                return self._originDeviceDraw.apply(this, arguments);
              }
            };
          }
        }
        self._isActive = true;
        Logger.log("[RenderDebugger] MVP \u63A2\u9488\u5DF2\u6210\u529F\u6CE8\u5165\u6E38\u620F\u5185\u6E32\u67D3\u7BA1\u7EBF \u2705");
      },
      restoreHooks: function() {
        const self = this;
        if (!self._isActive) return;
        let eng = null;
        try {
          const frm = document.getElementById("GameDiv");
          if (frm && frm.contentWindow && frm.contentWindow.cc) {
            eng = frm.contentWindow.cc;
          }
        } catch (e) {
        }
        if (!eng) {
          eng = window.cc;
        }
        if (eng && eng.RenderComponent && self._originCheckBatch) {
          const methodName = typeof eng.RenderComponent.prototype._checkBacth === "function" ? "_checkBacth" : "_checkBatch";
          eng.RenderComponent.prototype[methodName] = self._originCheckBatch;
        }
        if (self._originMainLoop && eng.Director) {
          eng.Director.prototype.mainLoop = self._originMainLoop;
          self._originMainLoop = null;
        }
        if (self._originPushRenderCommand && eng.renderer) {
          eng.renderer.pushRenderCommand = self._originPushRenderCommand;
          self._originPushRenderCommand = null;
        }
        if (self._originBatcherFlush && eng.renderer && eng.renderer._batcher) {
          eng.renderer._batcher.flush = self._originBatcherFlush;
          self._originBatcherFlush = null;
        }
        if (self._originDeviceDraw && eng.gfx && eng.gfx.Device) {
          eng.gfx.Device.prototype.draw = self._originDeviceDraw;
          self._originDeviceDraw = null;
        }
        self._lastQuadInfo = null;
        self._frames = [];
        self._currentFrame = null;
        self._isActive = false;
        self._replayLimit = -1;
        self._currentReplayDrawCallCount = 0;
        self._currentMcpBatchIndex = 0;
        self._isFlushingBatcher = false;
        Logger.log("[RenderDebugger] MVP \u63A2\u9488\u5DF2\u5B89\u5168\u64A4\u51FA\uFF0C\u6E38\u620F\u5185\u5F52\u8FD8\u539F\u751F\u7BA1\u7EBF \u{1F6D1}");
      }
    };
  }

  // src/probe/picker.ts
  function initPicker() {
    window.__mcpNodePicker = {
      isActive: false,
      _onMouseMove: null,
      _onClick: null,
      _onKeyDown: null,
      enable: function() {
        const self = this;
        if (self.isActive) return;
        self.isActive = true;
        Logger.log("[Node Picker] \u62FE\u53D6\u6A21\u5F0F\u5DF2\u5F00\u542F \u{1F3AF}");
        if (!document.getElementById("__mcp_cursor_tracker")) {
          const tracker = document.createElement("div");
          tracker.id = "__mcp_cursor_tracker";
          tracker.style.position = "fixed";
          tracker.style.zIndex = "2147483647";
          tracker.style.pointerEvents = "none";
          tracker.style.width = "8px";
          tracker.style.height = "8px";
          tracker.style.borderRadius = "50%";
          tracker.style.backgroundColor = "rgba(255, 0, 0, 0.8)";
          tracker.style.border = "1px solid white";
          tracker.style.transform = "translate(-50%, -50%)";
          tracker.style.boxShadow = "0 0 5px rgba(255,0,0,1)";
          document.body.appendChild(tracker);
        }
        self._lastMoveTime = 0;
        self._lastHoverUuid = null;
        self._onMouseMove = function(e) {
          if (!self.isActive) return;
          const tracker = document.getElementById("__mcp_cursor_tracker");
          if (tracker) {
            tracker.style.left = e.clientX + "px";
            tracker.style.top = e.clientY + "px";
          }
          const now = Date.now();
          if (now - self._lastMoveTime < 50) return;
          self._lastMoveTime = now;
          const hitNode = self.hitTest(e.clientX, e.clientY);
          const hitUuid = hitNode ? hitNode.uuid || hitNode.id : null;
          if (hitUuid !== self._lastHoverUuid) {
            self._lastHoverUuid = hitUuid;
          }
          if (hitUuid && window.__mcpCrawler) {
            window.__mcpCrawler.setHoverTarget(hitUuid);
          } else if (window.__mcpCrawler) {
            window.__mcpCrawler.setHoverTarget(null);
          }
        };
        self._onClick = function(e) {
          if (!self.isActive) return;
          e.stopPropagation();
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === "function") {
            e.stopImmediatePropagation();
          }
          if (e.type === "mousedown") return;
          const hitNode = self.hitTest(e.clientX, e.clientY);
          let hitUuid = null;
          if (hitNode) {
            hitUuid = hitNode.uuid || hitNode.id;
          }
          Logger.log(`[Picker Trigger] \u9F20\u6807\u70B9\u51FB\u5B8C\u6210\uFF0C\u51B3\u8BAE\u629B\u51FA\u7684 hitUuid \u503C\u4E3A: ${hitUuid || "null"} (Node: ${hitNode ? hitNode.name : "Unknown"})`);
          if (window.__mcpCrawler && window.__mcpCrawler.setSelectionTarget) {
            window.__mcpCrawler.setSelectionTarget(hitUuid);
          }
          if (window.__mcpInspector && window.__mcpInspector.sendNodeSelected) {
            Logger.log(`[Selection-Debug] Trigger: Probe-Picker-sendNodeSelected | HitUuid: ${hitUuid || "null"} | Broadcasting to IPC channel...`);
            window.__mcpInspector.sendNodeSelected(hitUuid || "");
          }
          self.disable();
        };
        self._onKeyDown = function(e) {
          if (e.key === "Escape") {
            if (window.__mcpInspector && window.__mcpInspector.sendNodeSelected) {
              window.__mcpInspector.sendNodeSelected("");
            }
            self.disable();
          }
        };
        document.documentElement.addEventListener("mousemove", self._onMouseMove, true);
        document.documentElement.addEventListener("mousedown", self._onClick, true);
        document.documentElement.addEventListener("mouseup", self._onClick, true);
        document.documentElement.addEventListener("click", self._onClick, true);
        document.documentElement.addEventListener("keydown", self._onKeyDown, true);
      },
      disable: function() {
        const self = this;
        if (!self.isActive) return;
        self.isActive = false;
        Logger.log("[Node Picker] \u62FE\u53D6\u6A21\u5F0F\u5DF2\u5173\u95ED \u{1F6D1}");
        const tracker = document.getElementById("__mcp_cursor_tracker");
        if (tracker && tracker.parentNode) {
          tracker.parentNode.removeChild(tracker);
        }
        if (self._onMouseMove) document.documentElement.removeEventListener("mousemove", self._onMouseMove, true);
        if (self._onClick) {
          document.documentElement.removeEventListener("mousedown", self._onClick, true);
          document.documentElement.removeEventListener("mouseup", self._onClick, true);
          document.documentElement.removeEventListener("click", self._onClick, true);
        }
        if (self._onKeyDown) document.documentElement.removeEventListener("keydown", self._onKeyDown, true);
        if (window.__mcpCrawler) {
          window.__mcpCrawler.setHoverTarget(null);
        }
      },
      hitTest: function(clientX, clientY) {
        const eng = getCcEngine();
        if (!eng || !eng.director || !eng.view) return null;
        const scene = eng.director.getScene();
        if (!scene) return null;
        const canvas = document.getElementById("GameCanvas");
        const rect = canvas ? canvas.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
        const frameSize = eng.view.getFrameSize();
        const visibleOrigin = eng.view.getVisibleOrigin ? eng.view.getVisibleOrigin() : { x: 0, y: 0 };
        const visibleSize = eng.view.getVisibleSize ? eng.view.getVisibleSize() : { width: frameSize.width, height: frameSize.height };
        const x = visibleOrigin.x + (clientX - rect.left) * (visibleSize.width / rect.width);
        const y = visibleOrigin.y + (rect.bottom - clientY) * (visibleSize.height / rect.height);
        const screenPt = eng.v2(x, y);
        let cameras = [];
        if (eng.Camera && eng.Camera.cameras) {
          cameras = eng.Camera.cameras;
        }
        const validCameras = [];
        for (let i = 0; i < cameras.length; i++) {
          if (cameras[i].node && cameras[i].node.name === "InspectorCamera") continue;
          validCameras.push(cameras[i]);
        }
        const sortedCameras = validCameras.sort(function(a, b) {
          return b.depth - a.depth;
        });
        if (sortedCameras.length === 0) return null;
        function walkSceneForCamera(node, camera, worldPos, depth = 0, parentValidated = false) {
          if (eng.Scene && node instanceof eng.Scene) {
            const children2 = node.children;
            for (let i = children2.length - 1; i >= 0; i--) {
              let hitChild = walkSceneForCamera(children2[i], camera, worldPos, depth + 1, parentValidated);
              if (hitChild) return hitChild;
            }
            return null;
          }
          try {
            if (node.activeInHierarchy === false || node.active === false) return null;
            if (node.opacity === 0 || node.color && node.color.a === 0) return null;
            if (node.scale === 0 || node.scaleX === 0 || node.scaleY === 0) return null;
          } catch (e) {
            return null;
          }
          if (node.name === "__mcp_hover_overlay__" || node.name === "__mcp_select_overlay__") return null;
          const children = node.children;
          let isNodeValidated = (camera.cullingMask & 1 << node.groupIndex) !== 0;
          let passCheck = false;
          if (isNodeValidated) {
            passCheck = true;
          } else if (node.groupIndex === 0 && parentValidated) {
            passCheck = true;
          }
          if (children && children.length > 0) {
            for (let i = children.length - 1; i >= 0; i--) {
              let hitChild = walkSceneForCamera(children[i], camera, worldPos, depth + 1, passCheck);
              if (hitChild) return hitChild;
            }
          }
          try {
            if (!passCheck) {
              return null;
            }
          } catch (e) {
            return null;
          }
          if (node.width > 0 && node.height > 0) {
            let hasRenderComp = false;
            if (node._components) {
              for (let k = 0; k < node._components.length; k++) {
                const comp = node._components[k];
                if (comp && comp.enabled === false) continue;
                let compName = "";
                if (comp.constructor && comp.constructor.name) {
                  compName = comp.constructor.name;
                } else if (comp.name) {
                  compName = comp.name;
                }
                if (compName.indexOf("Mask") > -1 || compName.indexOf("TiledObjectGroup") > -1) continue;
                const isRender = eng.RenderComponent && comp instanceof eng.RenderComponent || (compName.indexOf("Sprite") > -1 || compName.indexOf("Label") > -1 || compName.indexOf("RichText") > -1 || compName.indexOf("Graphics") > -1 || compName.indexOf("Skeleton") > -1 || compName.indexOf("Particle") > -1 || compName.indexOf("Mesh") > -1 || compName.indexOf("VideoPlayer") > -1 || compName.indexOf("WebView") > -1 || compName.indexOf("UIStaticBatch") > -1 || compName.indexOf("Spine") > -1 || compName.indexOf("DragonBones") > -1 || compName.indexOf("Tiled") > -1 || compName.indexOf("Light") > -1 || compName.indexOf("MotionStreak") > -1);
                const isInteractive = compName.indexOf("Button") > -1 || compName.indexOf("Toggle") > -1 || compName.indexOf("Slider") > -1 || compName.indexOf("ScrollView") > -1 || compName.indexOf("BlockInputEvents") > -1 || compName.indexOf("EditBox") > -1;
                if (isRender || isInteractive) {
                  if (compName.indexOf("Sprite") > -1 && (!comp.spriteFrame && !comp._spriteFrame)) continue;
                  if (compName.indexOf("Label") > -1 && compName === "cc.Label" && (!comp.string || comp.string === "")) continue;
                  if (compName.indexOf("RichText") > -1 && (!comp.string || comp.string === "")) continue;
                  hasRenderComp = true;
                  break;
                }
              }
            }
            if (!hasRenderComp) {
              return null;
            }
            if (typeof node.convertToNodeSpaceAR === "function") {
              const localPt = node.convertToNodeSpaceAR(worldPos);
              const ax = node.anchorX !== void 0 ? node.anchorX : 0.5;
              const ay = node.anchorY !== void 0 ? node.anchorY : 0.5;
              const rectTest = eng.rect(-ax * node.width, -ay * node.height, node.width, node.height);
              if (rectTest.contains(localPt)) {
                return node;
              }
            }
          }
          return null;
        }
        for (let c = 0; c < sortedCameras.length; c++) {
          const camera = sortedCameras[c];
          if (camera.enabled === false) continue;
          if (typeof camera.getScreenToWorldPoint !== "function") continue;
          const worldPos = camera.getScreenToWorldPoint(screenPt);
          if (!worldPos) continue;
          let hitNode = walkSceneForCamera(scene, camera, worldPos, 0, false);
          if (hitNode) {
            Logger.log(`[Picker Result] \u6444\u50CF\u673A\u5C42\u7EA7\u62E6\u622A\u54CD\u5E94\uFF01\u9009\u4E2D\u76EE\u6807 = ${hitNode.name}\uFF0C\u6240\u5C5E\u6444\u50CF\u673A = ${camera.node ? camera.node.name : "Unknown"}`);
            return hitNode;
          }
        }
        return null;
      }
    };
  }

  // src/probe/index.ts
  (function() {
    if (window.__mcpProbeInitialized) {
      return;
    }
    initCrawler();
    initHighlighter();
    initProfiler();
    initMemory();
    initRenderDebugger();
    initPicker();
    initMaskDiagnostics();
    const DEBUG_INTERVAL = 1e3;
    function initProbe() {
      try {
        const ccEng = getCcEngine();
        if (!ccEng || !ccEng.director || !ccEng.director.getScene()) {
          setTimeout(initProbe, 500);
          return;
        }
        const cc2 = ccEng;
        window.__mcpGetEnvInfo = function() {
          const info = {
            version: cc2.ENGINE_VERSION,
            isNative: cc2.sys.isNative,
            isMobile: cc2.sys.isMobile,
            language: cc2.sys.language,
            designResolution: { width: 0, height: 0 }
          };
          try {
            if (cc2.view && typeof cc2.view.getDesignResolutionSize === "function") {
              var dr = cc2.view.getDesignResolutionSize();
              info.designResolution = { width: dr.width || 0, height: dr.height || 0 };
            }
          } catch (e) {
          }
          try {
            if (cc2.assetManager && cc2.assetManager.downloader) {
              info.downloader = { ...cc2.assetManager.downloader };
            }
          } catch (e) {
          }
          try {
            if (cc2.dynamicAtlasManager) {
              info.dynamicAtlas = {
                enabled: cc2.dynamicAtlasManager.enabled,
                maxFrameSize: cc2.dynamicAtlasManager.maxFrameSize,
                textureSize: cc2.dynamicAtlasManager.textureSize,
                maxAtlasCount: cc2.dynamicAtlasManager.maxAtlasCount,
                atlasCount: cc2.dynamicAtlasManager.atlasCount,
                textureBleeding: cc2.dynamicAtlasManager.textureBleeding
              };
            }
          } catch (e) {
          }
          try {
            if (cc2.director.getPhysicsManager) {
              const phys = cc2.director.getPhysicsManager();
              let drawFlags = {
                aabb: false,
                pair: false,
                centerOfMass: false,
                joint: false,
                shape: false,
                raw: phys.debugDrawFlags || 0
              };
              try {
                if (cc2.PhysicsManager && cc2.PhysicsManager.DrawBits && phys.debugDrawFlags) {
                  const bits = cc2.PhysicsManager.DrawBits;
                  const f = phys.debugDrawFlags;
                  drawFlags.aabb = !!(f & bits.e_aabbBit);
                  drawFlags.pair = !!(f & bits.e_pairBit);
                  drawFlags.centerOfMass = !!(f & bits.e_centerOfMassBit);
                  drawFlags.joint = !!(f & bits.e_jointBit);
                  drawFlags.shape = !!(f & bits.e_shapeBit);
                }
              } catch (e) {
              }
              info.physics = {
                enabled: phys.enabled,
                allowSleep: phys.allowSleep,
                maxSubSteps: phys.maxSubSteps,
                fixedTimeStep: phys.fixedTimeStep,
                gravity: phys.gravity ? `${phys.gravity.x}, ${phys.gravity.y}` : "N/A",
                drawFlags
              };
            }
          } catch (e) {
          }
          try {
            if (cc2.director.getCollisionManager) {
              const col = cc2.director.getCollisionManager();
              info.collision = {
                enabled: col.enabled,
                drawBoundingBox: col.enabledDrawBoundingBox,
                debugDraw: col.enabledDebugDraw
              };
            }
          } catch (e) {
          }
          return info;
        };
        if (window.__mcpInspector && window.__mcpInspector.sendHandshake) {
          try {
            window.__mcpInspector.sendHandshake(JSON.stringify(window.__mcpGetEnvInfo()));
          } catch (e) {
          }
        }
        window.__mcpSyncNodeTree = syncNodeTree;
        setInterval(() => {
          if (window.__mcpActiveTab !== void 0 && window.__mcpActiveTab !== 2) return;
          if (window.__mcpInspector && window.__mcpInspector.updateEnv) {
            try {
              window.__mcpInspector.updateEnv(JSON.stringify(window.__mcpGetEnvInfo()));
            } catch (e) {
            }
          }
        }, 3e3);
        syncNodeTree();
        setInterval(() => {
          if (window.__mcpActiveTab !== void 0 && window.__mcpActiveTab !== 0) return;
          syncNodeTree();
        }, DEBUG_INTERVAL);
        window.__mcpProbeInitialized = true;
        startHighlighterHook();
      } catch (err) {
        console.error("[Probe] \u521D\u59CB\u5316\u63A2\u9488\u53D1\u751F\u81F4\u547D\u5F02\u5E38:", err);
        const envData = {
          url: window.location.href,
          hasCC: typeof cc !== "undefined",
          error: err.message || err.toString(),
          stack: err.stack
        };
        if (window.__mcpInspector && window.__mcpInspector.sendLog) {
          window.__mcpInspector.sendLog("[Probe Crash] " + JSON.stringify(envData));
        }
      }
    }
    if (document.readyState === "complete" || document.readyState === "interactive") {
      initProbe();
    } else {
      window.addEventListener("DOMContentLoaded", initProbe);
    }
  })();
})();
