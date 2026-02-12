/**
 * Parser Generator Prompt (优化版 v3 — 配置式解析器)
 *
 * Phase 2 重构：
 * - 列表页解析器只需提供 ListCrawlerConfig，由 ListCrawler.crawl() 驱动
 * - 详情页解析器类似，由 DetailExtractor 处理提取
 * - 生成代码从 ~200 行降到 ~60 行
 */

// ============================================================================
// 第一部分：System Prompt
// ============================================================================

export const PARSER_GENERATOR_SYSTEM = `你是一个专业的前端数据提取专家。你需要根据页面快照生成**针对该网站专用**的 JavaScript 解析器。

## 核心原则

1. **配置优于代码** - 使用 ListCrawler.crawl() 模板方法 + 配置对象，不要手写翻页循环
2. **精确取值优先** - 使用 \`browser.getText('@eXX')\` 直接从页面元素取值是最精确的方式
3. **URL 导航模式** - 列表页遍历使用 \`collectJobLinks()\` + \`browser.navigate()\`，**禁止** click+goBack
4. **自提 description** - 始终用 \`browser.getMainContentText()\` 获取完整文本，自己清理

## 代码规范

### 列表页解析器模板（推荐）

\`\`\`javascript
import { BaseParser } from '../base/BaseParser.js';
import { ListCrawler } from '../helpers/ListCrawler.js';

export default class DomainParser extends BaseParser {
  metadata = {
    name: 'DomainParser',
    version: '1.0.0',
    domain: 'example.com',
    url: '原始URL',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: '描述',
  };

  canParse(_snapshot, url) {
    return url.includes('domain');
  }

  async parse(browser, options) {
    // 使用 ListCrawler 模板方法——只需提供配置
    return ListCrawler.crawl(browser, options, {
      companyName: 'CompanyName',
      pagination: { strategy: 'auto' },
      descriptionOptions: {
        startMarkers: ['Job Description', 'Overview', 'About This Role'],
        endMarkers: ['Similar Jobs', 'Privacy Policy'],
      },
      // 可选：自定义字段提取器
      customExtractors: {
        location: (rawText) => {
          const m = rawText.match(/Location:\\s*([A-Za-z][A-Za-z ,]{3,60})/i);
          return m ? m[1].trim() : '';
        },
      },
    }, (data) => this.createJobData(data));
  }

  getDefaults() {
    return { maxItems: 50, maxPages: 5 };
  }
}
\`\`\`

### 详情页解析器模板

\`\`\`javascript
import { BaseParser } from '../base/BaseParser.js';

export default class DomainDetailParser extends BaseParser {
  metadata = {
    name: 'DomainDetailParser',
    version: '1.0.0',
    domain: 'example.com',
    url: '原始URL',
    pageType: 'detail',
    author: 'AI',
    createdAt: new Date(),
    description: '描述',
  };

  canParse(_snapshot, url) {
    return url.includes('example.com/careers/') && url.match(/\\/\\d+/);
  }

  async parse(browser, options) {
    const url = await browser.getCurrentUrl();

    let rawText = '';
    try {
      rawText = await browser.getMainContentText();
    } catch (e) {
      rawText = await browser.getCleanPageText();
    }

    const description = this.cleanDescription(rawText);
    const pageTitle = await browser.getTitle();

    return [this.createJobData({
      job_title: this.extractTitleFromPage(pageTitle, rawText),
      company_name: this.getCompanyName(),
      location: this.extractLocation(rawText),
      job_link: url,
      post_date: this.extractPostDate(rawText),
      job_type: this.extractJobType(rawText),
      description: description,
      salary: this.extractSalary(rawText),
      source: this.getCompanyName(),
    })];
  }

  // ====== 站点特定的辅助方法 ======

  cleanDescription(rawText) {
    if (!rawText) return '';
    // 根据快照中发现的文本特征自定义起止标记
    const startMarkers = ['Job Description', 'Overview'];
    const endMarkers = ['Similar Jobs', 'Privacy Policy'];

    let startIdx = rawText.length;
    for (const m of startMarkers) {
      const idx = rawText.indexOf(m);
      if (idx !== -1 && idx < startIdx) startIdx = idx;
    }

    let endIdx = rawText.length;
    for (const m of endMarkers) {
      const idx = rawText.toLowerCase().indexOf(m.toLowerCase());
      if (idx !== -1 && idx < endIdx) endIdx = idx;
    }

    return this.cleanText(rawText.substring(startIdx, endIdx));
  }

  extractLocation(text) {
    const m = text.match(/Location:\\s*([A-Za-z][A-Za-z0-9 ,]{3,60})/i);
    return m ? m[1].trim() : '';
  }

  extractPostDate(text) {
    const m = text.match(/Posted:\\s*([\\d\\w\\s]{10,30})/i);
    return m ? m[1].trim() : '';
  }

  extractJobType(text) {
    const m = text.match(/Job Type:\\s*(Full-time|Part-time|Contract|Permanent)/i);
    return m ? m[1].trim() : '';
  }

  extractSalary(text) {
    const m = text.match(/\\$[\\d,]+\\s*[-\u2013to]\\s*\\$[\\d,k]+/i);
    return m ? m[0].trim() : '';
  }

  extractTitleFromPage(pageTitle, rawText) {
    const parts = pageTitle.split('|')[0].split('-')[0];
    const title = parts.trim();
    if (title.length > 5 && title.length < 100) return title;
    const m = rawText.match(/(?:Job Title|Position):\\s*([A-Za-z][A-Za-z0-9\\s]{5,60})/i);
    return m ? m[1].trim() : pageTitle;
  }

  getDefaults() {
    return { maxItems: 1 };
  }
}
\`\`\`

## 可用方法速查表

### BaseParser 方法（用 this 调用）
| 方法 | 说明 | 返回值 |
|------|------|--------|
| \`this.createJobData(data)\` | 创建标准 JobData 对象 | JobData |
| \`this.delay(ms)\` | 延迟 | void |
| \`this.cleanText(text)\` | 清理空白 | string |
| \`this.getCompanyName()\` | 获取公司名 | string |
| \`this.collectJobLinks(browser, jobRefs)\` | 收集职位URL | Array<{ref,name,url}> |

### ListCrawler 方法（列表页推荐）
| 方法 | 说明 |
|------|------|
| \`ListCrawler.crawl(browser, options, config, createJobData)\` | 标准爬取流程 |

**ListCrawlerConfig 配置项：**
- \`companyName\`: 公司名称（必填）
- \`pagination\`: 翻页配置
  - \`strategy\`: \`'next-button'\` / \`'load-more'\` / \`'scroll-load'\` / \`'url-param'\` / \`'auto'\`
  - \`keywords\`: 自定义翻页按钮关键词数组
  - \`waitAfter\`: 翻页后等待时间（ms）
- \`descriptionOptions\`: 描述清洗配置
  - \`startMarkers\`: 正文起始标记数组
  - \`endMarkers\`: 正文结束标记数组
- \`dismissPopup\`: Cookie/弹窗关闭函数
- \`customExtractors\`: 自定义字段提取函数
  - \`location\`, \`postDate\`, \`salary\`, \`jobType\`
- \`detailWait\`: 详情页等待时间（ms）

### BrowserService 方法（用 await browser 调用）
| 方法 | 说明 | 返回值 |
|------|------|--------|
| \`await browser.getSnapshot({interactive:true,maxDepth:5})\` | 获取快照 | {tree,refs} |
| \`await browser.getCurrentUrl()\` | 获取当前URL | string |
| \`await browser.navigate(url)\` | 导航到URL | void |
| \`await browser.getText('@eXX')\` | 获取元素文本 | string |
| \`await browser.getAttribute('@eXX','href')\` | 获取属性 | string |
| \`await browser.click('@eXX')\` | 点击元素 | void |
| \`await browser.getMainContentText()\` | 获取主要内容文本 | string |
| \`await browser.getCleanPageText()\` | 获取去噪文本 | string |
| \`await browser.getTitle()\` | 获取页面标题 | string |
| \`await browser.waitForTimeout(ms)\` | 等待 | void |
| \`await browser.getJobLinksFromHTML()\` | **从iframe获取职位链接** | Array<{url,name,location}> |
| \`await browser.llmIdentifyJobLinks(snapshot,refs)\` | **用LLM智能识别职位链接** | Array<{ref,name,reason}> |

### ⭐ 特殊场景：iframe / Greenhouse / Lever 嵌入式

某些网站使用 iframe 嵌入职位列表，\`getSnapshot()\` 无法获取 iframe 中的内容。

**解决方法：** 在 ListCrawlerConfig 中不使用 ListCrawler，改为手动调用：
\`\`\`javascript
const allJobLinks = await browser.getJobLinksFromHTML();
\`\`\`

## JobData 字段

\`\`\`javascript
{
  job_id: string,       // 自动生成，无需手动设置
  job_title: string,
  company_name: string,
  location: string,
  job_link: string,
  post_date: string,
  dead_line: string,
  job_type: string,     // Full-time/Part-time/Contract/Permanent/Internship
  description: string,
  salary: string,
  source: string,
  extracted_at: string,
}
\`\`\`

## ⚠️ 三个禁止

1. **禁止** \`browser.click() + browser.goBack()\` 遍历列表 → ref会失效
2. **禁止** \`browser.getPageText()\` 提取description → 噪音太多
3. **禁止** 忘记 await → 会报错

## ⚠️ 常见错误

| 错误 | 正确写法 |
|------|----------|
| \`browser.delay(1000)\` | \`this.delay(1000)\` |
| \`await this.browser.xxx\` | \`await browser.xxx\` |
| \`this.url\` | \`await browser.getCurrentUrl()\` |
| 手写翻页循环 | 使用 \`ListCrawler.crawl()\` |

## ⚠️ import 注意

列表页解析器必须同时导入 BaseParser 和 ListCrawler：
\`\`\`javascript
import { BaseParser } from '../base/BaseParser.js';
import { ListCrawler } from '../helpers/ListCrawler.js';
\`\`\`
`;

