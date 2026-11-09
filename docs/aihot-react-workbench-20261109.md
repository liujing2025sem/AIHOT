# AIHOT React 编辑台改版交接

日期：2026-11-09。范围：真实 React 前端主路径与共享交互组件。

## 1. 这轮交付

采用 AiToEarn 同类的组件化工作台：Radix UI 交互组件，shadcn/ui 源码组织方式，Lucide 图标。保留现有 React 19、React Router 与后台，不迁移到 Next.js。

当前为独立开发分支，尚未切换运营正在使用的版本。构建和类型检查通过；浏览器点击与视觉验收待完成。没有操作生产数据、模型、采集或发布开关。

| 运营看到的位置 | 本轮变化 | 保留的业务能力 |
| --- | --- | --- |
| 左侧导航 | 固定四个内容入口：今日选稿、专业内容、我的稿件、发布记录；配置移入管理区 | 所有原管理入口仍可到达 |
| 今日选稿 | 带来源、日期、正文状态的可勾选材料卡 | 原始材料、分页、筛选和补齐接口 |
| 已选材料 | 选中后出现固定底栏；显示数量、下一步及不可操作的原因 | 最多选择 12 条；现有自动成稿最多 4 条 |
| 已有稿件 | 首页直接显示“继续审稿”，链接真实待审稿件 | 不重新生成已有稿件 |
| 审稿页面 | 正文为主区，旁边是待确认问题；原因和命中原句按需展开 | 原审核版本、原文版本、指纹与确认记录 |
| 英文交付 | 中文、英文、原文证据用同一组 Tabs 切换 | WordPress 草稿、导出、一键上线原有权限 |
| 手机 | 抽屉导航、可换行操作栏和单列审稿布局 | 相同业务状态，不另做手机后端 |

专业内容继续接既有命题采编页面。本轮通过共享组件改善其输入与按钮；复杂命题备料流程没有再增加新的审批步骤。

## 2. 组件选择与实际实现

| 基础能力 | 使用方式 |
| --- | --- |
| Dialog / Drawer | Radix Dialog：手机侧栏、选稿设置、原有理由弹窗 |
| Checkbox | Radix Checkbox：材料选择与逐项审稿 |
| Tabs | Radix Tabs：中文、英文、原始证据 |
| Accordion | Radix Accordion：管理导航、问题详情、历史和人工介入 |
| Tooltip | Radix Tooltip：侧栏收起后的图标说明 |
| Button | Radix Slot + class-variance-authority，统一按钮层级 |
| Input / Textarea | shadcn 风格源码组件，使用项目既有设计色值与字号 |
| Select | 本轮保留原生选择控件并统一样式，避免改坏现有表单提交 |
| Icons | Lucide React |

组件源码位于 `apps/web/app/components/ui/primitives/`，配置为 `apps/web/components.json`。采用独立子目录，避开已有 `Tabs.tsx` 与 Windows 大小写文件名冲突。`features/admin/ui.tsx` 保留旧调用接口，迁入新组件层，降低其他管理页改动风险。

这是交互组件库迁移。业务卡片、工作台布局和数据连接仍属于 AIHOT。没有复制 AiToEarn 多账号营销业务、自动发布策略或 DSH 子包。

## 3. 必须保留的真实边界

1. 以 PR #20 的最新开发分支为底座。`main` 尚未包含近期命题、配图和上线功能，不能从旧 `main` 覆盖最新工作。
2. `review / one_click / automatic` 设置沿用现有服务端。读取页面和勾选不会改变设置。本轮不启用任何模式。
3. 人审流程继续检查当前版本与逐项确认；一键上线继续使用既有独立服务端核验。不能在 UI 里把“未人工批准”重新变成所有模式的统一禁用条件。
4. `useAdminAction`、CSRF、幂等、版本、原文修订、确认指纹、离开前未保存提示均保留。
5. 自动成稿当前最多处理 4 条材料，按值得写的材料生成稿件。多条合成一期短讯尚未接通。选择 12 条并不等于支持一次生成 12 条，也不等于可以合成一期日报。
6. 已有 6098 待审稿应直接审阅。公开 6098、MiP v3 与 WordPress 状态均未在本轮改变。
7. 默认采集与写作模型是否开启，继续以目标机当前配置为准。界面改版不能代替配置和能力验收。

## 4. 已做检查与未完成验收

### 已验证

