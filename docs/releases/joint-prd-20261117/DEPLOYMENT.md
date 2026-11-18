# 使用本次源码和已编译工作台

这是源码更新包。核对包内 `RELEASE.json` 的提交号与文件清单。项目保留 `source/package-lock.json`，生产网页的客户端与服务端位于 `source/apps/web/build/`。封包不附带私有规则、业务库、账号、密钥、Node 或 PostgreSQL。

在独立运行目录准备 Node.js 24.22.1 或项目支持的更新版本、PostgreSQL 和该实例的配置。在 `source/` 运行 `npm ci`，按 `source/docs/studio-deployment.md` 配置本实例的数据库与 API，使用 `npm run db:migrate` 初始化目标库，然后按项目的部署方式启动 API 和 Web。网页入口为该实例的 `/admin/workbench`。

已安装实例的管理员可对照包内来源和实例版本选择部署窗口。原业务库、私有写作包和本机配置由该实例保管。原机安装状态见 `source/docs/LIVE.md`。验证原实例时，登录并打开既有稿件，先核对 6098 的 p38，然后核对 MiP 的中英文。批准、生成和对外发布均有各自的页面动作。
