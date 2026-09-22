// ============================================================================
// Vercel 入口
// vercel.json 已把所有路径 /(.*) 路由到本文件
// Edge Function 收到的 request.url 保留客户端请求的原始路径, 直接交给统一处理函数
// ============================================================================

import { handleRequest } from "../src/handle_request.js";

export const config = {
  runtime: 'edge' //告诉 Vercel 这是 Edge Function
};

export default async function handler(req) {
  return handleRequest(req);
}
