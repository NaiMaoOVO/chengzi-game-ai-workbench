# 游戏内容运营 AI 分析工作台

Game Ops AI Workbench — 面向游戏内容运营场景的一站式本地分析工作台，覆盖热点追踪、玩家评论舆情、直播数据复盘、版本内容包装、玩家分层与达人筛选六大核心场景。

原生 JS 前端（零运行时依赖）+ 五个 Node 本地服务组成，支持本地个人使用与 HTTPS 线上账号隔离。真实数据不足时可手动开启样例兜底；个人工作默认不使用样例数据。

## LLM 双轨增强

评论分析与版本包装模块支持接入 OpenAI 兼容大模型（默认 DeepSeek）：配置 API Key 后自动启用 AI 深度洞察（舆情摘要、核心议题、运营建议、多平台文案）；**无 Key 或调用失败时自动降级回内置规则引擎，所有功能永远可用**。

```bash
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY（DeepSeek 默认，也可换任意 OpenAI 兼容服务）
node restart-demo.js
```

| 变量 | 说明 |
|---|---|
| `LLM_API_KEY` | API 密钥，留空则运行规则模式 |
| `LLM_BASE_URL` | 默认 `https://api.deepseek.com/v1`，可换 GLM/Qwen/Ollama 等 |
| `LLM_MODEL` | 默认 `deepseek-chat` |

LLM 网关内置请求缓存（10 分钟）、限流与并发控制，Prompt 内聚在服务端 `llm-server.js`，前端只传业务数据，密钥不进浏览器。

## 功能模块

| 模块 | 说明 |
|---|---|
| 热点追踪 | 读取 B站公开搜索结果，按发布时间过滤 + 播放/弹幕/收藏/时间衰减计算综合热度；支持今日 / 24 小时 / 3 天 / 7 天筛选，点击可查看标题结构、爆点归因、风险与可跟进选题，导出 CSV |
| 竞品内容拆解 | 根据游戏、平台和内容描述生成标题结构、选题方向和改写建议 |
| 玩家评论分析 | 手动粘贴 / 单视频导入 / 按游戏自动抓取 B站热门视频评论；自动清洗重复、广告、纯表情样本，输出细分标签、情绪分布、舆情风险预警、高频关键词与运营动作建议 |
| 活动复盘生成 | 曝光-点击-参与-付费漏斗指标与复盘建议；标准 / 保守 / 激进三档口径切换 |
| 直播数据复盘 | 拖入直播后台截图，macOS Vision OCR 识别 ACU / PCU / 曝光量 / 进房人数，多主播对比活动场与近期均值，判定正 / 负 / 中性反馈 |
| 版本包装助手 | 输入版本主题与更新点，生成公告、多平台社媒文案、视频脚本、Push 标题、发布节奏表、素材清单与 A/B 测试标题 |
| 玩家分层策略 | 按玩家标签、生命周期阶段、版本节点生成核心洞察、触达文案、活动推荐、奖励成本与多渠道话术 |
| KOL/KOC 筛选 | 导入达人表格（CSV/TSV/XLSX），按粉丝量、互动率、内容质量、品类匹配、预估报价与商单密度动态打分，输出场景化排序、预算组合、达人 brief 与数据异常识别 |

## 项目结构

```text
index.html          页面结构 + 数据源配置面板
utils.js            常量与服务地址管理 + 纯工具函数
launcher.js         本地服务控制台（一键启动、重启、状态检查）
app.js              各模块核心逻辑
hotspot-server.js   热点抓取服务（B站搜索 + 热度排序，端口 8790）
comment-server.js   评论抓取服务（B站视频评论，端口 8791）
ocr-server.js       本地截图识别服务（macOS Vision，端口 8787）
llm-server.js       LLM 增强网关（OpenAI 兼容，端口 8794）
archive-server.js   本地存档服务：简报与分析快照持久化（SQLite，端口 8796）
start-demo.js       一键启动全部本地服务 + 打开页面
restart-demo.js     安全重启（PID 状态文件 + 脚本路径校验，不误杀进程）
scripts/            构建与启动器安装脚本
macos-launcher/     macOS URL Scheme 启动器模板
```

页面支持「本地模式 / 线上模式」切换：本地模式请求 `127.0.0.1` 服务，线上模式请求相对路径 `/api/ocr`、`/api/hotspot`、`/api/comment`、`/api/llm`。

## 快速开始

要求：Node.js 24；OCR 功能需要 macOS（Xcode Command Line Tools）。

```bash
node start-demo.js
```

脚本会检查并启动热点、评论、OCR、AI 增强、存档五个服务和本地控制进程（8793），然后自动打开工作台页面。`Control + C` 结束。

