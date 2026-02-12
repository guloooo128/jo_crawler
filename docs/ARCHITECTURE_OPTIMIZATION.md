# JO Crawler 架构优化方案

> 以架构师视角对项目进行全面分析，提出系统性优化方案

## 一、当前架构诊断

### 1.1 架构全景

```
┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌─────────────┐
│  CLI 入口    │───▶│ ParserGenerator│───▶│  LLMService   │───▶│  Doubao API │
│  (commands/) │    │   (编排层)     │    │  (LLM 通信)    │    └─────────────┘
└──────┬──────┘    └──────┬───────┘    └───────────────┘
       │                  │
       │                  ▼
       │           ┌──────────────┐    ┌───────────────┐
       │           │BrowserService│───▶│ agent-browser  │
       │           │  (浏览器封装) │    │  (Playwright)  │
       │           └──────────────┘    └───────────────┘
       │
       ▼
┌──────────────┐    ┌──────────────┐    ┌───────────────┐
│  ParserRegistry│──▶│Generated      │───▶│  BaseParser   │
│  (解析器注册)  │   │Parsers (.js)  │    │  (996行基类)   │
└──────────────┘    └──────────────┘    └───────────────┘
       │
       ▼
┌──────────────┐
│DatabaseService│
│  (SQLite)     │
└──────────────┘
```

### 1.2 核心问题矩阵

| 严重等级 | 问题 | 影响范围 | 描述 |
|---------|------|---------|------|
| 🔴 严重 | BaseParser God Class | 全局 | 996 行，混合 6 种职责，难以维护和测试 |
| 🔴 严重 | 生成代码 80% 重复 | 每个解析器 | 每个解析器都重新定义 cleanDescription/extractLocation 等方法 |
| 🔴 严重 | LLMService 职责混乱 | 核心服务 | 既做 API 调用、又做文件保存、代码修复、README 生成 |
| 🟡 中等 | 无生成重试机制 | 解析器生成 | LLM 生成失败直接放弃，不做错误反馈重试 |
| 🟡 中等 | fixGeneratedCodeErrors 脆弱 | 代码质量 | 用正则修补 LLM 语法错误，可能引入新 bug |
| 🟡 中等 | 无并发处理 | 性能 | 批量生成/爬取全部串行 |
| 🟢 轻微 | 魔法数字散布 | 可维护性 | 超时、重试次数等硬编码在代码中 |
| 🟢 轻微 | JDExtractor 与 BaseParser 重复 | 代码重复 | 两套并行的详情页提取逻辑 |

---

## 二、优化方案总览

### 2.1 目标架构

```
┌───────────────────────────────────────────────────┐
│                    CLI Layer                       │
│         generate / crawl / export                  │
└────────────────────┬──────────────────────────────┘
                     │
┌────────────────────▼──────────────────────────────┐
│               Orchestration Layer                  │
│  ┌───────────────┐  ┌──────────────┐              │
│  │ParserGenerator│  │ CrawlEngine  │              │
│  │  (生成编排)    │  │ (爬取编排)    │              │
│  └───────┬───────┘  └──────┬───────┘              │
└──────────┼─────────────────┼──────────────────────┘
           │                 │
┌──────────▼─────────────────▼──────────────────────┐
│                 Service Layer                      │
│  ┌──────────┐ ┌────────┐ ┌──────────┐ ┌────────┐ │
│  │LLMClient │ │Browser │ │Persistence│ │Database│ │
│  │(纯API)   │ │Service │ │Service   │ │Service │ │
│  └──────────┘ └────────┘ └──────────┘ └────────┘ │
└───────────────────────────────────────────────────┘
           │
┌──────────▼────────────────────────────────────────┐
│                 Parser Layer                       │
│  ┌───────────┐ ┌────────────┐ ┌─────────────────┐│
│  │BaseParser │ │ListCrawler │ │DetailExtractor  ││
│  │(轻量基类) │ │(模板方法)   │ │(字段提取)       ││
│  └───────────┘ └────────────┘ └─────────────────┘│
│  ┌───────────┐ ┌────────────┐ ┌─────────────────┐│
│  │TextCleaner│ │FieldParser │ │ParserRegistry   ││
│  │(文本清洗) │ │(元数据提取) │ │(解析器注册)     ││
│  └───────────┘ └────────────┘ └─────────────────┘│
└───────────────────────────────────────────────────┘
```

