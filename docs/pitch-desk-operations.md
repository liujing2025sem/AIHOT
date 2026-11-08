# 命题采编操作与部署

本次扩展基于 PR #17；公司真实参数与密码留在目标机，不提交仓库。

## 运营使用

打开 Studio 顶部“+ 命题”，填写问题，核对自动脱敏结果；选择升级页时填现有网址。提交后后台依次抽关键词、检索本库、读取所给链接、拟定大纲。

备料卡逐条显示原文摘句、来源和缺口。选择素材和标题，删改大纲。没有工程回复时用保守写法；有回复时录入答题人、原回复（如 1A 2B）和非保守选项的依据。不替工程师署名。

确认后点击“生成英文稿”，转到已有任务。英文稿仍需人工审稿批准，之后才可推 WordPress 草稿。升级稿标题带 [UPDATE]，正文列出改动；现有文章的正式 URL 不会自动替换。

素材页的搜索现在查标题和正文。技术备料不受短讯新鲜度窗口限制；日期未知如实显示。重复的同题或同 URL 继续原卡和任务。

## WorkBuddy 安装

先停止目标安装的应用，保留数据库和 runtime 私有配置。更新 source 为本 PR 与 PR #17 的合并代码，运行 npm ci 和 web build。将仓库 deployment/portable/local-runtime.mjs 复制为安装目录 tools/local-runtime.mjs；它继续复用已有 studio-common.mjs。

在目标 runtime/studio.env 中设置 STUDIO_WORKER_ENABLED=true；已获模型调用授权时再设 STUDIO_MODEL_CALLS_ENABLED=true。正常 start-studio.cmd 会先运行迁移，再一起启动 API、Web 和专用 Studio worker。专用 worker 只处理手动命题/成稿，不启动旧热榜、定时采集或对外推送队列。

公司事实文件路径可配置 AIHOT_COMPANY_FACTS_FILE，格式参考 site/company-facts.example.json 和 studio-company-facts.ts，最多 30 条；未提供时界面显示未配置，不能声称公司事实已核验。

普通 Linux/Docker 部署运行现有 worker 入口，设置 STUDIO_WORKER_ONLY=true 和既有 MODEL_CALLS_ENABLED=true，即只处理人工命题任务。无需 WorkBuddy 或其他 Agent 常驻。

## 当前边界

备料实际使用两次 Flash 调用，每次有既有费用回执；资料不足只使用第一段。供应商未回报费用时记未知。确认经过时间是墙钟等待时间，不能冒充人工投入分钟。

人名和公司名的规则脱敏无法穷尽，运营须确认预览后再提交。PDF 目前不能保证由现有网页抽取器解析；失败时保留原因并要求提供网页版，不伪装抓取成功。工程确认不代表所有内容已由工程审核；没有真实回复不展示工程团队署名。