也可以在网页里一键启动：首次执行一次 `npm run launcher:install` 安装 macOS 启动器，之后页面按钮通过 `gameops://start` / `gameops://restart` 两个固定动作唤起服务。启动器不执行网页传入的任意命令。

安装器会把运行脚本和当前 `.env` 复制到 `~/Library/Application Support/GameOpsLauncher/runtime`，其中 `.env` 权限设为仅当前用户可读写。修改脚本或 `.env` 后需重新执行一次 `npm run launcher:install`，再点击页面的“重启本地服务”。

可用 `npm run launcher:check` 检查已安装运行快照是否与当前源码一致。

改动代码后强制重启：

```bash
node restart-demo.js
```

### 服务健康语义

- `/health`：进程存活检查，恒返回 200，`ocr` 字段区分 `ready / preparing / not_ready`
- `/ready`：严格就绪检查，仅 ready 时返回 200
- 所有健康检查都校验固定 `service` 身份字段，防止端口被其他程序占用时误报正常

### 多平台数据源

| 平台 | 环境变量 | 配置方式 | 无配置时行为 |
|---|---|---|---|
| B站 | `BILIBILI_COOKIE` | `BILIBILI_COOKIE='SESSDATA=...; bili_jct=...' node start-demo.js` | 搜索接口可能返回 412，自动降级样例数据 |
| 抖音 | `DOUYIN_PROVIDER_URL` | 连接已登录的只读插件或自建 HTTP 提供器 | 未配置时使用样例数据 |
| 小红书 | `XIAOHONGSHU_PROVIDER_URL` | 连接 OpenCLI、xiaohongshu-mcp 桥接服务或自建提供器 | 未配置时使用样例数据 |

Cookie 只在本地服务进程中传递，不会写入页面。页面默认关闭样例兜底：真实接口风控或服务不可用时会明确显示原因；只有为案例演示时才手动开启。

抖音和小红书不内置绕过验证码、浏览器指纹或逆向签名逻辑。外部提供器应只读取当前账号有权查看的公开内容，并返回 `.env.example` 中说明的统一 JSON 结构；远程地址必须使用 HTTPS，本机桥接服务可以使用 `127.0.0.1`。

推荐接入顺序：小红书桌面演示优先使用 OpenCLI，服务器优先使用 `xiaohongshu-mcp`；抖音使用开放平台或已登录的只读采集服务。将桥接服务暴露为统一 HTTP 查询接口后，分别填入 `XIAOHONGSHU_PROVIDER_URL` 或 `DOUYIN_PROVIDER_URL`。未配置、登录失效或触发验证码时，页面会明确标记为样例兜底，不会冒充真实数据。

### 接入 xiaohongshu-mcp

`xiaohongshu-mcp` 是 MCP 服务，不能直接填到 `XIAOHONGSHU_PROVIDER_URL`。项目提供了本机 bridge，将固定的 `search_feeds` 工具转换成热点服务需要的 HTTP JSON。

先确保 `mcporter list` 里存在名为 `xiaohongshu` 的 MCP 服务，然后检查登录：

官方二进制默认提供 `http://127.0.0.1:18060/mcp`，可以这样注册到 `mcporter`：

```bash
mcporter config add xiaohongshu \
  http://127.0.0.1:18060/mcp \
  --transport http \
  --scope home
mcporter list xiaohongshu --schema
```

```bash
mcporter call 'xiaohongshu.check_login_status()' --timeout 120000
# 未登录时按工具返回的二维码流程登录
mcporter call 'xiaohongshu.get_login_qrcode()' --timeout 120000
```

启动桥接服务：

```bash
cd "/Users/chenzixun/Documents/Codex/2026-05-22/new-chat"
cp .env.example .env
# .env 中确认：XHS_MCP_SERVER=xiaohongshu
# 如果网页启动时提示找不到 mcporter，填入绝对路径：
# MCPORTER_BIN=/Users/chenzixun/.npm-global/bin/mcporter
npm run start:xhs-bridge
```

另开终端，设置 GameOps 使用本机 bridge：

```bash
XIAOHONGSHU_PROVIDER_URL=http://127.0.0.1:8805/search npm run restart
```

如果已经把 `XIAOHONGSHU_PROVIDER_URL=http://127.0.0.1:8805/search` 写入 `.env`，主启动器会自动拉起 bridge；重新执行 `npm run launcher:install` 后，点击网页“重启本地服务”即可。bridge 只监听 `127.0.0.1`，只调用 `search_feeds`，不会把 MCP 工具暴露到公网。搜索结果会由 GameOps 再次按时间范围过滤；没有 `publishedAt` 的结果会被过滤掉，避免旧内容混入今日榜单。

