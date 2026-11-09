# React 编辑台更新说明

适用范围：已在使用 AIHOT / Chipshow Studio 的维护人。包内 `source/` 为完整工程，不是直接覆盖安装目录的指令。先确认当前版本、安装路径和用户未提交改动。

## 1. 版本关系

- repository：`liujing2025sem/AIHOT`
- frontend PR：<https://github.com/liujing2025sem/AIHOT/pull/21>
- branch：`codex/react-editor-workbench-20261109`
- base：`codex/autopilot-figures-a-20261108`，`c883ed74c0d97c347f4c181127257036138e6711`
- 保留 #18 → #19 → #20 的命题、片段成稿与配图/上线功能。本包含这条开发链，不能用旧 main 覆盖。
- 精确提交、源码 tree 与文件校验以根目录 `RELEASE.json` 为准。

## 2. 更新现有 Windows Studio

1. 确认安装目录中的 `runtime/INSTALLATION.json`、`runtime/node/node.exe`、`tools/studio-common.mjs` 和正常启动/停止入口。缺少时停止自动更新，按实际运行方式处理。
2. 查看运行任务。等待正在进行的付费请求结束，使用该实例已有的停止入口。不要终止无法确认归属的进程。
3. 在本机备份原源码、私有配置、数据库和附件。私有备份留在用户控制的位置，不上传进公共封包。
4. 将本包 `source/` 合入新的源码暂存目录，核对目标机独有代码。保留现有 `.env`、`runtime/studio.env`、models/integrations 凭据、公司黑名单、CAMOS 方法运行时及业务库，不用包内示例覆盖。
5. 用现有 Node 24.22.1 或更高版本在暂存源码目录执行 `npm ci`、`npm run typecheck`、`npm run build -w @aihot/web`。新增 React 依赖必须真正安装；不要复制 Linux `node_modules` 到 Windows。
6. 构建成功后再切换该实例的源码目录。使用现有启动器，按“数据库就绪 → 正常迁移 → API/Web/已有 Studio worker”的顺序启动。不要运行全量 `scripts/seed.ts` 重置现有信源；不新开定时采集 worker。
7. 核对当前运行版本与原端口，登录后检查选稿、继续审稿和 6098 原稿。生成或发布需要另按既有权限操作，浏览验收不触发付费请求。

更新失败时保留日志、暂存目录和备份，不清库，不自动重复付费请求。恢复源码前核对是否发生迁移及其向后兼容性。

旧部署文档曾提及完整 Windows 便携包，其打包器和二进制不在本次仓库中。当前包不宣称新电脑离线双击安装已验证。

## 3. 其他已有运行环境

需要 Node >=24.22.1、PostgreSQL、Web SSR、API。命题与成稿任务还依赖 worker。英文 WordPress 交付与模型调用使用已有私有凭据。

项目保留 Docker 配置。发布候选在 GitHub CI 中验证 Docker 构建、启动与 smoke；普通 Compose 文件默认监听所有网卡，实际使用前必须显式限制到本机，例如 `PORT=127.0.0.1:53181`。本次交付不授权开放公网。

已有数据库不要直接运行默认 setup 的全量 seed。不要使用 `docker compose down -v` 删除持久卷。新的独立测试实例需要独立 project 名称、端口和数据卷，避免影响已有实例。

CAMOS 方法检索当前仍有 Windows Python 路径依赖；Docker smoke 通过不证明 Linux CAMOS 全链路可用。

## 4. 验收与回执

确认 390 / 1440 宽度下导航、选中底栏、问题定位、键盘焦点和发布按钮说明；先只读查看已有稿件。浏览器遇到明确权限拒绝就停止，不能改权限或切换方式绕过。

运营验收只回答：找得到材料吗，知道下一步吗，知道为什么不能点吗，能接着审原稿吗。记录实际用时，不把自动化测试数字当作一分钟可用性结论。

交接回执五行：运行版本；入口；实际验收；未完成项；下一步。代码归档、下载或 PR 存在不代表目标端已安装，也不代表外部 Agent 已签收。
