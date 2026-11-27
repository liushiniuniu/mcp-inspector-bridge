"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupResources = setupResources;
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
function setupResources(server, sendRpcToCocos) {
    server.setRequestHandler(types_js_1.ListResourcesRequestSchema, async () => {
        return {
            resources: [
                {
                    uri: "scene://hierarchy",
                    name: "Scene Hierarchy Tree",
                    description: "A JSON representation of the entire node tree in the current scene.",
                    mimeType: "application/json"
                }
            ]
        };
    });
    server.setRequestHandler(types_js_1.ReadResourceRequestSchema, async (request) => {
        if (request.params.uri === "scene://hierarchy") {
            const res = await sendRpcToCocos('get_node_tree', { depth: 10 });
            return {
                contents: [
                    { uri: "scene://hierarchy", mimeType: "application/json", text: JSON.stringify(res.content || res, null, 2) }
                ]
            };
        }
        throw new Error("Resource not found");
    });
}
//# sourceMappingURL=resources.js.map