// ============================================================================
// Cloudflare Workers 入口
// 部署: 在 Cloudflare 上部署本仓库, 入口为 src/index.js(见 wrangler.toml 的 main)
// 本地调试: npx wrangler dev
// ============================================================================

import { handleRequest } from "./handle_request.js";

export default {
  async fetch(request) {
    return handleRequest(request);
  }
}
