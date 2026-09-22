// ============================================================================
// Deno Deploy 入口
// 部署: 在 https://dash.deno.com 创建项目, Entrypoint 填写 src/deno_index.ts
// ============================================================================

import { handleRequest } from "./handle_request.js";

// 监听 80 端口, 所有请求交给统一的处理函数
Deno.serve({ port: 80 }, (req) => handleRequest(req));