- `npm run typecheck`：全项目通过。
- `npm run build -w @aihot/web`：客户端与服务端构建通过。
- 非浏览器测试：48 项原有/导航测试通过；新增 2 项生产 SSR 测试通过。共 50 项。
- SSR 使用合成 HTTP 数据，验证真实组件输出、单一当前导航、真实稿件链接、材料勾选控件，以及浏览不发起写入。
- `git diff --check`：通过。
- 独立代码审查发现的选稿设置焦点归还、补齐正文时停止入口被弹窗遮挡，均已修正。
- 安装依赖导致的无关 `libc` 元数据变化已恢复；没有升级原有包的版本。

### 尚未验证

- 浏览器未进入页面：Playwright 配套下载返回非 ZIP；环境已有 Chromium 启动时收到 `socket() failed: Operation not permitted`。收到权限拒绝后停止浏览器尝试。
- 因此没有本轮 390 / 1440 实际渲染截图，不能声称已经通过点击、焦点、无横向溢出或一分钟可用性验收。
- 新增 8 个浏览器用例已写入代码，待正常授权环境运行：4 个选稿/侧栏用例，4 个正文/逐项审核用例。原有一键上线测试继续保留。
- 生产模型调用、真实发布、后端数据库全套测试及目标机部署不属于本轮已完成证据。

## 5. 接续给 Codex

### 分支

- repository: `liujing2025sem/AIHOT`
- branch: `codex/react-editor-workbench-20261109`
- base branch: `codex/autopilot-figures-a-20261108`
- base commit: `c883ed74c0d97c347f4c181127257036138e6711`
- 原 PR 堆叠关系：#18 → #19 → #20 → 本轮前端改版。
- 在已有 PR 堆叠整合前，保持 Draft；不直接覆盖 `main`，不抹掉用户目标机未提交变更。

### 先做这些

1. 确认分支与当前目标机版本关系，保留用户改动。
2. 正常安装依赖，运行类型检查、构建、前端全套测试。测试仅对合成 API，不调用真实供应商。
3. 在有浏览器权限的验收环境，验证 390 和 1440。不要通过放宽权限或换地址绕过任何明确拒绝。
4. 对真实 6098 做只读核对，确认“继续审稿”能进入原稿，禁止为演示重新生成。
5. 汇报验证结果与两张实际截图，再由用户决定切换正在使用的版本。

```bash
npm ci
npm run typecheck
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
```

### 人工验收的四个问题

- 首次进入后，能否在 10 秒内指出“从哪里选材料”和“从哪里继续已有稿件”？
- 勾选 3 条后，能否立即看见下一步？按钮禁用时能否看懂原因和解决方法？
- 审稿时，能否点击问题找到原句，逐项确认，再找到当前可执行动作？
- 浏览、选择、勾选与审批动作，是否都没有暗中触发模型、自动发布或权限切换？

“一分钟内理解”是下一轮用户测试目标，尚未取得实际计时结果。

## 6. 本轮项目记忆

- 用户明确要求 React 组件库，参考 AiToEarn 的左栏与直觉交互。
- 用户的主要工作是从自动采集的信息中选稿、形成短讯或专业内容、核对 AI 提醒、按已授权方式交付。
- 默认首页展示可工作的内容，管理术语和底层状态放入次级入口。
- 每一步应提供明确动作和邻近原因；减少操作员记忆流程、跨页找按钮和解释灰色按钮的负担。
- 组件库决定基础交互质量；业务流程是否直觉，继续用真实采编任务验证。

## 7. 参考证据

AiToEarn 核验版本：`f185b900a095db740afcbfbfef08130bc28b863c`。本轮为官方源码核验，未登录其在线商业工作台。

- [shadcn 配置](https://github.com/yikart/AiToEarn/blob/f185b900a095db740afcbfbfef08130bc28b863c/project/aitoearn-web/components.json)
- [依赖清单](https://github.com/yikart/AiToEarn/blob/f185b900a095db740afcbfbfef08130bc28b863c/project/aitoearn-web/package.json)
- [左侧导航](https://github.com/yikart/AiToEarn/blob/f185b900a095db740afcbfbfef08130bc28b863c/project/aitoearn-web/src/app/layout/LayoutSidebar/index.tsx)
- [底部批量操作栏](https://github.com/yikart/AiToEarn/blob/f185b900a095db740afcbfbfef08130bc28b863c/project/aitoearn-web/src/components/draft-box/components/BatchActionBar/index.tsx)
- [问题汇总](https://github.com/yikart/AiToEarn/blob/f185b900a095db740afcbfbfef08130bc28b863c/project/aitoearn-web/src/components/PublishDialog/compoents/ErrorSummary/index.tsx)

核实结果：AiToEarn 当前基础交互采用 Radix；不能将 Base UI 称为它的原栈。仓库还包含 Ant Design 与其他编辑器，AIHOT 没有照搬全部依赖。