// ============================================================================
// 第二部分：Few-Shot 示例（配置式）
// ============================================================================

const LIST_PAGE_EXAMPLE = `
\`\`\`javascript
import { BaseParser } from '../base/BaseParser.js';
import { ListCrawler } from '../helpers/ListCrawler.js';

export default class ExampleComParser extends BaseParser {
  metadata = {
    name: 'ExampleComParser',
    version: '1.0.0',
    domain: 'example.com',
    url: 'https://example.com/careers',
    pageType: 'list',
    author: 'AI',
    createdAt: new Date(),
    description: 'Example.com 列表页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('example.com/careers');
  }

  async parse(browser, options) {
    return ListCrawler.crawl(browser, options, {
      companyName: 'Example Corp',

      // 翻页策略：auto = 自动检测（Next/Load More/滚动）
      pagination: {
        strategy: 'auto',
        waitAfter: 3000,
      },

      // 描述清洗：告诉 TextCleaner 从哪些标记开始/结束截取
      descriptionOptions: {
        startMarkers: [
          'Job Description', 'Overview', 'About This Role',
          'Responsibilities', 'What You\\'ll Do', 'Your Role',
        ],
        endMarkers: [
          'Similar Jobs', 'Related Jobs', 'Share this job',
          'Privacy Policy', 'Cookie Settings', 'Follow us',
        ],
      },

      // 自定义字段提取器（可选，默认使用 FieldParser）
      customExtractors: {
        location: (rawText) => {
          const patterns = [
            /([A-Z][a-z]+,\\s*[A-Z]{2})/,
            /Location:\\s*([A-Za-z][A-Za-z0-9 ,]+)/i,
          ];
          for (const p of patterns) {
            const m = rawText.match(p);
            if (m && m[1].length > 3 && m[1].length < 60) return m[1].trim();
          }
          return '';
        },

        postDate: (rawText) => {
          const m = rawText.match(/Posted:\\s*(\\d{1,2}\\s+\\w+\\s+\\d{4})/i)
            || rawText.match(/Date Posted:\\s*(\\d{4}-\\d{2}-\\d{2})/);
          return m ? m[1].trim() : '';
        },

        jobType: (rawText) => {
          const m = rawText.match(/Job Type:\\s*(Full-time|Part-time|Contract|Permanent|Internship)/i);
          return m ? m[1].trim() : '';
        },
      },

      // 弹窗关闭（可选）
      // dismissPopup: async (browser, refs) => {
      //   const cookieBtn = Object.entries(refs).find(([k, r]) =>
      //     r.role === 'button' && /accept|close|ok|got it/i.test(r.name || '')
      //   );
      //   if (cookieBtn) await browser.click('@' + cookieBtn[0]);
      // },
    }, (data) => this.createJobData(data));
  }

  getDefaults() {
    return { maxItems: 50, maxPages: 5 };
  }
}
\`\`\``;

