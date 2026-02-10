# JO Crawler - 智能职位爬虫

基于 [Agent-Browser](https://github.com/nicepkg/agent-browser) 和 LLM（豆包 Doubao）的智能职位爬虫。自动分析页面可访问性树快照，用 LLM 生成站点专用解析器，实现全自动化的招聘网站职位数据采集。

## ✨ 特性

- 🤖 **LLM 智能生成解析器** — 基于可访问性树快照 + refs，LLM 为每个站点生成专用 JS 解析器
- � **详情页快照** — 生成阶段自动捕获详情页快照和原始文本，让 LLM 看到真实的详情页结构，生成更精准的清洗逻辑
- 📄 **高质量 JD 提取** — 生成的解析器始终从 `getMainContentText()` 原始文本自行清洗 description，内置 `cleanDescription`/`cleanLocation`/`cleanSalary`/`extractDatesFromRawText` 等辅助方法
- 🔗 **稳定的列表页遍历** — `collectJobLinks()` 批量收集 URL + `navigate()` 逐页访问，避免 click+goBack 带来的 ref 失效问题
- 📝 **CSV 配置** — 支持按 URL 配置页面类型、最大职位数、自定义 LLM 提示词
- 🎯 **Ref 系统** — 使用 Agent-Browser 的 refs 实现可靠的元素定位和数据提取
- 🔄 **动态加载** — 生成的解析器自动注册，无需重启即可使用
- 🧩 **解析器缓存** — 已有解析器自动跳过生成，支持 `--force` 强制重新生成
- 🍪 **弹窗自动处理** — 自动关闭 Cookie 横幅、隐私弹窗等

## 📦 安装

```bash
# 克隆项目
git clone https://github.com/your-repo/jo-crawler.git
cd jo-crawler

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，配置 LLM API Key
```

## 🔑 环境变量

在 `.env` 文件中配置：

```bash
# LLM API 配置（豆包/火山引擎 — 主要）
DOUBAO_API_KEY=your_doubao_api_key_here
DOUBAO_API_URL=https://ark.cn-beijing.volces.com/api/v3/chat/completions  # 可选，有默认值
DOUBAO_MODEL=doubao-seed-1-6-251015                                      # 可选，有默认值

# LLM API 配置（智谱 GLM — 向后兼容，可选）
# GLM_API_KEY=your_glm_api_key_here
# GLM_API_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
# GLM_MODEL=glm-4.7

# 浏览器配置
BROWSER_HEADLESS=true
BROWSER_TIMEOUT=30000

# 爬虫配置
MAX_JOBS_PER_SITE=10
CONCURRENCY=2
OUTPUT_FORMAT=json
OUTPUT_PATH=output/jobs.json
```

## 🚀 快速开始

### 1. 配置要爬取的 URL

**方式 A: 使用 CSV 配置（推荐）**

创建 `links.csv` 文件：

```csv
type,url,max_jobs,prompt
list,https://www.capgemini.com/careers/join-capgemini/job-search/?size=15,10,分页需要点击 LoadMore
detail,https://example.com/jobs/preview/12345,1,
list,https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/...,5,左侧是岗位列表右侧是详情
```

**方式 B: 使用 TXT 格式（简单）**

创建 `links.txt` 文件：

```
https://www.capgemini.com/careers/join-capgemini/job-search/?size=15
https://td.wd3.myworkdayjobs.com/en-US/TD_Bank_Careers/details/...
```

### 2. 生成解析器

```bash
# 自动检测配置文件（优先 CSV，回退 TXT）
npm run generate

# 显式指定使用 TXT 配置
npm run generate -- --txt

# 强制重新生成已有解析器
npm run generate -- --force

# 只为指定域名生成/重新生成
npm run generate -- --force -d cibc
```

### 3. 开始爬取

```bash
# 默认爬取（从 links.txt 读取 URL，每个站点最多 10 个职位）
npm run crawl

# 使用 CSV 配置文件爬取
npm run crawl -- --csv

# 自定义选项
npm run crawl -- -m 5              # 每个站点最多 5 个职位
npm run crawl -- -p 2              # 最大翻页 2 页
npm run crawl -- --db custom.db    # 使用自定义数据库路径
npm run crawl -- --no-headless     # 显示浏览器窗口（调试用）
```

### 4. 导出数据

```bash
# 导出全部数据为 JSON（默认）
npm run export

# 导出为 CSV 格式
npm run export -- -f csv

# 按来源过滤导出（模糊匹配）
npm run export -- -s "TD Bank"

# 按关键字搜索（匹配标题和描述）
npm run export -- -k "Markets"

# 只导出指定字段（逗号分隔）
npm run export -- --fields "job_id,company_name,job_title,job_link"

# 排除 description 字段（减小文件体积）
npm run export -- --no-desc

# 自定义输出路径
npm run export -- -o exports/my-jobs.json

# 限制导出条数
npm run export -- -l 100

# 组合使用多个选项
npm run export -- -f csv -s CIBC -k "Analyst" --no-desc -o cibc-analysts.csv
```

## 📖 配置文件

### CSV 格式

```csv
type,url,max_jobs,prompt
list,https://example.com/jobs,10,自定义提示词（可选）
detail,https://example.com/jobs/123,1,
```

| 字段 | 说明 |
|------|------|
| `type` | 页面类型：`list`（列表页）、`detail`（详情页），留空则自动判断 |
| `url` | 目标 URL |
| `max_jobs` | 最大爬取职位数（默认 10） |
| `prompt` | 自定义 LLM 提示词，用于指导解析器生成（可选） |

详细说明请参考：[CSV 配置指南](docs/CSV_CONFIG.md)

## 📊 数据存储

爬取结果自动保存到 SQLite 数据库（默认 `output/jobs.db`），支持自动去重。

### JobData 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `job_id` | string | 唯一标识（优先从 URL 提取原生 ID，回退 MD5 哈希） |
| `job_title` | string | 职位标题 |
| `company_name` | string | 公司名称 |
| `location` | string | 工作地点（城市/地区） |
| `job_link` | string | 职位详情链接 URL |
| `post_date` | string | 发布日期 |
| `dead_line` | string | 申请截止日期（无则空串） |
| `job_type` | string | Full-time / Part-time / Contract / Permanent / Internship |
| `description` | string | 完整 JD 正文（已去噪） |
| `salary` | string | 薪资范围（无则空串） |
| `source` | string | 来源网站名 |
| `extracted_at` | string | ISO 时间戳 |

### job_id 生成策略

| 优先级 | 策略 | 示例 |
|--------|------|------|
| 1 | 从 job_link URL 提取原生 ID | Workday: `2603725`，Capgemini: `368376` |
| 2 | job_link 的 MD5 哈希前 16 位 | `a1b2c3d4e5f67890` |
| 3 | company + title + location 的 MD5 | 兑底，仅当 job_link 为空时 |

支持的 URL ID 提取模式：Workday (`_NNNN`)、Capgemini (`/jobs/NNNN-`)、Oracle Cloud (`/job/NNNN`)、Microsoft (`pid=NNNN`)、CBRE (`/job/NNNN`)，以及通用的 URL 末尾数字 ID。

## 🛠️ 命令行选项

### generate 命令

```bash
npm run generate [options]

选项：
  -d, --domain <domain>    只为指定域名生成解析器
  -f, --force             强制重新生成，覆盖已存在的解析器
  -v, --verbose           详细输出
  --csv                   使用 CSV 配置文件
  --txt                   使用 TXT 配置文件
  # 默认行为：links.csv 存在则用 CSV，否则用 links.txt
```

### crawl 命令

```bash
npm run crawl [options]

选项：
  -m, --max-jobs <number>  每个站点最大爬取职位数 [默认: 10]
  -p, --max-pages <number> 最大翻页数 [默认: 1]
  -c, --concurrency <number> 并发数 [默认: 1]
  -i, --input <path>       输入文件路径 [默认: links.txt]
  --csv                    使用 CSV 配置文件（links.csv）
  --db <path>              数据库文件路径 [默认: output/jobs.db]
  --no-headless            显示浏览器窗口
  -v, --verbose            详细输出
```

> **注意**: `generate` 命令会自动检测 `links.csv`（优先）或 `links.txt`；`crawl` 命令默认读取 `links.txt`，需加 `--csv` 才使用 CSV 配置。

## 🏗️ 架构

```
┌──────────────────────────────────────────────────────────┐
│                     CLI Commands                          │
│              generate.ts  /  crawl.ts                     │
└──────────┬───────────────────────┬────────────────────────┘
           │                       │
     ┌─────▼──────┐        ┌──────▼───────┐
     │ ParserGen  │        │  Registry    │
     │  Service   │        │  (动态加载)   │
     └─────┬──────┘        └──────┬───────┘
           │                       │
     ┌─────▼──────┐        ┌──────▼───────┐
     │ LLMService │        │  BaseParser  │ ◄── 生成的 Parser 继承
     │ (豆包 API) │        │  (核心方法)   │
     └─────┬──────┘        └──────┬───────┘
           │                       │
           └───────────┬───────────┘
                 ┌─────▼──────┐
                 │ Browser    │
                 │  Service   │
                 │ (Playwright)│
                 └─────┬──────┘
                       │
                 ┌─────▼──────┐
                 │ Database   │
                 │  Service   │
                 │  (SQLite)  │
                 └────────────┘
```

### 核心工作流

1. **生成阶段** (`npm run generate`)
   - 导航到目标 URL → 获取列表页可访问性树快照 + refs
   - 自动点击第一个职位链接 → 捕获详情页快照 + `getMainContentText()` 原始文本 → 导航回列表页
   - 将列表页快照 + 详情页快照/原始文本 + Prompt 发送给 LLM → 生成站点专用 JS 解析器
   - LLM 根据真实的详情页文本结构，生成 `cleanDescription`/`cleanLocation`/`cleanSalary`/`extractDatesFromRawText` 等自定义清洗方法
   - 解析器保存到 `output/parsers/`（含快照、截图、日志）和 `src/parsers/generated/`

2. **爬取阶段** (`npm run crawl`)
   - 自动加载匹配的解析器 → 导航到目标页面
   - **列表页**: `collectJobLinks()` 收集所有职位 URL → `navigate()` 逐个访问
   - **详情提取**: `extractDetailFields()` 提取基础字段 + `getMainContentText()` 获取原始文本 → 解析器自定义的 `cleanDescription()` 清洗 description
   - **字段验证**: `cleanLocation()` 去除元数据拼接噪音、`cleanSalary()` 验证薪资格式、`extractDatesFromRawText()` 从原始文本提取日期
   - **详情页**: 直接 `extractDetailFields()` 提取所有字段
   - **去重与入库**: 每批次提取后，用 `job_id` 去重，新职位写入 SQLite 数据库（`output/jobs.db`）

### BaseParser 核心方法

| 方法 | 说明 |
|------|------|
| `collectJobLinks(browser, refs)` | 在列表页批量收集所有职位链接的 URL，避免 ref 失效 |
| `extractDetailFields(browser)` | 在详情页提取基础字段（location/date/type/salary 等），description 建议解析器自行从原始文本提取 |
| `createJobData(data)` | 创建 JobData 对象，自动填充 job_id、默认值和时间戳 |
| `cleanText(text)` | 清理文本（去除多余空白） |
| `getCompanyName()` | 获取公司名称（子类可重写） |
| `delay(ms)` | 延迟执行 |

### 生成的解析器自带的辅助方法

| 方法 | 说明 |
|------|------|
| `cleanDescription(rawText, jobTitle)` | 从 `getMainContentText()` 连续文本中用正则/indexOf 定位正文起止，去除头尾噪音 |
| `cleanLocation(rawLocation)` | 去除 SPA 站点 location 的残留前缀（如 "sToronto" → "Toronto"）和尾部拼接噪音 |
| `cleanSalary(rawSalary)` | 验证 salary 是否包含真实薪资格式（$ + 数字），否则返回空 |
| `extractDatesFromRawText(rawText)` | 从原始文本提取 post_date（"Posted X Days Ago"）和 dead_line（"End Date: ..."）|

### BrowserService 关键方法

| 方法 | 说明 |
|------|------|
| `getSnapshot({ interactive, maxDepth })` | 获取可访问性树快照和 refs 映射 |
| `navigate(url)` | 导航到指定 URL |
| `getText('@eXX')` | 获取指定 ref 元素的文本内容 |
| `getAttribute('@eXX', 'href')` | 获取元素属性 |
| `getMainContentText()` | 获取页面主内容区域文本（优先 main/article） |
| `getCleanPageText()` | 获取去噪后的页面文本（移除 script/style/nav/footer） |
| `getPageText()` | 获取页面完整纯文本（包含噪音，不推荐） |

## 📂 项目结构

```
jo_crawler/
├── src/
│   ├── index.ts               # 入口文件
│   ├── commands/              # CLI 命令
│   │   ├── generate.ts        # 解析器生成命令
│   │   ├── crawl.ts           # 爬取命令
│   │   └── export.ts          # 数据导出命令
│   ├── models/                # 数据模型
│   │   ├── JobData.ts         # JobData 接口定义
│   │   ├── CrawlConfig.ts     # 爬取配置
│   │   └── LinksConfig.ts     # 链接配置
│   ├── parsers/               # 解析器
│   │   ├── base/
│   │   │   ├── BaseParser.ts  # 基类（collectJobLinks, extractDetailFields 等）
│   │   │   ├── GenericParser.ts # 通用回退解析器
│   │   │   └── Parser.ts      # Parser 接口
│   │   ├── generated/         # LLM 自动生成的解析器（.js）
│   │   └── registry.ts        # 解析器动态注册/加载
│   ├── prompts/               # LLM Prompt 模板
│   │   └── parser-generator.ts # System + User prompt（含列表页/详情页指导）
│   ├── services/              # 服务层
│   │   ├── BrowserService.ts  # Playwright 浏览器封装
│       ├── DatabaseService.ts # SQLite 数据库服务（持久化 + 去重）
│       ├── LLMService.ts      # LLM API 调用（豆包）
│       ├── JDExtractor.ts     # JD 结构化提取
│       └── ParserGenerator.ts # 解析器生成编排
│   └── utils/                 # 工具函数
│       ├── config.ts          # 全局配置
│       ├── jobId.ts           # job_id 生成工具（URL 提取 + MD5 回退）
│       ├── loadLinksCsv.ts    # CSV 文件加载
│       └── parserFilename.ts  # 解析器文件名生成（防冲突）
├── output/                    # 输出目录
│   ├── jobs.db                # SQLite 数据库（爬取结果）
│   ├── parsers/               # 生成的解析器
│   │   └── <domain>/
│   │       ├── parser.js          # 生成的解析器代码
│   │       ├── snapshot.json      # 列表页快照
│   │       ├── detail-snapshot.json # 详情页快照 + 原始文本
│   │       ├── screenshot.png     # 页面截图
│   │       ├── generation.log     # 生成日志
│   │       └── README.md          # 生成说明
│   └── screenshots/           # 页面截图
├── docs/                      # 项目文档
├── links.csv                  # CSV 配置文件（推荐）
├── links.txt                  # TXT 配置文件（向后兼容）
├── .env                       # 环境变量
├── tsconfig.json
└── package.json
```

## 🔧 开发

### 添加新的爬取目标

1. 在 `links.csv` 中添加 URL，指定 `type` 和可选的 `prompt`
2. 运行 `npm run generate` — LLM 自动分析页面并生成解析器
3. 检查生成的解析器：`output/parsers/<domain>/parser.js`
4. 运行 `npm run crawl` 测试爬取效果
5. 如有需要，手动优化 `src/parsers/generated/` 中的解析器代码

### 自定义 Prompt

编辑 `src/prompts/parser-generator.ts`：

| 部分 | 说明 |
|------|------|
| `COMMON_SYSTEM_PROMPT` | 系统级指导：代码规范、可用方法、禁止事项 |
| `generateCustomPrompt()` | 根据 URL/快照/refs/详情页快照 生成特定页面的 User Prompt |
| `generateListPageInstructions()` | 列表页提取策略（URL 收集 + 逐页导航 + description 自提取模式） |
| `generateDetailPageInstructions()` | 详情页提取策略（`extractDetailFields` + 自提取 description） |
| `generateDetailSnapshotSection()` | 详情页快照 + 原始文本展示，含 SPA 站点噪音模式说明 |

详细说明请参考：[Prompt 结构说明](docs/PROMPT_STRUCTURE.md)

### 解析器文件命名

解析器文件名由 `parserFilename.ts` 自动生成，格式为 `<domain>-<pageType>-<url-signature>`，确保同一域名下不同页面的解析器不会冲突。例如：
- `www-capgemini-com-list-join-capgemini-job-search.js`
- `td-wd3-myworkdayjobs-com-list-details-retail-market-manager.js`

## 📚 文档

| 文档 | 说明 |
|------|------|
| [CSV 配置指南](docs/CSV_CONFIG.md) | CSV 配置文件详细说明 |
| [Prompt 结构说明](docs/PROMPT_STRUCTURE.md) | Prompt 架构和两阶段生成策略 |
| [LLM 迁移指南](docs/LLM_MIGRATION.md) | 从智谱 GLM 迁移到豆包（火山引擎）的指南 |
| [弹窗处理](docs/POPUP_HANDLING.md) | Cookie 横幅、隐私弹窗等自动处理机制 |
| [解析器命名](docs/PARSER_NAMING.md) | 解析器文件命名策略和冲突解决 |
| [实现总结](IMPLEMENTATION_SUMMARY.md) | 完整的技术实现总结 |

## 🤝 贡献

欢迎提交 Pull Request！

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

ISC License

## 🙏 致谢

- [Agent-Browser](https://github.com/nicepkg/agent-browser) — AI 浏览器自动化框架
- [Playwright](https://playwright.dev/) — 浏览器自动化引擎
- [豆包大模型](https://www.volcengine.com/product/doubao) — 火山引擎 Doubao LLM
- [智谱 GLM](https://open.bigmodel.cn/) — GLM 系列 LLM（向后兼容）

---

**最后更新:** 2026-02-09
