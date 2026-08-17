# 游戏内容运营 AI 分析工作台

这是一个用于简历作品集和面试演示的本地小工具，聚焦游戏内容推广、玩家反馈分析和活动复盘。

## 使用方式

直接打开 `index.html` 即可使用基础功能。

### 项目结构（代码拆分说明）

```
index.html          → 页面结构 + 数据源配置面板
utils.js            → 常量定义（keywordGroups / REVIEW_POLICIES / 服务地址）+ 纯工具函数
launcher.js         → 本地服务控制台（一键启动、重启和状态检查）
app.js              → 各模块核心逻辑（竞品拆解 / 评论分析 / 热点追踪 / 活动复盘 / 版本包装 / 分层运营 / KOL筛选）
hotspot-server.js   → 热点抓取服务（B站搜索 + 热度排序）
comment-server.js   → 评论抓取服务（B站视频评论）
ocr-server.js       → 本地截图识别服务（macOS Vision）
start-demo.js       → 一键启动全部本地服务 + 打开页面
restart-demo.js     → 重启全部本地服务
```

三个 JS 文件（utils.js → launcher.js → app.js）按依赖顺序通过 `<script>` 标签加载，共享全局作用域。页面支持“本地模式 / 线上模式”切换：本地模式请求 `127.0.0.1` 服务，线上模式请求相对路径 `/api/ocr`、`/api/hotspot`、`/api/comment`。

### 面试演示推荐启动方式

首次安装启动器前，也可以在当前文件夹执行：

```bash
node start-demo.js
```

这个脚本会检查并启动热点服务、评论服务和 OCR 服务，然后自动打开工作台页面。演示结束时关闭终端窗口，或按 `Control + C`。

如果希望之后直接在网页点击“一键启动本地服务”，首次使用时只需安装一次 macOS 启动器：

```bash
npm run launcher:install
```

安装完成后刷新页面即可。点击按钮时，浏览器可能会在第一次询问是否允许打开 `GameOps Launcher`；允许后无需再手动输入启动命令。启动器只接受 `gameops://start` 和 `gameops://restart` 两个固定动作，不能执行网页传入的任意命令。

如果改完代码后想强制停掉旧服务并重新打开，可以点击网页中的“重启本地服务”，或在当前文件夹执行：

```bash
node restart-demo.js
```

### macOS URL 启动器

在 macOS 上可一次性安装 URL 启动器：

```bash
npm run launcher:install
```

安装器会生成 `~/Applications/GameOpsLauncher.app` 并注册以下地址：

- `gameops://start`：从配置的项目目录运行 `start-demo.js`
- `gameops://restart`：从配置的项目目录运行 `restart-demo.js`

安装时会记录当前 Node 和项目目录，并把本地服务运行文件同步到 `~/Library/Application Support/GameOpsLauncher/runtime`。这是为了避免 macOS 阻止后台启动器读取 `Documents` 目录。修改热点、评论、OCR 或启动脚本后，重新运行一次 `npm run launcher:install` 即可同步。项目移动后，可重新执行安装并指定新路径：

```bash
npm run launcher:install -- --project /完整/项目路径
```

启动日志保存在 `~/Library/Logs/GameOpsLauncher/`。启动器只接受上述两个固定地址，不会把 URL 内容作为命令执行。

页面首页默认开启“失败时样例兜底”：热点和评论都会先请求真实数据，如果 B站公开接口风控、评论为空或本地服务不可用，再自动降级为本地样例数据，避免影响面试现场展示。如果想严格测试真实抓取，可以关闭这个开关，并确认热点/评论服务已经启动。

如果要识别主播直播截图里的数据，需要先在当前文件夹启动本地 OCR 服务：

```bash
node ocr-server.js
```

然后刷新页面，再拖入截图。macOS Provider 会在服务启动时对 `ocr.swift` 做真实编译检查；首次冷启动可能需要几十秒，默认最多等待 90 秒。它需要可用且版本匹配的 Xcode/Command Line Tools。如果 `/health` 返回 503，应先修复 Swift 与 macOS SDK 工具链，而不是继续上传截图。

如果要读取每日热点真实数据，需要启动热点服务：

```bash
node hotspot-server.js
```

当前真实数据 MVP 优先支持 B站公开搜索结果；B站关键词搜索支持任意游戏名，不限于页面建议列表。

### 多平台数据源

| 平台 | 环境变量 | 配置方式 | 无配置时行为 |
|---|---|---|---|
| B站 | \`BILIBILI_COOKIE\` | \`BILIBILI_COOKIE='SESSDATA=...; bili_jct=...' node start-demo.js\` | 搜索接口可能返回 412，自动降级为样例数据 |
| 抖音 | \`DOUYIN_COOKIE\` | 平台接口限制严格，暂不支持公开 API 抓取 | 始终使用样例数据 |
| 小红书 | \`XIAOHONGSHU_COOKIE\` | 平台接口限制严格，暂不支持公开 API 抓取 | 始终使用样例数据 |

Cookie 只在本地服务进程中传递，不会写入页面。配置后需重启本地服务控制进程才能生效。

如果要抓取 B站视频评论，需要启动评论服务：

```bash
node comment-server.js
```

热点服务默认运行在 `http://127.0.0.1:8790`，评论服务默认运行在 `http://127.0.0.1:8791`。首页“刷新服务状态”会同时检测本地服务和真实 B站接口样本，因此能区分“服务未启动”和“平台接口风控/不可用”。