const DETAIL_PAGE_EXAMPLE = `
\`\`\`javascript
import { BaseParser } from '../base/BaseParser.js';

export default class ExampleDetailParser extends BaseParser {
  metadata = {
    name: 'ExampleDetailParser',
    version: '1.0.0',
    domain: 'example.com',
    url: 'https://example.com/careers/123',
    pageType: 'detail',
    author: 'AI',
    createdAt: new Date(),
    description: 'Example.com 详情页解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('example.com/careers/') && url.match(/\\/\\d+/);
  }

  async parse(browser, options) {
    const url = await browser.getCurrentUrl();

    let rawText = '';
    try {
      rawText = await browser.getMainContentText();
    } catch (e) {
      rawText = await browser.getCleanPageText();
    }

    const description = this.cleanDescription(rawText);
    const pageTitle = await browser.getTitle();
    const jobTitle = this.extractTitleFromPage(pageTitle, rawText);

    return [this.createJobData({
      job_title: jobTitle,
      company_name: this.getCompanyName(),
      location: this.extractLocation(rawText),
      job_link: url,
      post_date: this.extractPostDate(rawText),
      job_type: this.extractJobType(rawText),
      description: description,
      salary: this.extractSalary(rawText),
      source: this.getCompanyName(),
    })];
  }

  cleanDescription(rawText) {
    if (!rawText) return '';
    const startMarkers = ['Job Description', 'Overview', 'About This Role', 'Responsibilities'];
    const endMarkers = ['Similar Jobs', 'Privacy Policy', 'Cookie Settings'];

    let startIdx = rawText.length;
    for (const m of startMarkers) {
      const idx = rawText.indexOf(m);
      if (idx !== -1 && idx < startIdx) startIdx = idx;
    }

    let endIdx = rawText.length;
    for (const m of endMarkers) {
      const idx = rawText.toLowerCase().indexOf(m.toLowerCase());
      if (idx !== -1 && idx < endIdx) endIdx = idx;
    }

    return this.cleanText(rawText.substring(startIdx, endIdx));
  extractLocation(text) {
    const m = text.match(/Location:\\s*([A-Za-z][A-Za-z0-9 ,]{3,60})/i);
    return m ? m[1].trim() : '';
  }

  extractPostDate(text) {
    const m = text.match(/Posted:\\s*([\\d\\w\\s]{10,30})/i);
    return m ? m[1].trim() : '';
  }

  extractJobType(text) {
    const m = text.match(/Job Type:\\s*(Full-time|Part-time|Contract|Permanent)/i);
    return m ? m[1].trim() : '';
  }

  extractSalary(text) {
    const m = text.match(/\\$[\\d,]+\\s*[-\u2013to]\\s*\\$[\\d,k]+/i);
    return m ? m[0].trim() : '';
  }

  extractTitleFromPage(pageTitle, rawText) {
    const parts = pageTitle.split('|')[0].split('-')[0];
    const title = parts.trim();
    if (title.length > 5 && title.length < 100) return title;
    const m = rawText.match(/(?:Job Title|Position):\\s*([A-Za-z][A-Za-z0-9\\s]{5,60})/i);
    return m ? m[1].trim() : pageTitle;
  }

  getDefaults() {
    return { maxItems: 1 };
  }
}
\`\`\``;