## 线上部署

线上模式使用 Nginx 托管静态文件，PM2 常驻运行五个 Node 服务。生产环境以 `nginx-https.conf.example` 为准；HTTP 配置只负责跳转 HTTPS。

| 页面请求 | 反向代理目标 |
|---|---|
| `/api/hotspot` | `http://127.0.0.1:8790` |
| `/api/comment` | `http://127.0.0.1:8791` |
| `/api/ocr` | `http://127.0.0.1:8787` |
| `/api/llm` | `http://127.0.0.1:8794` |
| `/api/archive` | `http://127.0.0.1:8796` |

```bash
npm install -g pm2
cp .env.example .env
npm run build:public     # 仅复制前端所需静态文件到 public/
npm run deploy:check     # 校验环境变量与构建产物，配置不完整拒绝启动
npm run deploy:start && pm2 save && pm2 startup
```

Nginx 配置见 `nginx.conf.example` / `nginx-https.conf.example`。HTTPS 模板的 Basic Auth 是个人站点的外层访问门槛；archive 登录用于区分每位账号自己的业务数据。Linux 服务器设置 `OCR_PROVIDER=remote` 并配置远端 OCR 服务；macOS 服务器可用 `OCR_PROVIDER=macos` 直接调用系统 Vision。

验证：

```bash
curl -fsS https://example.com/api/hotspot/health
curl -fsS https://example.com/api/comment/health
curl -fsS https://example.com/api/ocr/health
curl -fsS https://example.com/api/archive/health
curl -fsS https://example.com/api/llm/health
```

### 账号隔离与线上写入

归档、待办、风险工单、发布台账与项目档案默认保持本地兼容模式。部署为多人协作服务时，在服务器的 `.env` 设置以下变量后重启 archive 服务：

```bash
ARCHIVE_AUTH_ENABLED=1
ARCHIVE_ADMIN_USERNAME=admin
ARCHIVE_ADMIN_PASSWORD='请使用至少 12 位的随机强密码'
ARCHIVE_SESSION_HOURS=12
```

首次启动会创建管理员；若同名管理员已存在，服务不会覆盖其密码。管理员可通过 `POST /api/archive/auth/users` 创建 `member` 账号。启用认证后，每个账号只读取和修改自己的待办、简报、项目档案、发布台账、风险工单和创作者库；管理员保留账号管理权限，但不会默认看到成员业务数据。所有写请求都需要会话 CSRF 头。旧的本地 `default` 数据会在首次启用认证时迁移给管理员，启用前先运行一次备份。

启用晨报抓取后，`MORNING_SCHEDULE` 按 `Asia/Shanghai` 时区解释；每个游戏和平台每天只成功落库一次，服务重启不会重复生成当天晨报。抓取失败会记录失败原因，并在下一分钟重新尝试。

```bash
npm run archive:backup
```

备份默认写入与 `archive.db` 同级的 `backups/`，可用 `ARCHIVE_BACKUP_DIR` 改位置；默认保留最近 7 份，可用 `ARCHIVE_BACKUP_KEEP` 调整（范围 1-100）。每份备份同时生成 `.sha256` 校验文件，恢复前可执行 `npm run archive:verify -- /path/to/archive-*.db` 校验文件完整性。恢复时先停止 archive 服务，再用备份文件替换数据库文件后重启。生产环境必须使用 HTTPS，并保持 `ARCHIVE_COOKIE_SECURE=1`。

## 安全设计

- 本地控制服务只监听 `127.0.0.1`，仅暴露只读 `/health` 与 `/status`
- URL Scheme 启动器只接受 `gameops://start` / `gameops://restart` 两个白名单动作
- 重启按 PID 状态文件 + 进程命令行双重校验定位，不按端口盲目杀进程
- 所有 API 服务带来源校验（CORS 白名单）、请求限流、上传大小限制与并发限制；仅生产代理链路显式信任 `X-Forwarded-For`
- 远端 LLM 与外部数据提供器只接受 HTTPS；`file://` 页面仅用于本机个人模式，线上账号登录必须从 HTTPS 页面进入
- `.env`、Cookie 等凭据不入库、不进前端

## 技术特点

- 零 npm 依赖：全部使用 Node.js 内置模块与浏览器原生 API，克隆即用
- 优雅降级：真实数据（B站接口、OCR）失败时自动切换本地样例数据，核心链路永远可演示
- macOS Vision OCR：本地 Swift 脚本识别截图，支持 JPG/PNG/GIF/HEIC/WebP 与中文数字单位（万/千/w/k），识别结果带人工校正兜底
