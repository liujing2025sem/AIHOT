# Studio API 渠道

账户仍使用原单管理员认证。本轮取消的账户、角色、权限和 0090 迁移已撤回；没有运行这些迁移，没有改动管理员登录页或 layout。

## 主 Agent 接入

API 在 `apps/api/src/app.ts` 导入 `registerAdminChannels`（`./routes/admin-channels.ts`），在现有后台注册附近调用 `registerAdminChannels(app)`。

Web 在现有 `admin-layout` 内加入：

```ts
route("admin/channels", "routes/admin/channels.tsx")
```

导航由主 Agent 加入“API 渠道”，链接 `/admin/channels`。此实现没有修改 app.ts、routes.ts 或 layout.ts。

| 接口 | 用途 | 请求 |
| --- | --- | --- |
| `GET /api/admin/channels` | 三个渠道、掩码、密钥来源、当前选择、模型调用总开关 | 原管理员 cookie |
| `PUT /api/admin/channels/:id` | 保存、启停、切换或清除密钥 | JSON + 原 CSRF |
| `POST /api/admin/channels/:id/test` | 模型列表或一次显式生成测试 | JSON + 原 CSRF；生成测试还需 `Idempotency-Key` |

渠道 ID 为 `opencode-go`、`deepseek`、`custom`。写入字段：`baseUrl?`、`model?`、`enabled?`、`key?`、`deleteKey?`、`activate?`、必填 `reason`。空白 key 保留原密钥；只有 `deleteKey: true` 清除。`activate: true` 必须有启用状态、模型及密钥。停用当前渠道后默认调用报错，不会静默换服务商。

测试请求分别为：

```json
{ "kind": "models" }
```

```json
{ "kind": "completion", "confirmPaid": true }
```

测试响应包含 `ok`、真实 HTTP `status`（未收到 HTTP 响应时为 null）、配置模型 `model`、服务端返回的 `returnedModel`、模型列表 `models`、`modelAvailable` 和 `detail`；成功生成另有 `receiptId`。HTTP 200 但没有可用内容不记成功；`/models` 404 不代表生成可用。生成测试使用 16 个最大输出 token，经过原 `paidRequest`、预算和回执；相同幂等编号复用已收到的结果。

## sourceConfig 与真实调用

`packages/backend/src/providers/llm.ts` 的 `chatJson()` 已接入持久化渠道：

```ts
const result = await chatJson({
  // 其余沿用原 purpose、subject、promptVersion、system、user、schema。
  ...request,
  model: "default",
});
```

`model: "default"` 每次调用查询当前启用渠道。未显式切换渠道时保留原 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL` 行为。原有具名模型 preset 与各能力的选择不被批量改写；采编主线调用默认模型即可使用当前渠道。

若 Studio 的 sourceConfig 要把一个任务固定在特定渠道，只保存不含密钥的 `channelId`，传给同一函数：

```ts
await chatJson({ ...request, model: "default", channelId: sourceConfig.channelId });
```

可用类型为 `AdminChannelId`。`channelId` 只支持搭配 `model: "default"`，不能用它覆盖具名 preset。后端如确需读取解析结果，可调用 `resolveChannel(channelId)` 获取 `baseUrl / model / apiKey / service`；该内部结果不可直接发给浏览器、写入 sourceConfig 或审计。`listChannels()` 是可返回前端的掩码版本。调用路径对渠道、接口地址和模型绑定回执身份，切换接口后不会误用上一服务商的同模型结果。

## 配置来源与移机

- 非密钥配置保存在既有 `settings` 表的 `providers.channels`，修改记录复用 `audit_log`。没有新建凭据表或数据库迁移。
- 密钥保存在既有 `AIHOT_CREDENTIALS_DIR` 对应 models 凭据文件；没有分组目录时，保存至项目原 `.env`。写入保留其他键和注释，通过临时文件更名完成。
- OpenCode Go 优先读 `OPENCODE_GO_API_KEY`；现有 `LLM_BASE_URL` 为 Go 地址时复用原 `.env` 的 `LLM_API_KEY`，不复制用户原密钥。DeepSeek 使用 `DEEPSEEK_API_KEY`。Custom 使用 `CUSTOM_OPENAI_API_KEY`，已有非 Go 默认密钥时可复用 `LLM_API_KEY`。选定的引用保存在渠道配置中，清除后不回落到另一个密钥。
- 每次调用重新读取渠道配置和密钥文件，独立 API/worker 进程可看到新配置，无需重启主服务。显式清除写入空 assignment，可遮蔽旧进程启动时载入的同名环境变量。已有请求继续使用其开始时读取的配置。
- 迁移机器时，由部署负责人携带原数据库与凭据文件；只复制代码不包含渠道配置和密钥。环境变量注入且没有持久凭据挂载的容器，需为原 models 凭据目录配置可写持久挂载。
- 前端和审计仅有固定掩码，不返回原密钥或尾号；服务商错误、模型列表与受管渠道的生成响应也会移除本次请求密钥，防止上游回显。

OpenCode Go 固定为 `https://opencode.ai/inference/go/openai/v1` 和 `deepseek-v4.1-flash`。既有“持久编码 sessionId、不可隐式 fallback”约束保持有效；生成测试也不能通过 Custom 绕开。Go 生成测试需额外提供已有 `sessionId`，采编主线不应伪造编码会话；普通采编使用 DeepSeek 标准 API 或 Custom。DeepSeek Pro 在配置和实际调用前均拒绝。

## 验证与边界

使用 K 盘 Node 运行既有隔离数据库检查器：

```powershell
$env:AIHOT_TEST_TMP='K:/codex/AIHOT/runtime/tmp/tests'
& K:/codex/AIHOT/runtime/node/node.exe scripts/local-checks.mjs tests/channels.test.ts tests/admin-session-revocation.test.ts tests/default-model.test.ts tests/receipts.test.ts
```

首轮 46 项全部通过。渠道测试使用真实本地 HTTP fake endpoints，并启动独立 Node 进程证明持久配置可重新读取及真实出站调用；验证 baseURL/model/key 切换、停用、空白保留、显式删除、原注释保留、掩码及审计不泄密、CSRF、`/models` 状态和显式生成回执。未调用真实付费模型，未改真实渠道设置，未重启现有主服务。API/Web 注册及与采编 sourceConfig 的产品级连通由主 Agent 集成。

生成开关通过 PUT /api/admin/channels/generation {enabled:boolean} 管理，保存到模型凭据文件，服务端每次请求读取；页面可直接开关，无需编辑环境文件。/admin/studio的API成稿使用真实chatJson与预算回执，不模拟生成。