// ============================================================================
// 第三部分：User Prompt 生成函数
// ============================================================================

interface PromptContext {
  domain: string;
  url: string;
  snapshot: string;
  refs: Record<string, any>;
  pageType: 'list' | 'detail';
  detailSnapshot?: {
    tree: string;
    refs: Record<string, any>;
    url: string;
    rawText: string;
  };
}

/**
 * 生成 User Prompt
 */
export function generateParserPrompt(ctx: PromptContext): string {
  const { domain, url, snapshot, refs, pageType, detailSnapshot } = ctx;

  const structureHints = analyzeStructure(snapshot, refs);
  const jobCardInfo = analyzeJobCards(refs);
  const paginationInfo = analyzePagination(refs);
  const meaningfulSnapshot = extractMeaningfulSnapshot(snapshot);
  const detailSection = detailSnapshot ? generateDetailSection(detailSnapshot) : '';
  const example = pageType === 'list' ? LIST_PAGE_EXAMPLE : DETAIL_PAGE_EXAMPLE;
  const requirements = pageType === 'list' ? LIST_REQUIREMENTS : DETAIL_REQUIREMENTS;
  const pageTypeText = pageType === 'list' ? '列表页' : '详情页';

  // 使用字符串拼接避免模板字符串转义问题
  let output = '';
  output += '**任务：为以下网站生成专用解析器**\n\n';
  output += '域名: `' + domain + '`\n';
  output += 'URL: `' + url + '`\n';
  output += '页面类型: **' + pageTypeText + '**\n\n';
  output += '---\n\n';
  output += '## 页面结构分析\n\n';

  for (const hint of structureHints) {
    output += '- ' + hint + '\n';
  }

  output += '\n' + paginationInfo + '\n\n';
  output += '---\n\n';
  output += '## 页面快照（可访问性树）\n\n';
  output += '```\n' + meaningfulSnapshot + '\n```\n\n';
  output += '---\n\n';
  output += '## 职位链接分析\n\n';
  output += jobCardInfo + '\n\n';
  output += detailSection + '\n\n';
  output += '---\n\n';
  output += '## 生成要求\n\n';
  output += '### 必须实现的功能\n\n';
  output += requirements + '\n\n';
  output += '### 代码模板（请参考并模仿下面的示例）\n\n';
  output += example + '\n\n';
  output += '---\n\n';
  output += '## 提交格式\n\n';
  output += '只返回纯 JavaScript 代码，不要包含 ``` 标记。代码必须能直接保存为 .js 文件运行。';

  return output;
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 分析页面结构
 */
function analyzeStructure(snapshot: string, refs: Record<string, any>): string[] {
  const hints: string[] = [];

  const linkCount = Object.values(refs).filter(r => r.role === 'link').length;
  const longLinks = Object.values(refs).filter(r => r.role === 'link' && r.name && r.name.length > 40);

  hints.push('页面包含 ' + linkCount + ' 个链接');
  hints.push('其中 ' + longLinks.length + ' 个长链接（可能是职位）');

  if (snapshot.includes('Load More') || snapshot.includes('load more')) {
    hints.push('✓ 发现 "Load More" 翻页模式');
  }
  if (snapshot.includes('next') || snapshot.includes('pagination')) {
    hints.push('✓ 发现分页导航');
  }

  return hints;
}

/**
 * 分析翻页元素
 */
function analyzePagination(refs: Record<string, any>): string {
  const paginationElements: string[] = [];

  for (const [key, ref] of Object.entries(refs)) {
    if (ref.role === 'button' || ref.role === 'link') {
      const name = (ref.name || '').toLowerCase();
      if (/load more|show more|next|›|»|下一页|更多/i.test(name)) {
        paginationElements.push('- @' + key + ' (' + ref.role + '): "' + ref.name + '"');
      }
    }
  }

  if (paginationElements.length > 0) {
    return '**翻页元素：**\n' + paginationElements.join('\n');
  }

  return '**翻页元素：** 未发现明显翻页按钮，建议尝试 URL 参数翻页（如 ?page=2）';
}

/**
 * 分析职位卡片
 */
function analyzeJobCards(refs: Record<string, any>): string {
  const longLinks = Object.entries(refs)
    .filter(([_, r]) => r.role === 'link' && r.name && r.name.length > 40)
    .slice(0, 5);

  if (longLinks.length === 0) {
    return '**职位链接：** 未发现明显职位链接（可能是详情页）';
  }

  const lines = longLinks.map(([key, ref]) => {
    const name = ref.name.substring(0, 80) + (ref.name.length > 80 ? '...' : '');
    return '@' + key + ': "' + name + '"';
  });

  return '**职位链接示例：**\n' + lines.join('\n');
}

/**
 * 提取有意义的快照
 */
function extractMeaningfulSnapshot(snapshot: string): string {
  const lines = snapshot.split('\n');
  const result: string[] = [];
  let skipMode = false;

  for (const line of lines) {
    if (line.includes('Select Country')) {
      skipMode = true;
      continue;
    }
    if (skipMode && (line.includes('heading') || line.includes('Job Search'))) {
      skipMode = false;
    }
    if (line.includes('Cookie Policy')) {
      break;
    }
    if (!skipMode) {
      result.push(line);
    }
  }

  const text = result.join('\n');
  return text.length > 5000 ? text.substring(0, 5000) + '\n... (截断)' : text;
}

/**
 * 生成详情页信息
 */
function generateDetailSection(detail: { tree: string; refs: Record<string, any>; url: string; rawText: string }): string {
  let output = '';
  output += '\n---\n\n';
  output += '## 详情页样本（第一个职位）\n\n';
  output += '**URL:** ' + detail.url + '\n\n';
  output += '**原始页面文本：**\n';
  output += '```\n' + detail.rawText.substring(0, 1500) + '\n```\n\n';
  output += '**注意：** 原始文本通常是连续字符串（无换行），需用正则定位正文起止位置。';
  return output;
}

// ============================================================================
// 固定指令文本
// ============================================================================

const LIST_REQUIREMENTS = `
1. **使用 ListCrawler.crawl()** - 列表页必须使用 ListCrawler 模板方法，不要手写翻页循环
2. **提供 ListCrawlerConfig** - 配置 companyName、pagination（翻页策略）、descriptionOptions（描述标记）
3. **自定义提取器** - 如果网站有特殊字段格式，通过 customExtractors 提供
4. **导入 ListCrawler** - \`import { ListCrawler } from '../helpers/ListCrawler.js';\`
5. **传递 createJobData** - 最后一个参数传 \`(data) => this.createJobData(data)\`
`;

const DETAIL_REQUIREMENTS = `
1. **单页提取** - 详情页只提取一个职位的数据
2. **自提description** - 用 \`browser.getMainContentText()\` 获取文本，编写 \`cleanDescription()\` 清理
3. **标题处理** - 从 \`browser.getTitle()\` 或原始文本中提取职位名
4. **辅助方法** - 实现 extractLocation, extractPostDate, extractJobType, extractSalary 等
`;

// ============================================================================
// 导出接口
// ============================================================================

export const PARSER_GENERATOR_USER = (
  domain: string,
  snapshot: string,
  url: string,
  refMap: Record<string, any>,
  pageType?: 'list' | 'detail',
  detailSnapshot?: { tree: string; refs: Record<string, any>; url: string; rawText: string }
): string => {
  return generateParserPrompt({
    domain,
    url,
    snapshot,
    refs: refMap,
    pageType: pageType || 'list',
    detailSnapshot,
  });
};

/**
 * 域名转类名
 */
export function toClassName(domain: string): string {
  return domain
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .split(' ')
    .filter(w => w)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/**
 * 从域名推断公司名
 */
export function guessCompanyName(domain: string): string {
  const known: Record<string, string> = {
    'oraclecloud': 'JPMorgan Chase',
    'microsoft': 'Microsoft',
    'google': 'Google',
    'amazon': 'Amazon',
    'apple': 'Apple',
    'capgemini': 'Capgemini',
    'myworkdayjobs': 'Workday',
  };

  for (const [key, name] of Object.entries(known)) {
    if (domain.includes(key)) return name;
  }

  const parts = domain.split('.');
  for (const p of parts) {
    if (p !== 'www' && p !== 'com' && p.length > 2) {
      return p.charAt(0).toUpperCase() + p.slice(1);
    }
  }
  return 'Unknown';
}
