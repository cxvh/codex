// ============================================================================
// Netlify Functions 入口
// netlify.toml 已把所有路径 /* 重写(rewrite)到 /.netlify/functions/api/:splat
// 因此函数内 request.url 的路径是 /.netlify/functions/api/<真实路径>,
// 需要先剥掉函数路径前缀, 还原客户端请求的真实路径后再交给统一处理函数
// ============================================================================

import { handleRequest } from "../../src/handle_request.js";

export default async (req, context) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith('/.netlify/functions/api')) {
    // 剥掉函数路径前缀, 还原真实路径; 根路径剥完为空串时兜底为 "/"
    url.pathname = url.pathname.replace('/.netlify/functions/api', '') || '/';
    // 以原请求(方法/头/请求体)为基础, 仅替换 URL 后转发
    return handleRequest(new Request(url, req));
  }
  return handleRequest(req);
};