### 2.2 优化优先级路线图

```
Phase 1 (高收益/低风险)          Phase 2 (中等)              Phase 3 (长期)
━━━━━━━━━━━━━━━━━━━━━━━━    ━━━━━━━━━━━━━━━━━━━━━━    ━━━━━━━━━━━━━━━━━━━━━
 ① 拆分 BaseParser            ④ LLM 生成重试机制         ⑦ 并发爬取引擎
 ② 提取 ListCrawler 模板      ⑤ 解析器沙盒验证           ⑧ 增量式解析器更新
 ③ 拆分 LLMService            ⑥ 优化 Prompt 减少重复     ⑨ 监控与指标收集
```

---

## 三、Phase 1：核心架构重构（高收益）

### 3.1 拆分 BaseParser God Class

**现状：** 996 行，承担 6 种职责

**目标：** 拆分为 5 个独立模块，每个 < 200 行

```
BaseParser (996 行)
  ├─ TextCleaner        → 文本清洗（cleanPageText, cleanDescriptionText, extractFullDescription）
  ├─ FieldParser        → 字段提取（extractLocation, extractJobMetadata, findJobTitleInRefs）
  ├─ ListCrawler        → 列表爬取模板（collectJobLinks, 分页循环, 详情导航）
  ├─ DetailExtractor    → 详情提取（extractJobFromPage, extractDetailFields）
  └─ BaseParser (轻量)  → 只保留 canParse, createJobData, metadata 等核心接口
```

#### 3.1.1 TextCleaner — 文本清洗服务

```typescript
// src/parsers/helpers/TextCleaner.ts
export class TextCleaner {
  /** 清理 HTML/JS/CSS 噪声 */
  static cleanPageText(text: string): string { ... }

  /** 清理职位描述文本 */
  static cleanDescription(rawText: string, options?: {
    startMarkers?: string[];
    endMarkers?: string[];
  }): string { ... }

  /** 提取 JD 段落 */
  static extractJDSections(text: string): {
    overview?: string;
    responsibilities?: string;
    requirements?: string;
    benefits?: string;
  } { ... }
}
```

#### 3.1.2 FieldParser — 字段提取器

```typescript
// src/parsers/helpers/FieldParser.ts
export class FieldParser {
  /** 从快照/描述中提取 location */
  static extractLocation(tree: string, description?: string): string { ... }

  /** 从快照中提取 title（带 ref 位置启发式） */
  static findJobTitleInRefs(refs: Record<string, any>): string { ... }

  /** 综合提取 postDate/deadLine/jobType/salary */
  static extractMetadata(tree: string, description: string): {
    postDate?: string;
    deadLine?: string;
    jobType?: string;
    salary?: string;
  } { ... }

  /** 公司名推断（从配置或域名） */
  static getCompanyName(domain: string, companyMap?: Record<string, string>): string { ... }
}
```

#### 3.1.3 ListCrawler — 列表页爬取模板（最高优化收益）

**这是最关键的优化。** 当前每个生成的列表解析器都包含 ~150 行几乎相同的代码：

```
Phase 1: 翻页 + 收集链接  (~60 行, 每个解析器几乎相同)
Phase 2: 逐个导航详情页    (~50 行, 每个解析器几乎相同)
Phase 3: 提取字段          (~40 行, 每个解析器几乎相同)
```

**优化后：** 提取为模板方法，生成的解析器只需提供配置