当前评论抓取优先读取 B站公开评论；如果视频评论受限、翻页过深或遇到风控，可能需要 Cookie 或授权。若要按游戏自动抓取 B站热门视频评论，需要同时启动 `node hotspot-server.js` 和 `node comment-server.js`。

如果你本机浏览器可以正常访问 B站，但接口仍频繁返回 412，可以给热点/评论服务配置 B站 Cookie 后再启动，例如：

```bash
BILIBILI_COOKIE='SESSDATA=...; bili_jct=...' node start-demo.js
```

Cookie 只在本机服务进程中使用，不会写入工作台页面。

### 线上部署约定

线上模式使用 Nginx 托管静态文件，PM2 常驻运行热点、评论和 OCR 三个 Node 服务。页面切换到“线上”后，会使用以下 API 前缀：

| 页面请求 | 反向代理目标 |
|---|---|
| `/api/hotspot` | `http://127.0.0.1:8790` |
| `/api/comment` | `http://127.0.0.1:8791` |
| `/api/ocr` | `http://127.0.0.1:8787` |

#### 1. 安装与配置

服务器需要 Node.js 18+、PM2 和 Nginx：

```bash
npm install -g pm2
cp .env.example .env
npm run build:public
```

编辑 `.env`，至少设置真实域名对应的 `ALLOWED_ORIGIN`。B站接口触发风控时再设置 `BILIBILI_COOKIE`，不要提交 `.env`。Linux 服务器应设置 `OCR_PROVIDER=remote`，并配置 `OCR_REMOTE_URL` 与 `OCR_REMOTE_API_KEY`；macOS 服务器可使用 `OCR_PROVIDER=macos` 和系统 Swift OCR。PM2 会将 `OCR_PORT` 映射为 OCR 进程读取的 `PORT`。

加载环境变量后先执行 `npm run deploy:check`。如果仍使用 `example.com`、缺少 `ALLOWED_ORIGIN`，或远端 OCR 地址未配置，部署会直接拒绝启动，避免服务假在线。

#### 2. 启动 PM2 服务

PM2 不会自动读取普通 `.env` 文件，启动或重载前需将它导入当前 shell：

```bash
set -a
. ./.env
set +a
npm run deploy:start
pm2 save
pm2 startup
```

`pm2 startup` 会输出一条需要以管理员权限执行的命令，执行后服务器重启时会自动恢复进程。常用运维命令：

```bash
npm run deploy:reload
npm run deploy:logs
pm2 status
```

#### 3. 配置 Nginx

