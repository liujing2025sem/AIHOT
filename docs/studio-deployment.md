# Studio Windows 部门主机部署

Grill P0更新含0096–0103共8个迁移，新增选题/画像/搜索/社媒页面，步骤见 [studio-planning.md](studio-planning.md)。既有安装须先迁移再加载应用；只拷源码不代表运行服务更新。新信源配置全部停用，不自动seed到已有业务库，36题示例也须运营确认后导入。保留目标端私有配置和业务库。

## 给使用者的入口

这是可复制的 Windows x64 运行包，适合一台部门电脑作为主机、同事通过浏览器共用。所有 Studio 使用者沿用现有管理员登录；不初始化角色或成员。

1. 将整个 ZIP 解压到一个可写目录，例如 `D:\Studio`（目录名可改，支持空格）。不要从 ZIP 内直接运行。
2. 双击 `install-studio.cmd`。默认只允许主机本机访问；端口可在安装时填写。安装不联网下载依赖。
3. 打开本机 `runtime\FIRST-RUN-CREDENTIALS.txt` 取管理员密码。密码不打印在终端，不进入通用包。妥善保存后可删此一次性说明，实际凭据在 `runtime\studio.env`。
4. 双击 `start-studio.cmd`。默认登录地址 `http://127.0.0.1:53180/admin/login`。
5. 离开前可双击 `stop-studio.cmd`，停止本目录的 Web、API 与数据库。

Node 24.22.1/npm 和 PostgreSQL 16.15 二进制、实际安装依赖、最终网页 build 均随包携带。无须另装 Node/PostgreSQL/npm/Git/Python；不依赖 WSL、Docker、原电脑开发目录或 D 盘开发环境。目标电脑需 Windows x64、可写目录和未被占用的端口；本包不注册 Windows 服务、不设置开机自启、不修改系统 PATH 或防火墙。未启动定时 worker，采集、模型调用、外发默认关闭。API 渠道可由主 Agent 的后台功能配置；是否已接入并通过调用验收，以主 Agent 的业务验证为准。

## 安装参数与访问设置

下面的命令在部署包根目录执行，使用随包 runtime，不调用系统 Node。

```powershell
.\runtime\node\node.exe .\tools\install-studio.mjs --non-interactive --web-port 53181 --api-port 4312 --db-port 5449 --db-name studio
```

自动生成数据库密码、会话密钥、图片签名密钥和管理员密码。自定义管理员密码请先在本机创建一个私有文本文件，再使用 `--admin-password-file C:\private\admin.txt`，避免把密码写进命令行历史。最少12位。安装拒绝覆盖已有 `.env`、`studio.env` 或数据库目录；安装中途失败后先看错误和 `runtime/logs/install.log`，保留私有凭据，在新的解压目录重装，不自动删除或重置已有库。

启用局域网时，显式填写这台主机的一个内网 IPv4 地址：

```powershell
.\runtime\node\node.exe .\tools\install-studio.mjs --non-interactive --mode lan --host 192.168.1.20
```

同事访问 `http://192.168.1.20:53180/admin/login`。脚本仅接受当前主机的 RFC1918 地址，拒绝 `0.0.0.0` 和公网 IP；API 和数据库始终只监听 `127.0.0.1`。脚本不开放 Windows 防火墙。若局域网不通，由电脑管理人按部门网络规则处理；不得据此宣称外网已上线。

安装后设置在 `runtime/INSTALLATION.json` 的 `settings`。修改访问方式/端口前先停止服务；`databasePort` 若修改，需同时修改本机 `runtime/studio.env` 的 `DATABASE_URL` 端口。换电脑导致内网地址变化时，也应更新 `webHost`。将已安装的完整目录搬家，先停止服务；启动时会重建指向新目录的 workspace 链接。推荐跨机使用干净包安装，再走下方私有迁移，避免把旧登录会话带到新机。

```powershell
.\runtime\node\node.exe .\tools\local-runtime.mjs status
```

状态命令显示当前根目录、Web/API/数据库端口、进程归属和健康检查，不输出密钥。端口被其他程序占用时直接报错，不替换其他实例。

## 替代启动方式也必须执行迁移

`start-studio.cmd` 会在数据库就绪后执行 `source/scripts/migrate.ts`，成功后才启动API/Web。WorkBuddy受管理持有器、其他harness或自定义服务入口也必须执行相同顺序，传入当前安装的 `appEnv()`，并在迁移失败时停止启动。仅启动数据库和两个应用进程不够。

已发生故障：WorkBuddy持有器跳过迁移，旧库缺少0093/0094/0095的 `blocked` 状态约束更新，首个BLOCK返回500和 `studio_tasks_state_check`。补跑后恢复正常。本次修复本地 `tools/_wbtest-run.mjs`，增加 `workspaceLinks → startDb → run(migrate.ts) → launch`；修改持有器文件不会重启运行中进程。

复用 `tools/studio-common.mjs` 的 `run(node, [path.join(source, 'scripts/migrate.ts')], {env: appEnv(), cwd: source, stdio: 'inherit'})`，不要另写迁移器或手动改历史SQL。健康检查成功不证明迁移已齐，仍需看迁移结果和BLOCK业务路径。

## 私有数据、附件与服务端 API 渠道迁移