```typescript
// src/parsers/helpers/ListCrawler.ts
export interface ListCrawlerConfig {
  /** 站点名/公司名 */
  companyName: string;

  /** 翻页策略 */
  pagination?: {
    /** 如何找到"下一页"按钮 */
    strategy: 'next-button' | 'load-more' | 'url-param' | 'scroll-load';
    /** 自定义选择器/关键词 */
    selector?: string;
    keywords?: string[];
  };

  /** 描述清洗标记 */
  descriptionMarkers?: {
    start?: string[];
    end?: string[];
  };

  /** 自定义字段提取（可选覆盖） */
  customExtractors?: {
    location?: (rawText: string, tree: string) => string;
    postDate?: (rawText: string) => string;
    salary?: (rawText: string) => string;
  };
}

export class ListCrawler {
  /**
   * 标准列表页爬取流程（模板方法）
   *
   * 1. 翻页 + 用 LLM 识别职位链接
   * 2. 逐个导航详情页
   * 3. 提取结构化数据
   */
  static async crawl(
    browser: BrowserService,
    options: ParseOptions,
    config: ListCrawlerConfig,
    createJobData: (fields: Partial<JobData>) => JobData,
  ): Promise<JobData[]> {
    const allLinks = new Map<string, { ref: string; name: string; url: string }>();
    const jobs: JobData[] = [];
    let currentPage = 1;
    const maxPages = options.maxPages || 5;
    const maxItems = options.maxItems || 50;

    // ─── Phase 1: 翻页 + 收集链接 ───
    while (currentPage <= maxPages && allLinks.size < maxItems) {
      const { tree, refs } = await browser.getSnapshotWithRetry(
        { interactive: true, maxDepth: 5 }, 3, 2000
      );

      const jobRefs = await browser.llmIdentifyJobLinks(tree, refs);
      if (jobRefs.length === 0 && currentPage === 1) break;

      const links = await browser.collectJobLinks(browser, jobRefs);
      for (const link of links) {
        if (!allLinks.has(link.url)) allLinks.set(link.url, link);
      }

      if (allLinks.size >= maxItems) break;

      // 翻页
      const didPaginate = await this.paginate(browser, tree, refs, config.pagination);
      if (!didPaginate) break;
      currentPage++;
    }

    // ─── Phase 2: 逐个导航详情 ───
    const targetLinks = Array.from(allLinks.values()).slice(0, maxItems);
    for (const link of targetLinks) {
      try {
        await browser.navigate(link.url);
        await browser.waitForContent(10000, 2);
        const rawText = await browser.getMainContentText();
        const { tree } = await browser.getSnapshotWithRetry(
          { interactive: true, maxDepth: 5 }, 3, 2000
        );

        // ─── Phase 3: 提取字段 ───
        const description = TextCleaner.cleanDescription(rawText, config.descriptionMarkers);
        const metadata = FieldParser.extractMetadata(tree, description);
        const location = config.customExtractors?.location?.(rawText, tree)
          ?? FieldParser.extractLocation(tree, description);

        jobs.push(createJobData({
          job_title: link.name || FieldParser.findJobTitleInRefs({}),
          job_link: link.url,
          company_name: config.companyName,
          description,
          location,
          ...metadata,
        }));
      } catch (e: any) {
        console.warn(`⚠️ 提取失败 (${link.url}): ${e.message}`);
      }
    }

    return jobs;
  }

  /** 执行翻页 */
  private static async paginate(
    browser: BrowserService,
    tree: string,
    refs: Record<string, any>,
    config?: ListCrawlerConfig['pagination'],
  ): Promise<boolean> {
    // 根据 strategy 选择翻页方式
    // ...
  }
}
```

**优化后的生成解析器只需 ~40 行：**

```javascript
// 优化前: ~200 行（每个解析器）
// 优化后: ~40 行
import { BaseParser } from '../base/BaseParser.js';
import { ListCrawler } from '../helpers/ListCrawler.js';

export default class CbreListParser extends BaseParser {
  metadata = {
    name: 'cbre-list-parser',
    domain: 'careers.cbre.com',
    urlPattern: '/careers/searchjobs',
    version: '1.0.0',
    pageType: 'list',
  };

  canParse(snapshot, url) {
    return url.includes('careers.cbre.com') && url.includes('searchjobs');
  }

  async parse(browser, options) {
    return ListCrawler.crawl(browser, options, {
      companyName: 'CBRE',
      pagination: {
        strategy: 'next-button',
        keywords: ['Next', 'Show More', '下一页'],
      },
      descriptionMarkers: {
        start: ['About The Role', 'Job Summary', 'Description'],
        end: ['Apply Now', 'Similar Jobs', 'Share This Job'],
      },
    }, this.createJobData.bind(this));
  }
}
```

### 3.2 拆分 LLMService

**现状：** 624 行，混合 API 调用 + 文件 I/O + 代码修复 + README 生成

**目标：** 拆分为 3 个聚焦服务