复制并编辑示例配置中的域名和静态文件目录：

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/gameops
sudo ln -s /etc/nginx/sites-available/gameops /etc/nginx/sites-enabled/gameops
sudo nginx -t
sudo systemctl reload nginx
```

`npm run build:public` 只会把前端所需的五个静态文件复制到 `public/`，避免通过域名暴露服务端源码和环境配置。`nginx.conf.example` 会把 `/api/hotspot/`、`/api/comment/`、`/api/ocr/` 分别代理到 `127.0.0.1:8790`、`127.0.0.1:8791`、`127.0.0.1:8787`，并去掉 API 前缀后再转发。

Nginx 示例包含 API 限流、连接数限制和基础安全响应头。公开作品集建议使用 Certbot 配置 HTTPS；如果只想让面试官或朋友访问，可取消示例中的 Basic Auth 注释并创建密码文件。

正式公开时推荐使用 `nginx-https.conf.example` 替换 HTTP 示例：把 `YOUR_DOMAIN` 替换为真实域名，先通过 Certbot 生成证书，并执行 `sudo htpasswd -c /etc/nginx/.htpasswd-gameops gameops` 创建访问账号。HTTPS 模板默认启用 HTTP 跳转、HSTS、Basic Auth、安全头和 API 限流。

#### 4. 验证

```bash
curl -fsS http://127.0.0.1:8790/health
curl -fsS http://127.0.0.1:8791/health
curl -fsS http://127.0.0.1:8787/health
curl -fsS http://example.com/api/hotspot/health
curl -fsS http://example.com/api/comment/health
curl -fsS http://example.com/api/ocr/health
```

生产环境应继续配置 HTTPS。`OCR_PROVIDER=remote` 会把原始图片 POST 到 `OCR_REMOTE_URL`，可通过 `OCR_REMOTE_API_KEY` 发送 Bearer Token；远端响应至少需要包含字符串类型的 `text` 字段。

远程 OCR 会把直播截图发送给第三方服务。上线前应确认服务商的数据留存、日志、地域和删除政策，并在页面中提示用户不要上传包含账号、收入或内部经营信息的敏感截图。

## 当前模块

- 项目总览：展示“热点追踪 - 竞品拆解 - 玩家洞察 - 版本包装 - 分层运营 - 达人筛选 - 活动复盘”的完整闭环，支持一键载入案例、面试演示路线和导出 Markdown 完整运营方案。
- 竞品内容拆解：根据游戏、平台和内容描述生成标题结构、选题和改写方向。
- 玩家评论分析：支持手动粘贴评论、导入单条 B站视频公开评论，或按游戏自动抓取 B站热门视频评论；导入后会清洗重复、广告、纯表情等低价值样本，输出细分标签、情绪分布、舆情风险预警、高频关键词、代表评论和运营动作建议，并支持导出分析结果。
- 活动复盘生成：根据曝光、点击、参与、付费数据生成漏斗指标和复盘建议；也支持多主播直播数据复盘，可拖入多张直播数据截图，生成主播数据卡片，并对比活动场与近期直播均值，判断活动对主播数据是正反馈、负反馈还是中性反馈；判断口径支持标准、保守、激进三档切换。
- 热点追踪：优先请求本地热点服务读取 B站公开搜索结果，支持今日、近 24 小时、近 3 天、近 7 天筛选；服务端会按发布时间做二次过滤，避免接口返回超出时间范围的旧视频；再按播放、弹幕、收藏和发布时间衰减计算综合热度。失败或平台未授权时降级为游戏社区语境样例兜底榜单。点击榜单视频可查看标题结构、爆点原因、负面/争议风险和可跟进选题，并支持复制选题方案、导出 CSV。
- 版本包装助手：输入版本主题和更新点，选择文案风格后生成公告文案、不同平台社媒短文案、视频脚本、推送标题、发布节奏表、素材需求清单、A/B 测试标题和不同玩家群体的卖点表达，并提供风险检查、信息缺口检查、复制方案和导出方案。
- 玩家分层策略：输入游戏、玩家标签、运营目标、生命周期阶段和版本节点，自动生成玩家核心洞察、玩家画像说明、多标签优先级解释、触达文案、活动推荐、奖励成本等级、Push/邮件/社群话术、风险提醒和观察指标，并支持复制和导出方案。
- KOL/KOC 合作筛选：支持粘贴达人表格，也支持上传 CSV、TSV、TXT、XLSX 文件，并提供 CSV 模板下载；导入后根据粉丝数、平均播放、互动率、内容类型、历史游戏品类、评论质量、预估报价和商单密度自动打分，输出新品曝光、深度测评、攻略扩散、性价比排序、预算组合推荐、达人 brief、数据异常识别、分层名单和风险提示，并支持导出 CSV。
- 简历项目包装：提供可直接放入简历的项目描述和 bullet。

## 面试讲法

### 核心叙事线

这个项目体现的是游戏内容运营的完整闭环：先通过数据工具看平台热点和竞品内容，再清洗玩家反馈做舆情判断，然后产出版本包装方案和分层运营策略，接着完成达人筛选和采买决策，最后回到活动数据复盘沉淀下一轮优化动作。

### 考察点对应

| 面试问题类型 | 项目中的回应角度 |
|---|---|
| 你如何发现内容机会？ | 热点追踪 + 竞品内容拆解：先看平台真实热榜，再拆标题结构和卖点方向 |
| 你如何做社区运营？ | 评论分析模块：按游戏自动抓取热门视频评论，清洗广告/重复后输出舆情风险、高频词和动作建议 |
| 你如何做版本运营？ | 版本包装 + 玩家分层：把更新点转化为公告、社媒、视频脚本、Push 标题和不同玩家群体的卖点 |
| 你如何做达人投放？ | KOL/KOC 筛选：导入达人表格后根据活动场景动态打分（新品曝光 / 深度测评 / 攻略扩散）+ 性价比排序 |
| 你如何做活动复盘？ | 活动复盘模块：回收 ACU/PCU/曝光/进房数据，多主播对比，判断正负反馈（支持三档口径切换） |

### 实际经历包装建议

如果你有具体项目经验（如巅峰极速），可以这样结合：
- 围绕营销/游戏节点先看竞品怎么做（竞品拆解模块）
- 然后找 B站 / 抖音前热视频里的内容窗口（热点追踪）
- 邀约生态内 KOC 主播 / 采买跨品类 KOL 参与活动（达人筛选模块辅助决策）
- 活动结束后回收直播数据，判断正反馈 / 负反馈（活动复盘模块）

### 截图识别说明

当前版本通过本机 OCR 服务调用 macOS Vision 识别截图文字，再尝试提取 ACU、PCU、曝光量和进房人数；如果截图格式不稳定，仍会保留图片预览和人工校正表单，保证复盘流程可用。
