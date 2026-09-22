# Codex / OpenAI API Proxy Lite

OpenAI 兼容 API 纯转发代理，无服务器轻量版（边缘函数）。

> 本项目基于 [gemini-balance-lite](https://github.com/tech-shrimp/gemini-balance-lite)（作者：[技术爬爬虾](https://space.bilibili.com/316183842)）改造，MIT License。

## 项目简介

把 OpenAI / Codex 客户端的请求**原样转发**到上游 OpenAI 兼容服务，不修改任何请求格式。

- 纯透传：除根路径健康检查和 OPTIONS 预检外，任意路径、任意方法、请求体（含 SSE 流式响应）均原样转发
- 多 Key 负载均衡：`Authorization: Bearer <KEY_1>,<KEY_2>,...` 逗号分隔，随机选取一个
- 无服务器：支持 Vercel / Deno / Cloudflare Workers / Netlify 四端部署，零依赖

## 上游配置

上游地址是 `src/handle_request.js` 顶部的常量，按需修改：

```js
const UPSTREAM_BASE = 'http://45.205.27.136.nip.io:8080';
```

Vercel Edge 禁止直接访问裸 IP，因此默认使用 `nip.io` 将 `45.205.27.136` 映射为域名。若你有自己的域名，建议将域名解析到该服务器后改成自己的 HTTPS 地址。当前示例使用 HTTP，生产环境建议使用 HTTPS，避免 `Authorization` 中的 API Key 在代理到上游的链路中明文传输。

## API 说明

主要接口（全部透传到上游同路径）：

| 端点 | 说明 |
| --- | --- |
| `POST /responses` | OpenAI Responses（Codex） |
| `POST /v1/responses` | 同上，上游两种写法等价 |
| `POST /v1/chat/completions` | OpenAI Chat Completions |

其他 OpenAI 接口（包括 `GET /v1/models`、`POST /v1/embeddings` 以及上游提供的其他接口）同样原样转发，不在代理层做接口白名单限制。除根路径健康检查和 OPTIONS 预检外，客户端请求的路径、方法、查询参数、请求体和响应状态都会透传到上游。

上游要求认证。访问 `/v1/models` 时也必须带 API Key，例如：

```bash
curl --location 'https://<YOUR_DEPLOYED_DOMAIN>/v1/models' \
--header 'Authorization: Bearer <YOUR_API_KEY>'
```

代理会透传 `Authorization`、`x-api-key` 和 `x-goog-api-key`。这三个认证头都支持用逗号分隔多个 Key，代理会随机选择一个发送给上游。

**Curl 示例:**
```bash
# Codex / Responses
curl -X POST --location 'https://<YOUR_DEPLOYED_DOMAIN>/v1/responses' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <KEY_1>,<KEY_2>' \
--data '{
    "model": "gpt-5",
    "instructions": "You are a helpful assistant.",
    "input": "你好"
}'

# Chat Completions
curl -X POST --location 'https://<YOUR_DEPLOYED_DOMAIN>/v1/chat/completions' \
--header 'Content-Type: application/json' \
--header 'Authorization: Bearer <KEY_1>,<KEY_2>' \
--data '{
    "model": "gpt-4o",
    "messages": [
        {
            "role": "user",
            "content": "你好"
        }
    ]
}'
```

**Codex 配置示例 (`~/.codex/config.toml`):**
```toml
model = "gpt-5"
model_provider = "proxy"

[model_providers.proxy]
name = "proxy"
base_url = "https://<YOUR_DEPLOYED_DOMAIN>/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
```
`env_key` 对应的环境变量里填上游 API Key，多个 Key 用逗号分隔即可实现负载均衡。

## 安全说明

- 本代理默认没有额外的访问令牌，属于公开转发入口；部署到公网后，任何知道地址的客户端都可以使用它转发请求。
- 上游 API Key 由客户端通过 `Authorization` 传入，代理只在多个 Bearer Key 之间随机选择一个，不把 Key 写入响应，也不把 Key 写入日志。
- 建议通过平台域名访问，并为代理增加平台侧访问控制、限流或 IP 白名单；同时优先使用 HTTPS 上游。
- 上游返回的重定向会原样返回给客户端，重定向响应中的 `Location` 可能暴露上游地址。

## Vercel 部署

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/cxvh/codex)

1. 点击部署按钮一键部署
2. 将分配的域名填入 AI 客户端即可使用
3. 如需自定义域名，在 Vercel 项目设置中添加

## Deno 部署

1. [fork](https://github.com/cxvh/codex/fork) 本项目
2. 登录/注册 https://dash.deno.com/ ，创建项目 https://dash.deno.com/new_project
3. 选择此项目，Entrypoint 填写 `src/deno_index.ts`，其他字段留空
4. 点击 <b>Deploy Project</b>，部署成功后获得域名
5. 如需自定义域名，在 Deno 项目设置中添加

## Cloudflare Worker 部署

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cxvh/codex)

1. 点击部署按钮
2. 登录 Cloudflare 账号，链接 Github 账户，部署
3. 打开 dash.cloudflare.com，查看部署后的 worker
4. 如需自定义域名，在 Worker 设置中添加

## Netlify 部署

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/cxvh/codex)

1. 点击部署按钮，登录 Github 账户即可
2. 免费分配域名，部署完成后将域名填入 AI 客户端

## 本地调试

安装依赖并使用 Cloudflare Wrangler:
```bash
npm install
npx wrangler dev
```

## 打赏

原项目作者：技术爬爬虾
B站：[https://space.bilibili.com/316183842](https://space.bilibili.com/316183842)<br>
Youtube: [https://www.youtube.com/@Tech_Shrimp](https://www.youtube.com/@Tech_Shrimp)