```
LLMService (624 行)
  ├─ LLMClient           → 纯 API 通信（callGLM, 重试, 流式响应）
  ├─ ParserPersistence    → 文件保存（saveParser, saveAssets, generateREADME）
  └─ CodePostProcessor    → 代码后处理（fixErrors, validate, format）
```

```typescript
// src/services/LLMClient.ts — 纯 API 通信
export class LLMClient {
  async chat(messages: Message[], options?: ChatOptions): Promise<string> { ... }
  async analyzePageType(tree: string, url: string): Promise<PageType> { ... }
  async identifyJobLinks(tree: string, refs: Record): Promise<JobRef[]> { ... }
  async generateParserCode(prompt: string): Promise<string> { ... }
  async extractJobData(snapshot: string): Promise<Partial<JobData>> { ... }
}

// src/services/ParserPersistence.ts — 文件系统操作
export class ParserPersistence {
  async saveParser(domain: string, code: string, dir: string): Promise<string> { ... }
  async saveWithAssets(params: SaveAssetsParams): Promise<string> { ... }
  async generateREADME(metadata: ParserMeta): string { ... }
}

// src/services/CodePostProcessor.ts — 代码修复
export class CodePostProcessor {
  /** AST 级别验证（替代正则修补） */
  static validate(code: string): ValidationResult { ... }

  /** 安全的代码修复 */
  static fix(code: string, errors: ValidationError[]): string { ... }
}
```

### 3.3 消除 JDExtractor 重复

**合并为 DetailExtractor** — 把 `JDExtractor` 和 `BaseParser.extractDetailFields()` 统一：

```typescript
// src/parsers/helpers/DetailExtractor.ts
export class DetailExtractor {
  /**
   * 从当前页面提取完整职位数据
   * 统一 JDExtractor + BaseParser.extractDetailFields + BaseParser.extractJobFromPage
   */
  static async extractFromPage(browser: BrowserService, options?: {
    useLLM?: boolean;           // 是否用 LLM 辅助提取
    llmService?: LLMClient;
  }): Promise<Partial<JobData>> {
    const rawText = await browser.getMainContentText();
    const { tree } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });

    // 基础字段 — 总是走规则提取
    const title = FieldParser.findJobTitleInRefs(refs);
    const location = FieldParser.extractLocation(tree, rawText);
    const metadata = FieldParser.extractMetadata(tree, rawText);
    const description = TextCleaner.cleanDescription(rawText);

    // 如果启用 LLM，用来增强缺失字段
    if (options?.useLLM && options.llmService) {
      const llmData = await options.llmService.extractJobData(tree);
      return { title, location, description, ...metadata, ...llmData };
    }

    return { job_title: title, location, description, ...metadata };
  }
}
```

---

## 四、Phase 2：LLM 生成质量优化

### 4.1 生成-验证-重试循环

**现状：** LLM 生成失败 → 放弃
**目标：** 最多 3 轮自动修复

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│ LLM 生成  │────▶│ AST 验证  │────▶│ 沙盒测试  │────▶│ 保存解析器│
│ (Round 1) │     │          │     │          │     │          │
└──────────┘     └────┬─────┘     └────┬─────┘     └──────────┘
                      │ 失败            │ 失败
                      ▼                 ▼
                ┌──────────┐     ┌──────────┐
                │ 附加错误   │     │ 附加堆栈   │
                │ 信息重试   │     │ 信息重试   │
                │ (Round 2) │     │ (Round 3) │
                └──────────┘     └──────────┘
