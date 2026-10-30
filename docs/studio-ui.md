# Chipshow Studio 本地界面接续

本页记录 K 盘 Studio 的实际界面、检查结果和仍未接入的功能。Figma 页面与本地导出见项目 design/ 目录。

## 实际入口

- 首页：http://127.0.0.1:53180/
- 更新日志：http://127.0.0.1:53180/changelog
- 我的工作台：http://127.0.0.1:53180/more
- 后台：http://127.0.0.1:53180/admin；未登录跳转登录页。

源码为 `K:/codex/AIHOT/source`，Node 为 `K:/codex/AIHOT/runtime/node/node.exe`，API 为 4311。没有新增 `/studio`、第二套系统、数据库或公开管理接口。

## 改了什么

1. `site/site.ts`：Chipshow Studio 显示名、LED 商显行业词和站点介绍；关于页不再承诺未经验证的自动采编效果。保持既有 MCP 前缀和接口版本。
2. `site/brand/Logo.tsx`：本站两行文字字标，适配侧栏和手机；不用官方 AIHOT 商标。
3. 首页沿用现有资讯、筛选、搜索和时间线；使用 `ReadingLayout`、`AsideCard`、`IntentLink` 增加右侧工作台、内容管理、当前内容说明。没有把管理数据载入首页。
4. 桌面侧栏和手机“我的”增加实际管理后台入口。桌面完整导航保留精选、全部资讯、热点、日报、主题、收藏、我的、Agent 接入、关于、日志、反馈。
5. 更新日志沿用已有 `site/changelog/FeatureRelease.tsx` 扩展点。原创 SVG 用横向青灰线纹、显示屏轮廓与 LED 像素矩阵；四个入口有连续流程线和节点，桌面横排、手机竖排。公开正文采用运营表达。
6. 主题页注明仍有 AI 示例，未把示例目录伪装成已配置的 LED 目录。
7. 发现已有试验稿的 original 地址指回自己。在详情页把这个按钮改为“引用来源”，同页跳到含真实资料链接的正文；普通外部原文入口保持原行为。没有修改数据库中的 original 地址。

## 页面与操作核实

完整记录在 `K:/codex/AIHOT/evidence/migration-writing-20261029/studio-ui/`。

- 浏览器覆盖首页、全部、试验稿详情、日报、热点、主题、收藏、我的、更新日志、后台登录。1600 和 390 宽全覆盖，1024 宽检查首页、全部和更新日志；均 200、无横向溢出、无页面脚本错误。
- 登录现有后台后检查信源、内容、运行、设置页面；匿名 `/api/admin/me`、`/api/admin/nav-counts`、`/api/admin/settings` 均 401。登录操作只使用本机既有配置，不保存密码或 Cookie 到交付。
- 首页 22 个去重的内部导航、筛选、文章链接全部可访问；已验证搜索、详情收藏后在收藏页出现、手机“我的”进入后台登录、日志类型筛选、试验稿引用来源锚点。
- K Node 的 web typecheck、build 均通过。原有 page-width 检查 Chromium/WebKit 均通过。最后仅调整 SVG 和公开文案后，只重建并查看桌面/手机截图，按用户要求不再运行额外回归。
- 2026-10-30 经用户明确授权、先通知后使用 `K:/codex/AIHOT/tools/local-runtime.mjs stop/start` 重启本地服务。临时 53181 预览已停；最终截图取自正式本地 53180。

## 真实缺口

- 原站模型榜、Tibo 重置监控未在当前 `site/modules` 配置中接入；没有复制其专有页面或放置空入口。
- 原站专用更新日志图不在当前开源站点中；本次采用原创 LED 图形。未复制原站 Logo、备案或性能成绩。
- 行业分类与主题仍含框架 AI 示例，LED 目录配置由主线处理；日报、周报、月报和热点按真实数据展示，未补造记录。
- 后台沿用既有账号验证；公开 API 没有增加管理信息。阅读网页不调用付费模型。
- D 盘旧目录的 policy 拒绝按用户要求保留，本 worker 未进行 D 盘清理。未改 providers、数据库、写作提示词、design 或 K 根入口，未提交 Git。

## 给 Figma worker / 主 Agent

请抓取已上线的 `http://127.0.0.1:53180/` 与 `/changelog`，使用本文件所在源码，不再用旧 MyHOT 截图。最终 PNG 为 `home-1600.png`、`home-390.png`、`changelog-1600.png`、`changelog-390.png`；深色日志另有 `changelog-dark-1600.png`、`changelog-dark-390.png`。