通用部署 ZIP 默认不含本机 `.env`、`runtime/studio.env`、数据库、业务附件、渠道密钥或历史 sessions。以下命令才会显式创建私有迁移资料；只能留在本机或用户控制的私有离线介质，不上传云端。备份会先停止本目录应用，保留数据库运行，确保数据库与附件不再被应用修改；备份后需手动重新启动。不要同时运行独立 worker 或其他写库程序。

在旧主机包根目录执行：

```powershell
.\runtime\node\node.exe .\tools\studio-data.mjs backup --out C:\private\studio-transfer --include-channel-keys
```

输出目录含 `database.dump`、`files/`（业务附件和后端维护的渠道配置文件，跳过缓存及旧备份）、`channels/`（显式选择迁移的渠道环境变量及 models/collectors/integrations 凭据文件）和简短说明。数据库内保存的渠道设置随数据库迁移；数据目录下保存的渠道设置随 files/ 迁移；新管理员密码和 SESSION_SECRET 保持新机生成值，admin_sessions 不导出。

在新主机先完成空白安装，再执行：

```powershell
.\runtime\node\node.exe .\tools\studio-data.mjs restore --from C:\private\studio-transfer --database studio_restored
.\runtime\node\node.exe .\tools\studio-data.mjs import-config --from C:\private\studio-transfer\channels
.\start-studio.cmd
```

恢复必须指定一个不存在的新库名；不会覆盖旧库。附件目标须为空。完成恢复及向前迁移后才把本机 `DATABASE_URL` 切到新库。保留原空白库；不自动删库。恢复后重新登录，不迁移原会话。

仅迁移服务端渠道环境变量/凭据文件时：

```powershell
.\runtime\node\node.exe .\tools\studio-data.mjs export-config --out C:\private\studio-channels
# 在新主机
.\runtime\node\node.exe .\tools\studio-data.mjs import-config --from C:\private\studio-channels
```

`import-config` 会停止本目录应用，保留新机 DB/管理员/会话密钥，完成后重新启动。凭据文件已有同名文件时停止导入，先由维护人比较，不能直接覆盖。`export-config` 不替代数据库与 files/ 备份；后台保存的配置要用完整私有备份迁移。私有文件默认限制为当前 Windows 用户及 SYSTEM 可读写；浏览器共用者不需要文件权限。此部署不涉及账号/角色系统。

给主 Agent 的渠道存储接续约定：业务渠道配置写在现有数据库、`AIHOT_DATA_DIR` 或 `AIHOT_CREDENTIALS_DIR`；禁止写死原电脑绝对路径。若渠道解密依赖额外服务端密钥，把该密钥保存在私有环境配置中并随显式渠道迁移处理，不复用管理员会话密钥加密渠道。非默认凭据文件名需在部署工具中补对应文件映射后再宣称可迁移。

## 打包和主 Agent 最终接续

业务源码修改完成后，使用本脚本生成最终包；脚本在输出目录复制源码、依赖、runtime，再在包内构建网页，避免改动正在运行主站的 build。选择一个尚不存在的输出目录：

```powershell
.\runtime\node\node.exe .\tools\package-studio.mjs --out K:\codex\AIHOT\evidence\production-studio-20261030\deployment\Studio-Windows-final
```

生成同名目录和 `.zip`。只允许分发 ZIP；打包后的目录用于审查或首次安装。业务源码及锁定依赖均包含；不运行 npm install、不拉新版本、不执行 seed.ts、不接入真实模型。workspace junction 不入 ZIP，首次安装自动在目标路径重建。

本轮使用 `runtime/tmp/relocation-test`、不同端口和独立库验证本机移目录；没有在另一台物理电脑验证。具体结果见 `evidence/production-studio-20261030/deployment/validation.json` 及 `部署结果.html`。主 Agent 后续改业务源码后应重新调用打包脚本；本轮包的验证不自动覆盖尚未写入的业务改动。

首次安装预置 Macroblock、Kinglight、Nationstar 三个真实 LED 信源，均暂停自动采集。登录后到“采编工作台 → 采集信源”手动采集，也可“添加信源”。不会导入旧电脑稿件、账号、密钥或 AI 行业示例素材。


## 2026-11-01 WorkBuddy与CAMOS部署补充

本次完整包应包含 integrations/camos/app、runtime/python、data/expert_knowledge三个方法依赖目录；不包含CAMOS的data/business或原始完整业务包。启动器自动找到同目录方法库，无需原电脑D盘/K盘路径。显式AIHOT_CAMOS_ROOT可写相对包根路径。方法临时状态写在当前AIHOT_DATA_DIR下，使用后删除本次临时子目录。

新电脑交给WorkBuddy时，先读包根WORKBUDDY_START_HERE.md，再执行install-studio.cmd、start-studio.cmd。首次安装为空白业务库，管理员密码由新机生成；原数据/模型密钥仍用本文私有迁移步骤，不进入公共源码或通用包。不得覆盖另一实例已有.env、凭据或活动数据库。

代码已同步与程序已经加载为两个状态。WorkBuddy进程如未启动，由目标机正常启动脚本启动；不从本聊天自动重启其他实例。第二台物理电脑验收由目标WorkBuddy返回health、版本、采集、审稿、英文导出和CAMOS实际结果。
