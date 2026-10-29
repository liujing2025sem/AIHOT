# AIHOT 本机试验与同事接续

2026-10-28，America/Los_Angeles。本机维护入口：`local/led-predeploy-20261028`。这是部门部署前的测试候选，尚未批准生产部署。

## 已准备的内容

- 原 fork 的摘要保留、LED 编辑规则与三源配置合入本机分支；上游同步至 `79d962e`。
- 原有 18 个示例源保留；3 个 LED 源仍默认停用。Kinglight 采用详情原发布日期和完整标题。
- `scripts/pilot-collect.ts` 用本机隔离库实跑三源各两次；不会启动 worker 或模型。
- `scripts/pilot-drafts.ts` 把选定的 Agent 辅助草稿放进本机预览，明确标注非流水线产出。
- `scripts/check-upstream.mjs` 只检查原项目变化，不自动合并、部署或调用模型。

## 这台机器

源码 `D:/CodexData/AIHOT`；Node `D:/dev/tools/node-v24.22.1/node.exe`。本机预览 `http://127.0.0.1:53180`，API 为 4311。环境文件在源码根 `.env`，不进入交付包；没有模型 API key。

PostgreSQL 16.15 位于 WSL Ubuntu-24.04，隔离实例目录 `/home/dev/aihot-predeploy/postgres`、端口 5448；发行版实际存储在 D 盘。它与历史云端受拒数据库没有关系。此处实测为 PostgreSQL 16；上游 Docker 默认 17，目标机器仍须核验。

数据库已启动时，在源码根运行：

```powershell
pwsh -NoProfile -File scripts/start-local.ps1 -NodePath D:/dev/tools/node-v24.22.1/node.exe
```

该命令检查端口占用、启动 API 和 web，并读取健康页。已在运行则沿用现有预览，不重复启动。它不启动 worker，也不开放局域网访问。进程编号和日志位于 `.data/local-runtime`。

若隔离数据库未启动，在 WSL 执行：

```sh
/usr/lib/postgresql/16/bin/pg_ctl -D /home/dev/aihot-predeploy/postgres -l /home/dev/aihot-predeploy/postgres.log -o '-p 5448 -h 127.0.0.1 -k /home/dev/aihot-predeploy' start
```

## 同事机器推荐路线

**推荐 WSL2／Docker 路线。** Windows 原生已验证网页和局部数据库读回，但上游停机恢复测试使用 Linux 信号，不能直接将 Windows 全套结果解释为通过。

1. 从交付包读取 `START_HERE.md` 和 `A2A_HANDOFF.json`，再从离线 Git bundle 克隆源码。保留该包记录的 HEAD；不要从 README 中的上游地址重新克隆并丢掉本地改动。
2. 按 `docs/deploy.md` 建独立测试环境。使用 Node >=24.22.1 和上游指定的 PostgreSQL 17／Docker；运行 `npm ci`，无需复制作者的 node_modules、数据库或登录信息。
3. 自行生成该机器的 `.env`。保留 `COLLECT_ENABLED=false`、`MODEL_CALLS_ENABLED=false`、所有外发开关 false；先完成迁移、构建、网页与公开读取检查。
4. `scripts/local-checks.mjs` 从 `.env` 读取隔离数据库连接，并派生另一个 `*_suite_test` 库，避免网页占用的库成为测试模板。测试中的模型调用只连接测试自己启动的假服务，不是自动成稿质量证据。Linux 全套测试前先构建 web，且必须保留 Git 元数据。
5. 只在独立本机 `*_test` 库运行 `node --env-file=.env scripts/pilot-collect.ts <receipt.json>`。它手动处理三个停用源，保存每次网络结果与数据库状态，保留失败；不把两个成功轮次当长期稳定性。
6. 英文样稿可用 `node --env-file=.env scripts/pilot-drafts.ts <materials-directory>` 载入本机演示。这里的日期是样稿制作时间，正文保留外部消息日期；不是把历史消息更新为今天。
7. Harness 独立候选随主包提供，其原始源码基点是另一个提交，尚未接进本网站。按 harness 内入口测试；不要自动应用历史宿主补丁到本分支。

## 自动采编仍缺的证据

2026-10-29 已用 OpenCode DeepSeek V4.1 Flash 完成一次真实编码 API 调用，并完成两次无原聊天上下文的 Codex 文件采编接棒，见 `editorial-pilot.md`。这不是资讯后台自动采编：连续多日生成样本、原 News Hub 完整源码、中文审核→英文交付→精确版本批准→WordPress 回写，以及同事第二台机器仍未验收。原生 OpenCode 客户端启动被平台自动审批拒绝，不能计为通过。

三份 LED 素材由当前 Codex 会话制作，可作为人工参照；没有将它们记为 AIHOT 自动生成。外部厂商声明不构成 Chipshow 性能证据。模型账户和费用由既有 Owner 配置，不能从本机 Codex 登录中自动取得或转移。

## 更新维护

```sh
node scripts/check-upstream.mjs --out <status-directory>
```

存在代理需求时只给本次命令添加 `--proxy <proxy-url>`。本机历史 Git 全局代理 7897 已失效；本次下载和检查使用现有 10808，没有改全局代理。接收机应使用自己的网络配置。

本机已登记 `AIHOT-Upstream-Weekly`：每周一 09:00 America/Los_Angeles，用户登录时执行，错过后补跑。结果在 `D:/CodexData/AIHOT-runtime/upstream/status.html`；不向聊天或第三方发消息。检查失败保留原因；发现更新后由维护者在本分支评估并测试。自动检查不是自动升级。
