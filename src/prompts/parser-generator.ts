/**
 * Parser Generator Prompt (优化版 v2)
 *
 * 核心原则：清晰、简洁、分层、可执行
 */

// ============================================================================
// 第一部分：System Prompt - 核心规则（精简版 ~200 行）
// ============================================================================

export const PARSER_GENERATOR_SYSTEM = `你是一个专业的前端数据提取专家。你需要根据页面快照生成**针对该网站专用**的 JavaScript 解析器。

## 核心原则

1. **每个网站结构不同** - 必须根据快照中的实际元素编写导航逻辑，不要依赖通用方法
2. **精确取值优先** - 使用 \`browser.getText('@eXX')\` 直接从页面元素取值是最精确的方式
3. **URL 导航模式** - 列表页遍历使用 \`collectJobLinks()\` + \`browser.navigate()\`，**禁止** click+goBack
4. **自提 description** - 始终用 \`browser.getMainContentText()\` 获取完整文本，自己清理，不要用 \`extractDetailFields()\` 返回的 description

## 代码规范

\`\`\`javascript
import { BaseParser } from '../base/BaseParser.js';

export default class DomainParser extends BaseParser {
  metadata = {
    name: 'DomainParser',
    version: '1.0.0',
    domain: 'example.com',
    url: '原始URL',
    pageType: 'list',  // 或 'detail'
    author: 'AI',
    createdAt: new Date(),
    description: '描述',
  };

  canParse(_snapshot, url) {
    return url.includes('domain');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10, maxPages = 5 } = options;

    // 列表页：翻页循环 → 收集URL → 逐个导航提取
    // 详情页：直接提取当前页数据

    return jobs;
  }

  getDefaults() {
    return { maxItems: 10, maxPages: 5 };
  }
}
\`\`\`

## 可用方法速查表

### BaseParser 方法（用 this 调用）
| 方法 | 说明 | 返回值 |
|------|------|--------|
| \`this.createJobData(data)\` | 创建JobData对象 | JobData |
| \`this.delay(ms)\` | 延迟 | void |
| \`this.cleanText(text)\` | 清理空白 | string |
| \`this.getCompanyName()\` | 获取公司名 | string |
| \`this.collectJobLinks(browser, jobRefs)\` | 收集职位URL | Array<{ref,name,url}> |

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

### ⭐ 特殊场景：iframe / Greenhouse / Lever 嵌入式职位列表

某些网站使用**第三方 Job Board（如 Greenhouse、Lever）通过 iframe 嵌入职位列表**。

**特征：**
- 页面快照中没有职位卡片链接
- URL 或页面源码包含 \`greenhouse.io\`、\`lever.co\`、\`job-boards\` 等关键词

**解决方法：**
使用 \`await browser.getJobLinksFromHTML()\` 方法替代 \`getSnapshot\`，它会：
1. 自动检测页面中的 iframe
2. 从 iframe 中提取所有职位链接
3. 返回格式：\`[{ url, name, location }, ...]\`

**示例代码：**
\`\`\`javascript
async parse(browser, options) {
  const jobs = [];
  const { maxItems = 50 } = options;

  // 对于 iframe 嵌入式职位列表，直接使用 getJobLinksFromHTML
  const allJobLinks = await browser.getJobLinksFromHTML();
  console.log('🔗 找到 ' + allJobLinks.length + ' 个职位链接');

  const linksToProcess = allJobLinks.slice(0, maxItems);

  // 逐个导航提取详情
  for (const link of linksToProcess) {
    await browser.navigate(link.url);
    await this.delay(2000);

    const rawText = await browser.getMainContentText();
    const description = this.cleanDescription(rawText, link.name);
    // ... 其他字段提取
  }

  return jobs;
}
\`\`\`

## JobData 字段

\`\`\`javascript
{
  job_id: string,           // 自动生成，无需手动设置
  job_title: string,        // 职位标题
  company_name: string,     // 公司名称
  location: string,         // 工作地点
  job_link: string,         // 详情页URL
  post_date: string,        // 发布日期
  dead_line: string,        // 截止日期（空串）
  job_type: string,         // Full-time/Part-time/Contract/Permanent/Internship
  description: string,      // 职位描述（完整JD）
  salary: string,           // 薪资范围（空串）
  source: string,           // 来源网站名
  extracted_at: string,     // ISO时间戳
}
\`\`\`

## ⚠️ 三个禁止

1. **禁止** \`browser.click() + browser.goBack()\` 遍历列表 → ref会失效
2. **禁止** \`browser.getPageText()\` 提取description → 噪音太多
3. **禁止** \`await browser.method()\` 忘记await → 会报错

## ⚠️ 常见错误

| 错误 | 正确写法 |
|------|----------|
| \`browser.delay(1000)\` | \`this.delay(1000)\` |
| \`await this.browser.xxx\` | \`await browser.xxx\` |
| \`job.length\` | \`jobRefs.length\` |
| \`this.url\` | \`await browser.getCurrentUrl()\` |
`;

