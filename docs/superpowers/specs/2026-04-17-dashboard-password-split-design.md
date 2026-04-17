# Dashboard 登录密码与 API Key 分离设计

## 背景

当前 `server.proxy_api_key` 同时承担两个职责：

- 作为代理 API 路由的 Bearer token，例如 `/v1/chat/completions`、`/v1/responses`、`/v1/messages` 和 Gemini 兼容路由。
- 作为远程 Dashboard 登录门禁的密码。

这种耦合会降低运维安全性。分发给 API 客户端的 key 也能登录 Dashboard，而 Dashboard 中包含账号管理、账号导出、系统设置和更新控制等高权限操作。

## 目标

新增一个可选的 Dashboard 专用密码，同时保持现有部署的兼容性。

已确认采用向后兼容设计：

- 如果配置了 `server.dashboard_password`，远程 Dashboard 登录使用该密码。
- 如果没有配置 `server.dashboard_password`，Dashboard 登录继续使用 `server.proxy_api_key`，保持旧行为。
- API 路由继续只接受 `server.proxy_api_key` 或现有的账号级代理 key。API 路由不得接受 `server.dashboard_password`。

## 非目标

- 本版本不引入密码哈希存储。
- 不增加 Dashboard 多用户账号体系。
- 不重做 API key 管理。
- 第一版不要求增加 UI 支持。手动配置 `data/local.yaml` 即可。
- 本版本不改变 localhost 请求绕过 Dashboard 登录门禁的现有行为。

## 配置

在 `server` 下新增一个可选、可为 `null` 的字段：

```yaml
server:
  proxy_api_key: "api-client-key"
  dashboard_password: "dashboard-login-password"
```

字段语义：

- `proxy_api_key` 控制 API 认证。
- `dashboard_password` 只控制 Dashboard 登录。
- 空字符串应当按未设置处理。
- 如果两者都未设置，Dashboard 登录门禁保持关闭，API 路由也保持当前未配置 `proxy_api_key` 时的既有行为。

## 认证行为

Dashboard 登录密码解析顺序：

1. 当 `server.dashboard_password` 是非空字符串时，使用它。
2. 否则，当 `server.proxy_api_key` 是非空字符串时，使用它。
3. 否则，不启用 Dashboard 登录门禁。

Dashboard 门禁是否启用也必须使用同一个“有效 Dashboard 密码”判断。只要 `dashboard_password` 或 `proxy_api_key` 任意一个被配置，远程 Dashboard 请求就必须携带有效的 `_codex_session` cookie。

API 路由校验必须继续基于 `server.proxy_api_key` 和账号级代理 key。不得把 `dashboard_password` 传入 `AccountPool.validateProxyApiKey()`，也不得让 API 路由接受 `dashboard_password`。

## 影响组件

- `src/config-schema.ts`：新增 `server.dashboard_password`。
- `config/default.yaml`：记录默认值为 `null`。
- `src/routes/dashboard-login.ts`：使用有效 Dashboard 密码校验提交的登录密码。
- `src/middleware/dashboard-auth.ts`：当有效 Dashboard 密码存在时，对远程 Dashboard 端点启用门禁。
- `src/routes/admin/settings.ts`：保持现有 API key 行为不变。第一版不通过现有 API key 设置响应暴露 `dashboard_password`。
- `README.md` 和 `README_EN.md`：说明登录密码与 API key 分离后的配置和示例。
- Dashboard auth 与 API auth 相关测试：覆盖回退兼容和凭据分离。

## 数据流

远程 Dashboard 访问：

1. 浏览器加载 `/`。
2. 前端调用 `/auth/dashboard-status`。
3. 服务端解析有效 Dashboard 密码。
4. 如果不存在有效密码，状态接口返回 `required: false`。
5. 如果存在有效密码且请求来自远程地址，状态接口在没有有效 session cookie 时返回 `required: true`。
6. 登录表单向 `/auth/dashboard-login` 提交 `{ password }`。
7. 服务端将提交的密码与有效 Dashboard 密码比较，成功后创建现有的 cookie session。

API 访问：

1. 客户端携带 `Authorization: Bearer <key>` 调用 `/v1/...`。
2. 路由沿用现有 API key 校验路径。
3. `dashboard_password` 对 API 访问无效。

## 错误处理

- 当 Dashboard 门禁不需要启用且没有 Dashboard 密码时，继续返回现有的无门禁状态。
- Dashboard 密码错误时继续返回 `401`，并复用现有登录失败限流行为。
- API 调用使用 `dashboard_password` 时，应返回与其他错误 API key 相同的无效 API key 错误。

## 安全说明

该设计提升了凭据隔离，但 `dashboard_password` 仍以明文存储。这符合本次选择的运维模型，也与当前 `proxy_api_key` 的行为保持一致。

运维时应为 `proxy_api_key` 和 `dashboard_password` 使用不同的值。文档需要明确提示：复用两者会抵消凭据分离带来的安全收益。

如果服务通过反向代理或隧道暴露，可能仍然需要配置 `server.trust_proxy: true`，让 Dashboard 门禁能正确区分远程客户端与 localhost。

## 测试

新增或更新以下测试：

- 未配置 `dashboard_password`、已配置 `proxy_api_key`：Dashboard 登录继续使用 `proxy_api_key`。
- 已配置 `dashboard_password` 和 `proxy_api_key`：Dashboard 登录只接受 `dashboard_password`。
- 已配置 `dashboard_password` 和 `proxy_api_key`：API 路由拒绝 `dashboard_password`，接受 `proxy_api_key`。
- 已配置 `dashboard_password`、未配置 `proxy_api_key`：Dashboard 门禁启用；API key 强制校验保持当前未配置 `proxy_api_key` 时的既有行为。
- 空字符串 `dashboard_password` 按未设置处理。

## 发布与迁移

这是一个向后兼容的配置新增。现有部署不需要修改。

需要分离凭据的用户可以在 `data/local.yaml` 中添加：

```yaml
server:
  proxy_api_key: "api-client-key"
  dashboard_password: "dashboard-login-password"
```

然后通过现有部署流程重启或重载服务。
