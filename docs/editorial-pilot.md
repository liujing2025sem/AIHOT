# LED 采编文件接棒试验

这个入口让没有原聊天上下文的 Agent 从真实采集快照完成选题和中英候选稿，回到本地形成可读审稿页。它用于同事部署前试验，不是找回的 News Hub 源码，也不启用 PR1 harness、自动模型调用、人工批准或 WordPress 发布。

## 重跑一次

使用 Node 24.22.1 和本仓库已安装的依赖。采集步骤和本地数据库按 `local-pilot.md`。在仓库根目录运行：

```sh
node --env-file=.env scripts/editorial-pilot.ts export /absolute/path/led-pilot led-commercial-20261029
```

导出只读取本机 `*_test` 数据库的三个 LED 信源。保留原文、原日期、article ID 和版本；不改采集记录和公开内容。此试验固定选择已采集的 Macroblock 显示研讨会产品组合与 Kinglight 户外二合一灯珠文章，其他材料也需要逐条给出选题判断。

把生成的 `START_HERE.md`、`request.json`、`RESPONSE_FORMAT.json` 交给新 Agent。告诉它唯一的输出文件路径和 run_id，例如 `coldstart-a`。费用或模型无法读取时保留未知，不可写 0 或猜身份。比较第二轮时用新的 Agent，给同一输入和不同 run_id，禁止读取第一轮答案。

```sh
node scripts/editorial-pilot.ts receive /absolute/path/led-pilot /absolute/path/response-a.json
node scripts/editorial-pilot.ts status /absolute/path/led-pilot
```

打开 `received/coldstart-a/review.html`：选题结果、中文审稿、英文素材、出处与交接分四个页签。中英 Markdown、原响应和回执在同目录。`KEEP` 只表示进入选题池；不等于人工批准。

## 中断或换机后

复制完整试验目录及当前源码，安装锁文件依赖后再次运行 receive 即可；接收不需要数据库、`.env` 或 API key。同一回包重收返回 ALREADY_RECEIVED；已有稿件的人工编辑保留。接收进程只写完部分文件时，新进程补全缺失输出；已有内容不一致则报告冲突，不覆盖。

原材料变了需另建任务目录，不能把旧回包套到新版本。收据只证明与**导出的快照**对应，不证明采集库或官网此刻没有更新。正式编辑系统还需要绑定当前数据库版本和原负责人的批准；本试验没有实现该正式审批链。

## 如何判读试验结果

- 比较同一批材料的选题判断以及两份稿件保留的型号、数值、单位、前提和供应阶段。
- 自动检查只覆盖逐条完成、来源版本、引用存在及离线页面清理，不证明推理正确或事实审核通过。
- 汽车座舱背光和混合显示业务的取舍是本次商显编辑选择，不修改主框架的宽召回规则；缺正文保持 HOLD。
- 关键词与 meta description 可供编辑使用，搜索需求、排名、AI引用和销售采用需另有业务证据。
- 两次成功是小样本接棒证据，不代表多日稳定生产或第二台实体电脑通过。

相关必要检查：`node --import ./tests/standalone.ts --test tests/editorial-pilot.standalone.test.ts`；`npm run typecheck`。浏览器打开实际生成的 review.html 检查四个页签和移动端。此次不改公开站点，不需要重复整站浏览器回归。

## 已接入的 OpenCode DeepSeek 编码调用

用户在 2026-10-29 指定 OpenCode DeepSeek V4.1 Flash，本机已将授权凭据保存到 Git 忽略的 `.env`，未放入交接包。当前固定 Go API base 为 `https://opencode.ai/inference/go/openai/v1`、模型 `deepseek-v4.1-flash`。`MODEL_CALLS_ENABLED` 仍为 false。同事使用自己的配置与账号，不复制作者凭据。

`scripts/pilot-opencode.ts` 只在显式测试进程中开启模型，执行一次日期解析代码审查，经原 `chatJson → paidRequest → PostgreSQL receipts` 保存实际回执。任务及 session ID 固定落盘，不启动 worker，不提供自动换模型或换计费入口。再次执行同一输出路径仅回读结果。

```sh
node --env-file=.env scripts/pilot-opencode.ts /absolute/path/opencode-live.json
```

当次实测返回模型 `deepseek-v4.1-flash`，约12.846秒，130输入/167输出tokens，`billing_source=go`，`usage.cost=0`美元，`allowance=0.00017955`。这是一次实际接口和原数据库回执测试，不能推导未来每次免费或原生客户端接入完成。

[Go官方适用范围](https://opencode.ai/v2/docs/console/go/)要求典型编码Agent流量和稳定会话标识。当前配置只用于编码；LED文章继续通过上面的 Codex 文件接棒。共享调用器在缺少编码session或试图隐式fallback时直接报错，避免新闻worker误用该配置。

`scripts/pilot-opencode-cli.mjs` 已准备原生 OpenCode 1.18.30 独立配置和同session新进程接续，但平台自动审批拒绝了本次启动，理由仅为 `blocked by policy`。因此该脚本为**未执行候选**，不计为原生harness通过；后续Agent不得换入口重试这次拒绝。原PR1 harness宿主集成仍未启用，旧审计HOLD亦未因此解除。