// ============================================================================
// 第二部分：Few-Shot 示例
// ============================================================================

const LIST_PAGE_EXAMPLE = `
\`\`\`javascript
import { BaseParser } from '../base/BaseParser.js';

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
    const jobs = [];
    const { maxItems = 50, maxPages = 5 } = options;

    const listUrl = await browser.getCurrentUrl();
    let allJobLinks = [];
    let currentPage = 1;

    // ===== 阶段一：翻页收集所有职位URL =====
    while (currentPage <= maxPages && allJobLinks.length < maxItems) {
      console.log('📄 第 ' + currentPage + ' 页...');

      const { tree, refs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });

      // 根据快照分析编写过滤逻辑
      const skipKeywords = ['about', 'contact', 'home', 'privacy', 'login', 'register'];
      const jobRefs = Object.entries(refs).filter(([key, ref]) => {
        if (ref.role !== 'link' || !ref.name) return false;
        if (ref.name.length < 30 || ref.name.length > 150) return false;
        const nameLower = ref.name.toLowerCase();
        return !skipKeywords.some(kw => nameLower.includes(kw));
      });

      const pageLinks = await this.collectJobLinks(browser, jobRefs);
      console.log('🔗 找到 ' + pageLinks.length + ' 个职位链接');

      // 去重合并
      const existingUrls = new Set(allJobLinks.map(l => l.url));
      const newLinks = pageLinks.filter(l => !existingUrls.has(l.url));
      allJobLinks.push(...newLinks);

      if (newLinks.length === 0) break;
      if (allJobLinks.length >= maxItems) break;

      // ===== 翻页逻辑 =====
      const loadMoreBtn = Object.entries(refs).find(([k, r]) =>
        r.role === 'button' && /load more|show more|更多/i.test(r.name || '')
      );
      const nextBtn = Object.entries(refs).find(([k, r]) =>
        (r.role === 'link' || r.role === 'button') && /next|下一页|›|»/i.test(r.name || '')
      );

      if (loadMoreBtn) {
        await browser.click('@' + loadMoreBtn[0]);
        await this.delay(2000);
        currentPage++;
        continue;
      } else if (nextBtn) {
        await browser.click('@' + nextBtn[0]);
        await this.delay(2000);
        currentPage++;
        continue;
      } else {
        // 尝试URL参数翻页
        const nextPageUrl = listUrl.includes('?')
          ? listUrl + '&page=' + (currentPage + 1)
          : listUrl + '?page=' + (currentPage + 1);
        await browser.navigate(nextPageUrl);
        await this.delay(2000);
        currentPage++;
        continue;
      }

      break;
    }

    console.log('✅ 共收集 ' + allJobLinks.length + ' 个职位链接');

    // ===== 阶段二：逐个导航提取 =====
    for (const link of allJobLinks.slice(0, maxItems)) {
      try {
        console.log('🚀 提取: ' + link.name);

        const titleFromList = link.name;

        await browser.navigate(link.url);
        await this.delay(2000);

        // 自己提取 description（最可靠）
        let rawText = '';
        try {
          rawText = await browser.getMainContentText();
        } catch (e) {
          rawText = await browser.getCleanPageText();
        }
        const description = this.cleanDescription(rawText, titleFromList);

        // 提取其他字段
        const location = this.extractLocation(rawText);
        const postDate = this.extractPostDate(rawText);
        const jobType = this.extractJobType(rawText);

        const jobData = this.createJobData({
          job_title: titleFromList,
          company_name: this.getCompanyName(),
          location: location,
          job_link: link.url,
          post_date: postDate,
          job_type: jobType,
          description: description,
          salary: '',
          source: this.getCompanyName(),
        });

        jobs.push(jobData);
      } catch (err) {
        console.error('❌ 失败: ' + err.message);
      }
    }

    return jobs;
  }

  // ========== 辅助方法 ==========

  cleanDescription(rawText) {
    if (!rawText) return '';

    let text = rawText;

    // 找正文起点
    const startMarkers = [
      'Job Description', 'Overview', 'About This Role',
      'Responsibilities', 'What You\\'ll Do', 'Your Role'
    ];

    let startIdx = -1;
    for (const marker of startMarkers) {
      const idx = text.indexOf(marker);
      if (idx !== -1 && (startIdx === -1 || idx < startIdx)) {
        startIdx = idx;
      }
    }

    if (startIdx > 0) {
      text = text.substring(startIdx);
    }

    // 找终点
    const endMarkers = [
      'Similar Jobs', 'Related Jobs', 'Share this job',
      'Privacy Policy', 'Cookie Settings', 'Follow us'
    ];

    let endIdx = text.length;
    for (const marker of endMarkers) {
      const idx = text.toLowerCase().indexOf(marker.toLowerCase());
      if (idx !== -1 && idx < endIdx) {
        endIdx = idx;
      }
    }

    text = text.substring(0, endIdx);

    return this.cleanText(text);
  }

  extractLocation(text) {
    const patterns = [
      /([A-Z][a-z]+,\\s*[A-Z]{2})/,
      /([A-Z][a-z]+,\\s*[A-Z][a-z]+)/,
      /Location:\\s*([A-Za-z][A-Za-z0-9 ,]+)/i,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1].length > 3 && m[1].length < 60) {
        return m[1].trim();
      }
    }

    return '';
  }

  extractPostDate(text) {
    const patterns = [
      /Posted:\\s*(\\d{1,2}\\s+\\w+\\s+\\d{4})/i,
      /Date Posted:\\s*(\\d{4}-\\d{2}-\\d{2})/,
      /Posted\\s+(\\d+\\s+days?\\s+ago)/i,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }

    return '';
  }

  extractJobType(text) {
    const patterns = [
      /Job Type:\\s*(Full-time|Part-time|Contract|Permanent|Internship)/i,
      /Employment:\\s*(Full-time|Part-time|Contract)/i,
      /(Full-time|Part-time)\\s*Position/i,
    ];

    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1].trim();
    }

    return '';
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
    const { maxItems = 1 } = options;

    const url = await browser.getCurrentUrl();

    // 获取完整文本用于 description
    let rawText = '';
    try {
      rawText = await browser.getMainContentText();
    } catch (e) {
      rawText = await browser.getCleanPageText();
    }

    const description = this.cleanDescription(rawText);

    // 获取页面标题
    const pageTitle = await browser.getTitle();
    const jobTitle = this.extractTitleFromPage(pageTitle, rawText);

    // 提取其他字段
    const location = this.extractLocation(rawText);
    const postDate = this.extractPostDate(rawText);
    const jobType = this.extractJobType(rawText);
    const salary = this.extractSalary(rawText);

    const jobData = this.createJobData({
      job_title: jobTitle,
      company_name: this.getCompanyName(),
      location: location,
      job_link: url,
      post_date: postDate,
      job_type: jobType,
      description: description,
      salary: salary,
      source: this.getCompanyName(),
    });

    return [jobData];
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
  }

  extractTitleFromPage(pageTitle) {
    const parts = pageTitle.split('|')[0].split('-')[0];
    const title = parts.trim();

    if (title.length > 5 && title.length < 100) {
      return title;
    }

    const m = rawText.match(/(?:Job Title|Position):\\s*([A-Za-z][A-Za-z0-9\\s]{5,60})/i);
    return m ? m[1].trim() : pageTitle;
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
    const m = text.match(/\\$[\\d,]+\\s*[-–to]\\s*\\$[\\d,k]+/i);
    return m ? m[0].trim() : '';
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
1. **翻页循环** - 必须实现 while 循环，检测快照中的翻页元素并点击
2. **URL收集** - 使用 \`this.collectJobLinks(browser, jobRefs)\` 收集所有职位URL
3. **逐页导航** - 使用 \`await browser.navigate(url)\` 进入详情页，**禁止** click+goBack
4. **自提description** - 用 \`browser.getMainContentText()\` 获取文本，编写 \`cleanDescription()\` 清理
5. **辅助方法** - 实现 extractLocation, extractPostDate, extractJobType 等
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
