# JO Crawler - 智能职位爬虫

基于 Agent-Browser 和 GLM-4.7 LLM 的智能职位爬虫，能够自动生成解析器并爬取招聘网站的职位数据。

## ✨ 特性

- 🤖 **智能解析器生成** - 使用 LLM 自动分析页面结构并生成解析器
- 📄 **完整 JD 提取** - 自动提取完整的职位描述（包括职责、要求、福利等）
- 🔄 **动态加载** - 无需重启即可加载新解析器
- 📝 **CSV 配置** - 灵活的 CSV 配置文件支持
- 🎯 **Ref 系统** - 使用 Agent-Browser 的 refs 系统进行可靠的元素定位
- 🚀 **高性能** - 支持并发爬取和批量处理

## 📦 安装

```bash
# 克隆项目
git clone https://github.com/your-repo/jo-crawler.git
cd jo-crawler

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，添加你的 GLM API Key
```

## 🔑 环境变量

在 `.env` 文件中配置：

```bash
# GLM API 配置
GLM_API_KEY=your_glm_api_key_here
GLM_API_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
GLM_MODEL=glm-4.7

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
list,https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?keyword=intern,10,
detail,https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs/preview/210690325/?keyword=intern,1,
list,https://careers.microsoft.com,5,此网站有反爬虫，需要增加延迟
```

**方式 B: 使用 TXT 格式（简单）**

创建 `links.txt` 文件：

```
https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/jobs?keyword=intern
https://careers.microsoft.com/jobs
```

### 2. 生成解析器

```bash
# 使用 CSV 配置
npm run generate

# 或使用 TXT 配置
npm run generate -- --txt
```

### 3. 开始爬取

```bash
# 默认爬取（每个站点最多 10 个职位）
npm run crawl

# 自定义选项
npm run crawl -- -m 5              # 每个站点最多 5 个职位
npm run crawl -- -p 2              # 最大翻页 2 页
npm run crawl -- -f csv            # 输出 CSV 格式
npm run crawl -- --no-headless     # 显示浏览器窗口（调试用）
```

## 📖 配置文件

### CSV 格式

```csv
type,url,max_jobs,prompt
list,https://example.com/jobs,10,自定义提示词（可选）
detail,https://example.com/jobs/123,1,
```

**字段说明：**
- `type`: 页面类型 (`list`=列表页, `detail`=详情页, `auto`=自动判断)
- `url`: 目标 URL
- `max_jobs`: 最大爬取职位数（默认 10）
- `prompt`: 自定义提示词（可选）

详细说明请参考：[CSV 配置指南](docs/CSV_CONFIG.md)

## 📊 输出格式

### JSON 格式（默认）

```json
[
  {
    "title": "2027 Markets Summer Analyst Program",
    "company": "JPMorgan Chase",
    "location": "New York, NY",
    "description": "Job Description: If you are ambitious and eager...",
    "url": "https://jpmc.fa.oraclecloud.com/...",
    "source": "JpmcFaOraclecloudCom",
    "extractedAt": "2026-02-05T03:56:18.095Z"
  }
]
```

### CSV 格式

```csv
title,company,location,description,url,source,extractedAt
"2027 Markets Summer Analyst Program","JPMorgan Chase","New York, NY","Job Description...","https://...","JpmcFaOraclecloudCom","2026-02-05T03:56:18.095Z"
```

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
```

### crawl 命令

```bash
npm run crawl [options]

选项：
  -m, --max-jobs <number>  每个站点最大爬取职位数 [默认: 10]
  -p, --max-pages <number> 最大翻页数 [默认: 1]
  -c, --concurrency <number> 并发数 [默认: 1]
  -o, --output <path>      输出文件路径 [默认: output/jobs.json]
  -f, --format <format>    输出格式 (json|csv) [默认: json]
  -i, --input <path>       输入文件路径 [默认: links.txt]
  --no-headless            显示浏览器窗口
  -v, --verbose            详细输出
```

## 📂 项目结构

```
jo_crawler/
├── src/
│   ├── commands/          # CLI 命令
│   │   ├── generate.ts    # 生成解析器命令
│   │   └── crawl.ts       # 爬取命令
│   ├── models/            # 数据模型
│   │   ├── JobData.ts
│   │   ├── CrawlConfig.ts
│   │   └── LinksConfig.ts
│   ├── parsers/           # 解析器
│   │   ├── base/
│   │   │   └── BaseParser.ts
│   │   ├── generated/     # LLM 生成的解析器
│   │   └── registry.ts
│   ├── prompts/           # Prompt 模板
│   │   └── parser-generator.ts
│   ├── services/          # 服务层
│   │   ├── BrowserService.ts
│   │   ├── LLMService.ts
│   │   └── ParserGenerator.ts
│   └── utils/             # 工具函数
│       ├── config.ts
│       └── loadLinksCsv.ts
├── output/                # 输出目录
├── links.csv              # CSV 配置文件
├── links.txt              # TXT 配置文件（向后兼容）
├── .env                   # 环境变量
└── package.json
```

## 🔧 开发

### 添加新的解析器

1. 将 URL 添加到 `links.csv`
2. 运行 `npm run generate`
3. 检查生成的解析器：`src/parsers/generated/`
4. 必要时手动优化生成的代码

### 扩展 BaseParser

如果需要通用的提取逻辑：

```typescript
// src/parsers/base/BaseParser.ts

protected extractSalary(tree: string): string {
  // 从 tree 中提取薪资信息
  const match = tree.match(/\$\d+,\d+/);
  return match ? match[0] : '';
}
```

### 自定义 Prompt

编辑 `src/prompts/parser-generator.ts` 中的：

1. `COMMON_SYSTEM_PROMPT` - 通用工具文档
2. `generateCustomPrompt()` - 自定义页面分析
3. `analyzeStructure()` - 页面结构分析规则

详细说明请参考：[Prompt 结构说明](docs/PROMPT_STRUCTURE.md)

## 📚 文档

- [CSV 配置指南](docs/CSV_CONFIG.md) - CSV 配置文件详细说明
- [Prompt 结构说明](docs/PROMPT_STRUCTURE.md) - Prompt 架构和使用
- [实现总结](IMPLEMENTATION_SUMMARY.md) - 完整的技术实现总结

## 🤝 贡献

欢迎提交 Pull Request！

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

MIT License

## 🙏 致谢

- [Agent-Browser](https://github.com/vercel-labs/agent-browser) - AI 浏览器自动化
- [GLM-4](https://open.bigmodel.cn/) - 智谱 AI 的语言模型
- [Playwright](https://playwright.dev/) - 浏览器自动化引擎

---

**最后更新:** 2026-02-05
