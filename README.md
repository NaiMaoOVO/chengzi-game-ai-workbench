# 游戏内容运营 AI 分析工作台

Game Ops AI Workbench — 面向游戏内容运营场景的一站式本地分析工作台，覆盖热点追踪、玩家评论舆情、直播数据复盘、版本内容包装、玩家分层与达人筛选六大核心场景。

纯前端（原生 JS，零依赖、无构建步骤）+ 四个 Node 本地服务组成，支持本地模式与线上模式切换，真实数据失败时自动降级样例兜底，保证任何环境下都可完整演示。

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
start-demo.js       一键启动全部本地服务 + 打开页面
restart-demo.js     安全重启（PID 状态文件 + 脚本路径校验，不误杀进程）
scripts/            构建与启动器安装脚本
macos-launcher/     macOS URL Scheme 启动器模板
```

页面支持「本地模式 / 线上模式」切换：本地模式请求 `127.0.0.1` 服务，线上模式请求相对路径 `/api/ocr`、`/api/hotspot`、`/api/comment`。

## 快速开始

要求：Node.js 18+；OCR 功能需要 macOS（Xcode Command Line Tools）。

```bash
node start-demo.js
```

脚本会检查并启动热点、评论、OCR 三个服务和本地控制进程（8793），然后自动打开工作台页面。`Control + C` 结束。

也可以在网页里一键启动：首次执行一次 `npm run launcher:install` 安装 macOS 启动器，之后页面按钮通过 `gameops://start` / `gameops://restart` 两个固定动作唤起服务。启动器不执行网页传入的任意命令。

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
| 抖音 | `DOUYIN_COOKIE` | 平台接口限制严格，暂不支持公开 API 抓取 | 始终使用样例数据 |
| 小红书 | `XIAOHONGSHU_COOKIE` | 平台接口限制严格，暂不支持公开 API 抓取 | 始终使用样例数据 |

Cookie 只在本地服务进程中传递，不会写入页面。页面默认开启「失败时样例兜底」，真实接口风控或服务不可用时自动降级，保证演示链路完整。

## 线上部署

线上模式使用 Nginx 托管静态文件，PM2 常驻运行三个 Node 服务：

| 页面请求 | 反向代理目标 |
|---|---|
| `/api/hotspot` | `http://127.0.0.1:8790` |
| `/api/comment` | `http://127.0.0.1:8791` |
| `/api/ocr` | `http://127.0.0.1:8787` |
| `/api/llm` | `http://127.0.0.1:8794` |

```bash
npm install -g pm2
cp .env.example .env
npm run build:public     # 仅复制前端所需静态文件到 public/
npm run deploy:check     # 校验环境变量与构建产物，配置不完整拒绝启动
set -a; . ./.env; set +a
npm run deploy:start && pm2 save && pm2 startup
```

Nginx 配置见 `nginx.conf.example` / `nginx-https.conf.example`（含 API 限流、连接数限制、安全响应头、HTTPS + Basic Auth 模板）。Linux 服务器设置 `OCR_PROVIDER=remote` 并配置远端 OCR 服务；macOS 服务器可用 `OCR_PROVIDER=macos` 直接调用系统 Vision。

验证：

```bash
curl -fsS http://example.com/api/hotspot/health
curl -fsS http://example.com/api/comment/health
curl -fsS http://example.com/api/ocr/health
```

## 安全设计

- 本地控制服务只监听 `127.0.0.1`，仅暴露只读 `/health` 与 `/status`
- URL Scheme 启动器只接受 `gameops://start` / `gameops://restart` 两个白名单动作
- 重启按 PID 状态文件 + 进程命令行双重校验定位，不按端口盲目杀进程
- 所有 API 服务带来源校验（CORS 白名单）、请求限流、上传大小限制与并发限制
- `.env`、Cookie 等凭据不入库、不进前端

## 技术特点

- 零 npm 依赖：全部使用 Node.js 内置模块与浏览器原生 API，克隆即用
- 优雅降级：真实数据（B站接口、OCR）失败时自动切换本地样例数据，核心链路永远可演示
- macOS Vision OCR：本地 Swift 脚本识别截图，支持 JPG/PNG/GIF/HEIC/WebP 与中文数字单位（万/千/w/k），识别结果带人工校正兜底
