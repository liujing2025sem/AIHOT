# AIHOT 选择式采编修复与 UX2 参考校准

日期为 2026 年 11 月 10 日，时区 Asia/Shanghai。本记录补充上轮交付，不覆盖原 UX2 计划。

## 本轮结果

目标是让运营给出命题后通过选择完成采编，并保留已经明确开启的一键上线方式。PR #23 的既有检查发现两个真实前端失败。本轮只修复交付入口的显示条件，没有扩展模板、图片生成或平台发布范围。

同稿件成品区可以复用文章、配图预览、社媒文本及交付回执。候选封面采用、逐图重做、分页图文和完整成品版本库仍是待实现建议。5 秒理解与 15–30 秒操作仍需真实用户测试。

## 已观察到的失败与修复

[Check #28](https://github.com/liujing2025sem/AIHOT/actions/runs/42805458925) 检查候选 `e0abdf2b84b6232b242ab19edb67132d91f98539`。Web tests 为 100 通过、2 失败。Typecheck、Web build 和 Docker smoke 通过。后端测试与 built-site smoke 被跳过，不能记为通过。

两个失败来自同一行为用例，在桌面宽度 1440 和手机宽度 390 时都找不到未人工批准稿件的“直接上线”按钮。日志原文如下。

```text
Expected: disabled
Timeout: 5000ms
Error: element(s) not found
```

`studio-draft.tsx` 将整个交付组件包进了 `approved` 条件，误把人工审核状态当成一键上线的前置条件。`docs/LIVE.md` 的 D-01、D-18、G1，以及现有前后端测试，都保留了明确开启 one-click 后无需制造人工批准的路径。

本轮只修改同一文件的 3 行。

- 普通稿件恢复交付组件。一键上线仍受原有设置、未保存修改和处理中状态限制。
- 已绑定原页的升级稿继续在人工批准后显示影子预览交付，内部始终不显示普通直接上线。
- 人工导出继续只在批准后显示。原测试及其输入数据不变。

独立复核指出，无条件恢复整个组件会提前显示未批准升级稿的影子预览按钮。最终修复按是否绑定原页分流，保留了原升级稿测试的约束。

## 本地验证与边界

- `npm run typecheck -w @aihot/web` 通过。
- `npm run build -w @aihot/web` 通过，包含客户端与服务端构建。
- `git diff --check` 通过。
- 本机浏览器启动已有明确拒绝记录。本轮没有重试浏览器、切换环境或触发配图渲染。
- 本轮没有数据库、付费模型、WordPress 写入、合并或部署。
- 修复后的浏览器及数据库结果以新候选的既有 PR 工作流为准。本记录保存时尚未取得新候选结果。

本轮应用 pstack 的 Model the Domain，将人工批准与显式上线设置分开；应用 Test Behavior, Not Implementation，保留原测试；应用 Prove It Works，区分编译通过与实际操作通过。原生 Cursor 插件工具不在此环境，使用当前可用的独立 Agent 复核与差异检查。

## UX2 需要校准的事实

| 参考表述 | 代码与现行决定 | 后续处理 |
|---|---|---|
| 继续沿用 React + MUI | 当前是 React、React Router、Radix 和 Tailwind，未安装 MUI | 保留交互方向，组件迁移仍为待确认建议 |
| 只交 WordPress 草稿 | 默认人审草稿；明确开启 one-click 后保留直接上线 | 不能用旧计划收回既有 D-01、D-18 决定 |
| 7 天新闻窗口 | 当前采用新闻 14 天、上游更新 30 天 | 不恢复旧窗口；短讯按独立事件计数 |
| 所有成品已能找回并采用 | 稿件与部分回执已持久保存，图片预览和完整资产版本管理尚未统一 | 区分按需预览、采用记录和已交付记录 |

## 同稿件成品区可复用范围

| 项目 | 现有能力 | 明确缺口 |
|---|---|---|
| 文章 | 中文决策摘要、英文编辑、来源、版本校验、修改建议、导出 | 内嵌排版成品预览与完整历史恢复界面 |
| 图片 | 真实 PNG 预览、ALT、图注、质量说明、WordPress 媒体回执 | 封面候选采用、逐图重做、段落位置编辑 |
| 社媒 | Facebook、LinkedIn 中英文纯文本派生、审核与导出 | 分页图文卡片和平台自动发布 |
| 交付 | WordPress 草稿及直接上线后的结果、抽查、纠错与回滚入口 | 同稿件完整资产历史视图 |

图片区当前的 GET 会按需调用渲染器，返回值没有绑定明确稿件版本。后续不能在打开成品区时静默反复生成，也不能把迟到预览标为当前已采用版本。现有正文配图在发布时统一追加文末，段落位置选择尚无实际实现。

主稿件路径以外仍有必填点。社媒派生要求发布 URL，社媒退回要求文字，上线后“改一处”要求填写替换内容。全系统零必填尚未验收。后续应从真实交付回执提供 URL 选择，给退回及纠错提供可采纳建议，同时保留选填编辑。

## 后续顺序与证据入口

先验收 PR #23 的修复候选，再在现有稿件页整合真预览与交付记录。模板复用、局部重做和新平台分别作为有明确范围的增量，不复制参考产品的全部模块。

- [PR #23](https://github.com/liujing2025sem/AIHOT/pull/23)
- [原 UX2 目录](https://drive.google.com/drive/folders/1ddY-wLvIRElHvjKbnDE8CaaVXGL8yr7_)
- [WorkBuddy 参考评估](https://drive.google.com/file/d/1EkNviSqsNXhIQewkWonheMriGYXGJLqV/view)
- [参考增量 JSON](https://drive.google.com/file/d/1LC8Ulg_EP1TBBZKB2B-lBsBAdWYx__hQ/view)
- [原 UX2 计划书](https://drive.google.com/file/d/1HkhIs8PUAKVVK5nPqGWtTCOeehBxg2ET/view)

源码核对范围包括 `apps/web/package.json`、`studio-draft.tsx`、`studio-social.tsx`、`studio-published.tsx`，以及后端对应的稿件、配图、社媒与发布模块。参考增量原件将 REF-01、REF-02、REF-03 均标为 proposed，全部体验验收标为 not_run。本轮没有把这些建议升级为已实现状态。
