// ============================================================================
// Codex / OpenAI API Proxy Lite —— 核心转发逻辑
//
// 工作流程:
//   客户端 (Codex / ChatGPT / 其他 OpenAI 兼容客户端)
//     │  原样发送 OpenAI 格式请求
//     ▼
//   本代理 (边缘函数)
//     │  1. 多 Key 负载均衡: Authorization 里的逗号分隔 Key 随机选一个
//     │  2. 剥离 hop-by-hop 等不该转发的请求头
//     │  3. 请求体原样透传(流式, 不落内存)
//     ▼
//   上游 OpenAI 兼容服务 (UPSTREAM_BASE)
//     │  响应(含 SSE 流)原样透传回客户端
//     ▼
//   客户端
// ============================================================================

// 上游 OpenAI 兼容服务地址, 换上游只需要改这一行。
// 当前地址使用 HTTP，Authorization 会以明文经过代理到上游；生产环境建议改成 HTTPS。
const UPSTREAM_BASE = 'http://45.205.27.136:8080';

// 请求方向需要剥离的头(全部小写比较):
// - host / connection / keep-alive / transfer-encoding / upgrade / te /
//   trailer / proxy-authorization / proxy-authenticate
//   以上均为 hop-by-hop 头(逐跳头), 只属于当前这一跳的连接, 转发给上游无意义
//   甚至可能导致上游解析异常
// - content-length: 流式转发时长度由运行时重新计算,
//   携带客户端的旧值可能导致请求被截断或挂起
const SKIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'proxy-authorization',
  'proxy-authenticate',
  'proxy-connection',
  'content-length',
]);

// 响应方向需要剥离的头(全部小写比较):
// - hop-by-hop 头: 同上
// - content-encoding: fetch 收到上游响应时已自动解压(gzip/br 等),
//   若保留该头, 客户端会把已解压的明文当作压缩数据解析而报错
// - content-length: 解压后长度可能变化, 且流式返回时长度未知, 删掉让运行自动处理
const SKIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'trailer',
  'proxy-authenticate',
  'proxy-connection',
  'content-encoding',
  'content-length',
]);

export async function handleRequest(request) {
  // 解析请求 URL, 用于提取路径与查询串
  const url = new URL(request.url);

  // CORS 预检: 浏览器类客户端跨域访问前会先发 OPTIONS, 直接放行不转发上游
  if (request.method === 'OPTIONS') {
    return handleOPTIONS();
  }

  // 根路径作为健康检查, 用于快速确认代理是否存活, 不转发到上游。
  // 不在响应里显示上游地址，避免无必要地暴露内部部署信息。
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return new Response('Proxy is Running!', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // 拼接上游目标地址: 客户端请求的原始路径 + 查询串全部保留
  // 例如 /v1/responses?a=1 -> http://45.205.27.136:8080/v1/responses?a=1
  const targetUrl = UPSTREAM_BASE + url.pathname + url.search;

  try {
    // ---- 构造转发请求头: 逐个复制客户端请求头, 跳过剥离名单里的头 ----
    const headers = new Headers();
    for (const [key, value] of request.headers.entries()) {
      if (!SKIP_REQUEST_HEADERS.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    }

    // ---- 多 Key 负载均衡 ----
    // 客户端在 Authorization 头里携带多个 Bearer Key(逗号分隔)时随机选一个。
    // 只对 Bearer 做轮换，避免破坏 Basic 等其它认证方案的 user:password 结构。
    const auth = request.headers.get('Authorization');
    if (auth) {
      const selected = selectApiKey(auth);
      if (selected) {
        headers.set('Authorization', selected);
      }
    }

    // GET/HEAD 按规范不允许携带请求体, 其余方法原样透传 body(流式, 不落内存)
    const hasBody = request.body != null && request.method !== 'GET' && request.method !== 'HEAD';
    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // duplex: 'half' 是流式请求体的标准要求:
      // Node/undici 运行时(Netlify 等)缺了会直接抛错,
      // Cloudflare/Deno/Vercel 等运行时会忽略未知选项, 加了无副作用
      ...(hasBody ? { duplex: 'half' } : {}),
      // 手动处理重定向: 上游返回 3xx 时原样透传给客户端,
      // 不替客户端自动跳转(自动跳转会把 POST 降级为 GET, 破坏语义)
      redirect: 'manual',
    });

    // ---- 构造响应头: 复制上游响应头, 跳过剥离名单里的头 ----
    const responseHeaders = new Headers();
    for (const [key, value] of response.headers.entries()) {
      if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    }
    // 跨域: 允许任意来源的客户端调用本代理
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    // 响应体(含 SSE 流式响应)原样透传, 状态码与状态文本保持上游原值
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });

  } catch (error) {
    // 上游连接失败等异常: 只返回简短提示, 不回传堆栈,
    // 避免向客户端泄露内部实现细节; 详细错误进服务端日志
    console.error('Failed to fetch:', error);
    return new Response('Bad Gateway: upstream unavailable', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

// 从 Authorization 头里随机选取一个 Key
// 输入: "Bearer key1,key2,key3"  输出: "Bearer key2"(随机)
// 单 Key(不含逗号)时返回 null, 表示无需干预, 保持原样转发
function selectApiKey(auth) {
  // 解析认证方案与凭据部分。
  const match = auth.match(/^(\w+)\s+(.*)$/);
  if (!match) {
    return null;
  }
  const [, scheme, credentials] = match;
  if (scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  // 凭据里没有逗号说明是单 Key, 不处理
  if (!credentials.includes(',')) {
    return null;
  }
  // 逗号分隔出多个 Key, trim 去掉多余空格, 过滤空串
  const apiKeys = credentials.split(',').map((k) => k.trim()).filter((k) => k);
  if (apiKeys.length === 0) {
    return null;
  }
  // 随机均匀选取一个。日志不输出 Key 或其片段，避免凭据进入平台日志系统。
  const selected = apiKeys[Math.floor(Math.random() * apiKeys.length)];
  return `${scheme} ${selected}`;
}

// CORS 预检响应: 放行所有方法与请求头, 浏览器缓存 24 小时减少重复预检
function handleOPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400',
    },
  });
}