```

```typescript
// src/services/ParserGenerator.ts — 增强生成流程
async generateWithRetry(url: string, maxRetries = 3): Promise<GenerateResult> {
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 1. 生成代码
    const code = await this.llmClient.generateParserCode(
      this.buildPrompt(snapshot, lastError)  // 如果有上一轮错误，附加到 prompt
    );

    // 2. AST 验证
    const syntaxErrors = CodePostProcessor.validate(code);
    if (syntaxErrors.length > 0) {
      lastError = `语法错误: ${syntaxErrors.map(e => e.message).join('; ')}`;
      console.warn(`⚠️ Round ${attempt} 语法错误，重试中...`);
      continue;
    }

    // 3. 沙盒执行测试
    try {
      await this.sandboxTest(code, snapshot);
      return { code, success: true, attempts: attempt };
    } catch (e: any) {
      lastError = `运行时错误: ${e.message}\n堆栈: ${e.stack}`;
      console.warn(`⚠️ Round ${attempt} 运行时错误，重试中...`);
    }
  }

  return { code: '', success: false, error: lastError };
}
```

### 4.2 优化 Prompt — 减少生成代码量

**核心问题：** 当前 Prompt 的 few-shot 示例教 LLM 把所有逻辑写在解析器里，导致每个解析器 200+ 行

**优化策略：** 

1. **Prompt 明确说明 BaseParser 已有的方法** — 不需重新定义
2. **引导 LLM 使用 `ListCrawler.crawl()` 模板** — 只传配置
3. **减少 few-shot 代码量** — 从 200 行示例减到 40 行

```typescript
// 优化后的 Prompt 关键段落
const OPTIMIZED_SYSTEM_PROMPT = `
你是一个解析器配置生成器。生成的解析器应该调用 ListCrawler.crawl() 模板方法，
只提供站点特定的配置。

⚠️ 以下方法已在 BaseParser/ListCrawler/TextCleaner/FieldParser 中实现，
   绝对不要重新定义：
   - cleanDescription()     → 使用 TextCleaner.cleanDescription()
   - extractLocation()      → 使用 FieldParser.extractLocation()
   - extractPostDate()      → 使用 FieldParser.extractMetadata()
   - extractJobType()       → 使用 FieldParser.extractMetadata()
   - 翻页+链接收集循环       → 使用 ListCrawler.crawl()

你只需要提供：
1. metadata（name, domain, urlPattern, version, pageType）
2. canParse()（URL 匹配规则）
3. parse() — 调用 ListCrawler.crawl() 并传入站点配置
`;
```

### 4.3 用 AST 验证替代正则修补

**现状：** `fixGeneratedCodeErrors()` 用 ~10 个正则表达式修补常见 LLM 错误

**问题：**
- `fixedCode.replace(/=\s*=/g, '=')` 会破坏合法的 `==`/`===`
- `indexOf(match)` 方式不可靠——对非唯一字符串只修复第一个
- 无法处理上下文相关的错误

**优化：** 用 `acorn` (轻量 JS Parser) 做 AST 级验证

```typescript
import * as acorn from 'acorn';

export class CodePostProcessor {
  static validate(code: string): ValidationError[] {
    try {
      acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module' });
      return []; // 无语法错误
    } catch (e: any) {
      return [{
        line: e.loc?.line,
        column: e.loc?.column,
        message: e.message,
        type: 'syntax',
      }];
    }
  }

  /** 结构验证：检查必须的 class/方法 */
  static validateStructure(code: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const ast = acorn.parse(code, { ecmaVersion: 2022, sourceType: 'module' });

    // 检查是否有 default export
    // 检查是否有 parse 方法
    // 检查是否有 canParse 方法
    // 检查是否有 metadata 属性
    // ...

    return errors;
  }
}
```

---

## 五、Phase 3：性能与可靠性

### 5.1 并发爬取引擎

**现状：** 串行处理所有 URL，`concurrency` 配置项存在但未使用

```typescript
// src/services/CrawlEngine.ts
import pLimit from 'p-limit';

export class CrawlEngine {
  private browserPool: BrowserService[] = [];
  private concurrency: number;

  constructor(concurrency = 2) {
    this.concurrency = concurrency;
  }

  async crawlAll(configs: LinkConfig[]): Promise<CrawlResult[]> {
    const limit = pLimit(this.concurrency);

    // 创建浏览器池
    for (let i = 0; i < this.concurrency; i++) {
      const browser = new BrowserService();
      await browser.launch({ headless: true });
      this.browserPool.push(browser);
    }

    // 并发执行
    const tasks = configs.map((config, index) =>
      limit(async () => {
        const browser = this.browserPool[index % this.concurrency];
        return this.crawlSingle(browser, config);
      })
    );

    return Promise.all(tasks);
  }
}
```

### 5.2 LLM 调用重试 + 降级

```typescript
// src/services/LLMClient.ts
export class LLMClient {
  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const maxRetries = options?.maxRetries ?? 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.callAPI(messages, options);
        return response;
      } catch (error: any) {
        if (attempt === maxRetries) throw error;

        // 指数退避
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.warn(`⚠️ LLM 调用失败 (${attempt}/${maxRetries})，${delay}ms 后重试...`);
        await this.delay(delay);
      }
    }

    throw new Error('Unreachable');
  }
}
```

### 5.3 配置中心化

**消除魔法数字：**

```typescript
// src/utils/config.ts — 增强
export const config = {
  // ... 现有配置

  timeouts: {
    navigation: 60000,
    contentWait: 15000,
    snapshotStability: 2000,
    pageRender: 3000,
    betweenPages: 1500,
  },

  retry: {
    navigation: 2,
    snapshot: 5,
    llmCall: 3,
    parserGeneration: 3,
  },

  limits: {
    snapshotMaxChars: 5000,
    maxTokens: 8000,
    scrollTimes: 3,
    scrollDistance: 800,
  },

  companyMap: {
    'oraclecloud.com': 'JPMorgan Chase',
    'myworkdayjobs.com': undefined,  // 从 URL 推断
    // ...
  },
};
```

---

## 六、重构后目录结构

```
src/
├── index.ts
├── commands/
│   ├── crawl.ts
│   ├── export.ts
│   └── generate.ts
├── models/
│   ├── CrawlConfig.ts
│   ├── JobData.ts
│   └── LinksConfig.ts
├── parsers/
│   ├── base/
│   │   ├── BaseParser.ts          ← 轻量基类 (~200行)
│   │   ├── Parser.ts              ← 接口定义
│   │   └── GenericParser.ts       ← 通用降级解析器
│   ├── helpers/                   ← 🆕 拆分出的功能模块
│   │   ├── TextCleaner.ts         ← 文本清洗 (~150行)
│   │   ├── FieldParser.ts         ← 字段提取 (~200行)
│   │   ├── ListCrawler.ts         ← 列表爬取模板 (~200行)
│   │   └── DetailExtractor.ts     ← 详情提取 (~100行)
│   ├── generated/                 ← LLM 生成的解析器
│   └── registry.ts
├── prompts/
│   ├── parser-generator.ts        ← 优化后的 Prompt
│   └── job-link-identifier.ts
├── services/
│   ├── BrowserService.ts
│   ├── LLMClient.ts               ← 🆕 纯 API 通信
│   ├── CodePostProcessor.ts       ← 🆕 代码验证/修复
│   ├── CrawlEngine.ts             ← 🆕 并发爬取引擎
│   ├── DatabaseService.ts
│   ├── ParserGenerator.ts         ← 增强（重试循环）
│   └── ParserPersistence.ts       ← 🆕 文件保存
└── utils/
    ├── config.ts                  ← 增强（中心化配置）
    ├── jobId.ts
    ├── loadLinksCsv.ts
    └── parserFilename.ts
```

---

## 七、量化收益预估

| 指标 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| BaseParser 行数 | 996 | ~200 | **-80%** |
| 单个生成解析器行数 | ~200 | ~40 | **-80%** |
| LLM 生成 Token 消耗 | ~3000/解析器 | ~800/解析器 | **-73%** |
| 生成失败率 | ~15% (无重试) | ~3% (3轮重试) | **-80%** |
| 批量爬取速度 | 串行 | 并发(2-4) | **2-4x** |
| 代码重复率 | 高 (每个解析器) | 极低 (模板方法) | **显著降低** |
| 新网站适配时间 | 依赖 LLM 质量 | 只需配置 | **更可控** |

---

## 八、实施建议

### 第一步（立即可做，1-2天）
1. 创建 `src/parsers/helpers/` 目录
2. 从 BaseParser 中提取 `TextCleaner` 和 `FieldParser`
3. 现有代码通过 re-export 保持向后兼容

### 第二步（核心收益，2-3天）
4. 实现 `ListCrawler.crawl()` 模板方法
5. 更新 Prompt，让 LLM 生成配置式解析器
6. 验证新生成的解析器是否工作

### 第三步（质量提升，1-2天）
7. 拆分 LLMService → LLMClient + ParserPersistence
8. 添加 AST 验证替代正则修补
9. 实现生成-验证-重试循环

### 第四步（性能优化，1天）
10. 实现 CrawlEngine 并发爬取
11. 中心化配置消除魔法数字
