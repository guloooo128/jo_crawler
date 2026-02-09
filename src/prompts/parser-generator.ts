/**
 * Parser Generator Prompt
 *
 * 用于指导 LLM 生成针对具体网站的 JavaScript 解析器
 * 核心理念：每个网站生成专用解析器，而非依赖通用方法
 */

/**
 * ===== 第一部分：System Prompt =====
 */
export const COMMON_SYSTEM_PROMPT = `你是一个专业的前端数据提取专家。你需要根据页面快照（可访问性树）和 refs 信息，生成 **针对该具体网站结构** 的 JavaScript 解析器代码。

**核心理念（非常重要）：**

- 每个网站的 HTML 结构不同，**你必须根据快照中的实际元素和 refs 来编写导航和列表遍历逻辑**
- **不要依赖 BaseParser 的通用导航方法**（如 extractJobFromPage、findJobCardRefs、findTitleInRefs），它们使用通用正则，对大多数网站效果差
- 使用 \`browser.getText('@eXX')\` 直接从页面元素取值是最精确的方式
- **【重要】提取详情页数据时，先使用 \`this.extractDetailFields(browser)\`** — 它能自动提取 description、post_date、job_type、salary、location 等字段
- **【重要】extractDetailFields 不是万能的，你必须验证它的输出并在需要时自行处理：**
  - **description 始终自己提取**：不要使用 extractDetailFields 返回的 description（它经常因为过度清洗只剩几百字且含噪音），始终用 \`browser.getMainContentText()\` 获取完整文本，再用自定义 cleanDescription() 清理
  - 如果返回的 job_title 不是具体职位名（SPA 站点常返回频道名/品牌名），用列表页的 link.name 作为标题
  - 如果返回的 location 包含额外文本（如拼接了 "time type" "posted on" 等），自己清理截断
  - 如果返回的 post_date / dead_line 为空，尝试用你自己的正则从原始文本中提取
  - 如果返回的 salary 是误匹配内容，清空它
- 从快照的 link name 属性中直接解析出字段也是高效的做法
- **【列表页必须翻页】parse() 的外层必须是 while 翻页循环**（while (currentPage <= maxPages && allJobLinks.length < maxItems)），在循环内收集本页 URL，循环末尾尝试翻页（点击 Load More / Next 按钮 / 修改 URL 参数）。观察快照中是否有 "Load More"、"Show More"、"next"、"›"、"»" 或页码按钮，选择匹配的翻页方式。如果快照中没有明显翻页元素，也尝试用 URL 参数翻页（如 ?page=2 或 ?offset=20）
- **【禁止】不要使用 browser.getPageText() 来提取 description** — 它包含大量页面噪音

**代码规范：**

1. **必须使用 JavaScript ES6+ 语法**，不要使用 TypeScript
2. **必须继承 BaseParser 基类**（仅使用其 createJobData、delay、cleanText 工具方法）
3. **必须导出一个默认的类**
4. **必须自己编写提取逻辑**，根据快照中看到的实际页面结构

**⚠️ 异步编程规范：**

5. **所有 browser 方法调用都必须使用 await 关键字**
   - ✅ 正确: \`const url = await browser.getCurrentUrl();\`
   - ❌ 错误: \`const url = browser.getCurrentUrl();\`

6. **browser 异步方法列表**（都需要 await）:
   - \`await browser.getSnapshot({ interactive: true, maxDepth: 5 })\` → \`{ tree, refs }\`
   - \`await browser.getCurrentUrl()\`
   - \`await browser.click('@eXX')\` — 点击元素（仅用于按钮/分页，不要用于遍历列表）
   - \`await browser.goBack()\`
   - \`await browser.navigate(url)\` — **导航到 URL（列表页遍历时推荐用这个）**
   - \`await browser.waitForTimeout(ms)\`
   - \`await browser.getText('@eXX')\` — **获取指定元素的文本（最精确的取值方式）**
   - \`await browser.getAttribute('@eXX', 'href')\` — **获取元素属性（如链接的 URL）**
   - \`await browser.fill('@eXX', value)\`
   - \`await browser.getCleanPageText()\` — **获取去噪后的页面文本**
   - \`await browser.getMainContentText()\` — **获取主要内容区域文本**
   - \`await browser.getPageText()\` — 获取完整页面文本（不推荐用于 description）
   - \`await browser.getTitle()\` — **获取浏览器标签页标题**
   
   - \`await this.collectJobLinks(browser, jobRefEntries)\` — **收集所有职位链接 URL（列表页核心方法）**
   - \`await this.extractDetailFields(browser)\` — **提取详情页所有字段（详情页核心方法）**

7. **永远不要使用 this.url**，改用 \`await browser.getCurrentUrl()\`

8. **⚠️ this vs browser 严格区分：**
   - \`this.delay(ms)\` ✅ — 延迟（属于 BaseParser）
   - \`browser.delay(ms)\` ❌ — 不存在
   - \`this.createJobData(data)\` ✅ — 创建 JobData
   - \`this.collectJobLinks(browser, jobRefs)\` ✅ — 收集职位 URL（列表页）
   - \`this.extractDetailFields(browser)\` ✅ — 提取详情页字段（推荐）

9. **⚠️ 列表页遍历禁止使用 click+goBack 模式！**
   - ❌ \`browser.click(ref) → extract → browser.goBack()\`（ref 会失效）
   - ✅ \`this.collectJobLinks() → browser.navigate(url) → extract\`（稳定可靠）

---

## BaseParser 可用的工具方法

### ✅ 推荐使用的方法
- \`this.collectJobLinks(browser, jobRefEntries)\` — **【列表页核心】收集所有职位链接的 URL**
  - 参数: jobRefEntries 是 Object.entries(refs).filter(...) 的结果
  - 返回: \`Array<{ ref, name, url }>\`
  - 用法: \`const jobLinks = await this.collectJobLinks(browser, jobRefs);\`
- \`this.extractDetailFields(browser)\` — **【详情页核心】提取标准字段（需验证输出）**
  - 返回: \`{ description, post_date, dead_line, job_type, salary, location, job_title }\`
  - 内置去噪逻辑，但可能过度清洗或漏提取，**你必须检查并补充**
  - 常见问题：description 被截断、job_title 返回品牌名而非职位名、location 拼接噪音文本
  - 用法: \`const detail = await this.extractDetailFields(browser);\`
- \`this.createJobData(data)\` — 创建 JobData 对象，带默认值
- \`this.delay(ms)\` — 延迟执行
- \`this.cleanText(text)\` — 清理文本（去多余空白）
- \`this.getCompanyName()\` — 获取公司名称（可重写）

**⚠️ 不要使用以下方法（通用导航方法，对大多数网站效果差）：**
- ❌ this.extractJobFromPage()
- ❌ this.findJobCardRefs()
- ❌ this.findTitleInRefs()
- ❌ this.extractLocationFromTree()
- ❌ this.extractJobMetadata()

**✅ Description 兜底提取（当 extractDetailFields 返回的 description 过短时）：**
- \`await browser.getMainContentText()\` — 获取主要内容区域文本（推荐，优先选择 main/article 标签）
- \`await browser.getCleanPageText()\` — 获取去噪后的页面文本（次选）
- 获取后由你自己编写清理方法，去除页面头部噪音（标题重复、元数据行等）和尾部噪音（页脚、推荐职位等）

---

## BrowserService 方法

### 导航和快照
- \`navigate(url)\` — **导航到 URL（列表页遍历时推荐用这个，而不是 click）**
- \`getSnapshot({ interactive, maxDepth })\` → \`{ tree, refs }\`

### 元素操作
- \`getText('@eXX')\` — **获取指定 ref 元素的文本内容**
- \`getAttribute('@eXX', 'href')\` — **获取元素属性（如链接 URL）**
- \`click('@eXX')\` — 点击元素（仅用于按钮/分页，不要用于遍历列表）
- \`fill('@eXX', value)\` — 填写输入框

### 页面信息
- \`getCurrentUrl()\` — 获取当前 URL
- \`getCleanPageText()\` — **获取去噪后的页面文本（去除 script/style/nav/footer）**
- \`getMainContentText()\` — **获取主要内容区域的文本（最精准，优先选择 main/article）**
- \`getPageText()\` — 获取页面完整纯文本（包含噪音，不推荐用于 description）
- \`getTitle()\` — 获取浏览器标签页标题
- \`goBack()\` — 返回上一页
- \`waitForTimeout(ms)\` — 等待指定毫秒数

### Ref 管理（列表页跳转前必须保存）
- \`saveRefMap()\` — 保存当前的 refMap
- \`getSavedRefMap()\` — 获取保存的 refMap

---

## JobData 字段定义

\`\`\`javascript
{
  job_title: string,        // 职位标题（具体岗位名，不是页面标题或品牌名）
  company_name: string,     // 公司名称
  location: string,         // 工作地点（城市/地区）
  job_link: string,         // 职位详情链接 URL
  post_date: string,        // 发布日期
  dead_line: string,        // 申请截止日期（无则空串）
  job_type: string,         // Full-time/Part-time/Contract/Permanent/Internship
  description: string,      // 完整 JD 正文（不含导航/CSS/JS）
  salary: string,           // 薪资范围（无则空串）
  source: string,           // 来源网站名
  extracted_at: string      // ISO 时间戳
}
\`\`\`

---

## 返回格式

- 只返回纯 JavaScript 代码
- 不要包含 \\\`\\\`\\\`javascript 或 \\\`\\\`\\\` 标记
- 代码必须可直接保存为 .js 文件运行
- 添加详细注释
`;

/**
 * ===== 第二部分：自定义 Prompt 生成函数 =====
 * 针对每个 URL 生成特定的页面分析提示词
 */
export const generateCustomPrompt = (
  domain: string,
  snapshot: string,
  url: string,
  refMap: Record<string, any>,
  providedPageType?: 'list' | 'detail',
  detailSnapshot?: { tree: string; refs: Record<string, any>; url: string; rawText: string }
): string => {
  const analyzedType = analyzePageType(snapshot, url);
  const finalPageType = providedPageType || analyzedType.type;

  const jobCardAnalysis = analyzeJobCards(refMap, snapshot);
  const structureHints = analyzeStructure(snapshot, refMap);
  const meaningfulSnapshot = extractMeaningfulSnapshot(snapshot);

  // 生成详情页快照部分
  const detailSnapshotSection = detailSnapshot ? generateDetailSnapshotSection(detailSnapshot) : '';

  return `
**请根据以下页面分析，生成一个针对该网站的专用解析器。**

**域名:** ${domain}
**URL:** ${url}
**页面类型:** ${finalPageType}

**页面结构特点:**
${structureHints.map(hint => `- ${hint}`).join('\n')}

---

**页面快照（可访问性树）— 重点关注职位相关元素:**
\`\`\`
${meaningfulSnapshot}
\`\`\`

---

**关键 Ref 分析:**
${jobCardAnalysis}

---
${detailSnapshotSection}
**生成要求：**

${finalPageType === 'list' ? generateListPageInstructions(refMap, domain, url) : generateDetailPageInstructions(refMap, domain, url)}

**代码框架（请在此基础上编写具体提取逻辑）：**

\`\`\`javascript
import { BaseParser } from '../base/BaseParser.js';

export default class ${toClassName(domain)}Parser extends BaseParser {
  metadata = {
    name: '${toClassName(domain)}',
    version: '1.0.0',
    domain: '${domain}',
    url: '${url}',
    pageType: '${finalPageType}',
    author: 'AI',
    createdAt: new Date(),
    description: '${domain} ${finalPageType} 页面职位解析器',
  };

  // 重写公司名称
  getCompanyName() {
    return '${guessCompanyName(domain)}';
  }

  canParse(_snapshot, url) {
    return url.includes('${domain}');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10, maxPages = 5 } = options;

    console.log('🔍 使用 ${toClassName(domain)} 解析器...');

    try {
      // TODO: 根据快照中看到的实际页面结构，编写导航+翻页代码
      // 列表页流程：
      //   1. 外层 while 循环（页数 < maxPages 且 jobs < maxItems）
      //   2. 获取快照 → 过滤职位 refs → collectJobLinks 收集 URL
      //   3. for 循环: navigate(url) → extractDetailFields → cleanDescription
      //   4. 导航回列表页 → 翻页（点击 Load More / next 按钮 / 修改 URL 参数）
      // 详情页流程：直接 this.extractDetailFields(browser)
      // 禁止：click+goBack 遍历、getPageText 提取 description

    } catch (error) {
      console.error('❌ 解析失败:', error.message);
    }

    return jobs;
  }

  getDefaults() {
    return {
      maxItems: 10,
      maxPages: 5,
      followPagination: true,
      includeDetails: true,
    };
  }
}
\`\`\`

**⚠️ 关键提醒：**

1. **必须自己写导航逻辑** — 根据快照中的 refs 和元素结构来识别职位卡片、翻页按钮等
15. **【列表页必须实现翻页】parse() 方法必须包含翻页循环** — 在 while 循环中收集 URL，检查 maxPages 和 maxItems 限制，尝试3种翻页模式（Load More 按钮 / Next 按钮 / URL 参数），选择快照中实际存在的方式。不要把翻页当成可选功能
2. **不要调用 this.extractJobFromPage()** — 它是旧的通用方法
3. **不要调用 this.findJobCardRefs()** — 请根据快照自己识别哪些 ref 是职位卡片
4. **使用 browser.getText('@eXX') 精确取值** — 获取列表页中的具体字段
5. **【列表页核心】用 this.collectJobLinks() 收集 URL，再用 browser.navigate() 逐个访问**
6. **【详情页核心】先用 this.extractDetailFields(browser) 提取，再验证各字段质量**
7. **【列表页标题优先】合并数据时 job_title 优先用列表页的 link.name**（SPA 站点的浏览器标题可能不准确）
8. **【description 必须自己提取】不要使用 extractDetailFields 返回的 description**，始终调用 browser.getMainContentText() 获取原始文本，然后用 cleanDescription() 清理头尾噪音。extractDetailFields 的 description 经常被过度清洗（可能只剩 600 字符且包含导航噪音），不可靠。
9. **【字段验证】location 可能因 SPA 文本拼接而以残留字母开头（如 "locationsToronto" 被截取后变成 "sToronto"），cleanLocation 必须去除这种前缀。salary 字段容易误匹配页面其他含数字的文本，如果不是真正的薪资信息（如 $XX/hour 或 $XX,XXX - $YY,YYY）应清空**
10. **【禁止】不要用 click+goBack 遍历列表** — goBack 后 ref 会失效
11. **【禁止】不要用 browser.getPageText() 提取 description** — 包含大量噪音
12. **this.delay(ms) 延迟** — 不要用 browser.delay()
13. **⚠️ 变量名准确** — 不要使用未定义的变量
14. **⚠️ 严禁 this browser.xxx 语法** — 这是语法错误

请根据页面快照编写完整的导航+提取代码，确保能准确提取所有字段。
`;
};

/**
 * 生成列表页的具体指导
 */
function generateListPageInstructions(refMap: Record<string, any>, domain: string, url: string): string {
  // 找出可能的职位卡片 link
  const jobLinks = Object.entries(refMap)
    .filter(([_, info]) => info.role === 'link' && info.name && info.name.length > 40)
    .sort(([a], [b]) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

  let linkExample = '';
  if (jobLinks.length > 0) {
    const examples = jobLinks.slice(0, 3);
    linkExample = `
**示例 — 快照中的职位链接:**
${examples.map(([ref, info]) => `@${ref}: "${info.name}"`).join('\n')}

请分析这些 link name 的结构模式，推断出各字段的排列规律。
例如，如果多个 name 都是 "Title Country Location Level Type" 格式，你就可以用正则或字符串分割来提取各字段。
对于从 name 中无法可靠提取的字段（如 description），需要点击进入详情页获取。
`;
  }

  return `**列表页提取策略（URL 收集 + 逐页导航，避免 ref 失效）：**

**⚠️ 关键注意：不要使用 click+goBack 模式遍历职位！**
click 进入详情再 goBack 后，页面 DOM 会重建，原来的 ref ID 会指向错误的元素。
**必须使用下面的 URL 收集模式：**

**整体流程用一个 while 循环实现「收集 → 提取 → 翻页」：**

\`\`\`javascript
const listUrl = await browser.getCurrentUrl();
let allJobLinks = [];
let currentPage = 1;

// ===== 阶段一：翻页收集所有职位 URL =====
while (currentPage <= maxPages && allJobLinks.length < maxItems) {
  console.log(\`📄 第 \${currentPage} 页...\`);
  
  // 获取当前页快照
  const { tree, refs } = await browser.getSnapshot({ interactive: true, maxDepth: 5 });
  
  // 过滤出职位链接 refs（根据快照中的 link name 特征）
  const jobRefs = Object.entries(refs).filter(([key, ref]) => {
    // ... 根据快照分析编写过滤逻辑
    return true; // 替换为实际条件
  });
  
  // 收集本页的职位 URL
  const pageLinks = await this.collectJobLinks(browser, jobRefs);
  console.log(\`🔗 第 \${currentPage} 页找到 \${pageLinks.length} 个职位链接\`);
  
  // 合并（去重）
  const existingUrls = new Set(allJobLinks.map(l => l.url));
  const newLinks = pageLinks.filter(l => !existingUrls.has(l.url));
  allJobLinks.push(...newLinks);
  
  // 如果本页没有新链接，说明没有更多内容了
  if (newLinks.length === 0) {
    console.log('📭 没有新职位，停止翻页');
    break;
  }
  
  // 如果已够数量，停止翻页
  if (allJobLinks.length >= maxItems) break;
  
  // ===== 翻页逻辑（三种常见模式，根据快照选择一种）=====
  // 模式 A: "Load More" 按钮（SPA 站点常见）
  // const loadMoreRef = Object.entries(refs).find(([k, r]) => 
  //   r.role === 'button' && r.name && /load more|show more|更多/i.test(r.name)
  // );
  // if (loadMoreRef) {
  //   await browser.click('@' + loadMoreRef[0]);
  //   await this.delay(2000);
  //   currentPage++;
  //   continue;
  // }
  
  // 模式 B: "Next" / "下一页" / 箭头按钮
  // const nextBtn = Object.entries(refs).find(([k, r]) =>
  //   (r.role === 'link' || r.role === 'button') && 
  //   r.name && /next|下一页|›|»|arrow.?right/i.test(r.name)
  // );
  // if (nextBtn) {
  //   await browser.click('@' + nextBtn[0]);
  //   await this.delay(2000);
  //   currentPage++;
  //   continue;
  // }
  
  // 模式 C: URL 参数翻页（如 ?page=2 或 ?offset=20）
  // const nextPageUrl = listUrl.includes('page=')
  //   ? listUrl.replace(/page=\\d+/, 'page=' + (currentPage + 1))
  //   : listUrl + (listUrl.includes('?') ? '&' : '?') + 'page=' + (currentPage + 1);
  // await browser.navigate(nextPageUrl);
  // await this.delay(2000);
  // currentPage++;
  // continue;
  
  break; // 如果没有找到翻页方式，停止
}

console.log(\`✅ 共收集到 \${allJobLinks.length} 个职位链接\`);

// ===== 阶段二：逐个导航到详情页提取数据 =====
for (const link of allJobLinks.slice(0, maxItems)) {
  if (jobs.length >= maxItems) break;
  try {
    // 解析 link.name 中能得到的字段（title, location, type 等）
    const titleFromList = link.name; // 列表页标题通常最准确
    // ... 根据 link name 格式编写更多解析逻辑
    
    // 直接导航到详情页（不要用 click）
    await browser.navigate(link.url);
    await this.delay(2000);
    
    // 使用内置方法提取详情页字段
    const detail = await this.extractDetailFields(browser);
    
    // 【重要】description 始终自己从原始文本提取（extractDetailFields 的 description 不可靠）
    let rawText = '';
    try { rawText = await browser.getMainContentText(); } catch(e) {}
    if (!rawText || rawText.length < 200) {
      try { rawText = await browser.getCleanPageText(); } catch(e) {}
    }
    const description = this.cleanDescription(rawText, titleFromList);
    
    // 从原始文本中提取日期（extractDetailFields 可能提取不到）
    const dates = this.extractDatesFromRawText(rawText);
    
    const jobData = this.createJobData({
      job_title: titleFromList || detail.job_title,
      company_name: this.getCompanyName(),
      location: this.cleanLocation(detail.location) || locationFromList,
      job_link: link.url,
      post_date: detail.post_date || dates.post_date,
      dead_line: detail.dead_line || dates.dead_line,
      job_type: typeFromList || detail.job_type,
      description,
      salary: this.cleanSalary(detail.salary),
      source: this.getCompanyName(),
    });
    jobs.push(jobData);
  } catch (err) {
    console.error('提取失败:', err.message);
  }
}
\`\`\`

4. **⚠️ 禁止事项：**
   - **禁止用 browser.click() + browser.goBack() 遍历列表** — 会导致 ref 失效
   - **禁止用 browser.getPageText() 提取 description** — 噪音太多

5. **✅ 必须实现的辅助方法（根据该网站的特点编写）：**
   - \`cleanDescription(rawText, jobTitle)\` — 从 getMainContentText() 的连续字符串中提取正文。**不要用 split('\\n')**，而是用正则/indexOf 在连续文本中定位正文区域。典型策略：找到元数据段末尾（如 "job requisition id\\d+" 之后）作为正文起点，找到页脚标记（如 "Similar Jobs" 或 "CIBC.com"）作为终点
   - \`cleanLocation(rawLocation)\` — 验证并清理 location 字段。某些 SPA 站点的 location 可能以残留字母开头（如 "sToronto, ON" 来自截取 "locationsToronto, ON"），需去除开头的残留字母。同时截断可能拼接在后面的 "time type" "posted on" 等文本
   - \`cleanSalary(rawSalary)\` — 验证 salary 字段是否真正包含薪资信息（如 $XX/hour 或 $XX,XXX 格式），如果不包含则返回空字符串
   - \`extractDatesFromRawText(rawText)\` — 从原始连续文本中提取 post_date 和 dead_line（extractDetailFields 可能不识别 "Posted X Days Ago" "End Date: Month DD, YYYY" 等格式）。返回 { post_date, dead_line }
${linkExample}`;
}

/**
 * 生成详情页的具体指导
 */
function generateDetailPageInstructions(refMap: Record<string, any>, domain: string, url: string): string {
  return `**详情页提取策略：**

1. **【推荐方式】使用内置方法一键提取所有字段：**
   \`\`\`javascript
   const detail = await this.extractDetailFields(browser);
   const jobData = this.createJobData({
     ...detail,
     company_name: this.getCompanyName(),
     job_link: await browser.getCurrentUrl(),
     source: this.getCompanyName(),
   });
   \`\`\`
   extractDetailFields 会自动提取: description, post_date, dead_line, job_type, salary, location, job_title

2. **如果需要覆盖某些字段**（比如从快照中用 getText 获取更精确的标题）：
   \`\`\`javascript
   const detail = await this.extractDetailFields(browser);
   const title = await browser.getText('@eXX'); // 更精确的标题
   const jobData = this.createJobData({
     ...detail,
     job_title: title || detail.job_title,
     company_name: this.getCompanyName(),
     job_link: await browser.getCurrentUrl(),
     source: this.getCompanyName(),
   });
   \`\`\`

3. **description 必须自行从 getMainContentText() 提取并用 cleanDescription() 清理**，不要使用 extractDetailFields 返回的 description
4. 一次只提取一个职位`;
}

/**
 * 生成详情页快照部分的 prompt
 * 展示详情页的 accessibility tree（截取前部分）和原始页面文本样本
 */
function generateDetailSnapshotSection(detailSnapshot: { tree: string; refs: Record<string, any>; url: string; rawText: string }): string {
  const truncatedTree = detailSnapshot.tree.length > 3000
    ? detailSnapshot.tree.substring(0, 3000) + '\n... (截断)'
    : detailSnapshot.tree;

  // 原始文本截取前 2000 字符，让 LLM 看到真实的详情页文本结构
  const truncatedRawText = detailSnapshot.rawText.length > 2000
    ? detailSnapshot.rawText.substring(0, 2000) + '\n... (截断，完整文本约 ' + detailSnapshot.rawText.length + ' 字符)'
    : detailSnapshot.rawText;

  return `
**📄 详情页样本（第一个职位的详情页，供你了解详情页的真实结构）:**
**详情页 URL:** ${detailSnapshot.url}

**详情页可访问性树:**
\`\`\`
${truncatedTree}
\`\`\`

**详情页原始页面文本（browser.getMainContentText() 的实际返回值）:**
\`\`\`
${truncatedRawText}
\`\`\`

**⚠️ 重要：请仔细观察上面的详情页原始文本，注意：**
1. **原始文本通常是一个没有换行的连续字符串**，所有内容拼接在一起（不要用 split('\\n') 来分行解析！）
2. 文本开头有噪音（如 "Skip to main content"、"XXX page is loaded"、重复标题、"Apply" 按钮文字等）
3. location/time type/posted date 等元数据**无分隔符地拼接**在一起（如 "locationsToronto, ONtime typeFull timeposted onPosted 2 Days Ago"）
4. **你的 cleanDescription() 必须用正则/indexOf 在连续字符串中定位正文起止位置**，不要用 split 按行处理。例如用正则找到元数据拼接段（"locations...job requisition id\\d+"）的结尾位置作为正文开始，用 "Similar Jobs" 或其他标记作为正文结束
5. **你的 cleanLocation() 必须处理 "locations" 标签残留 — 比如 extractDetailFields 返回 "sToronto, ON"（来自 "locationsToronto, ON" 被截取），需去除开头的残留字母**
6. extractDetailFields 的 description 经过内置清洗后经常只剩几百字符且仍包含噪音，**不可使用**，必须自行从 getMainContentText() 提取并清理
7. 如果 extractDetailFields 返回的 salary 不符合薪资格式（如 $XX/hour 或 $XX,XXX-$YY,YYY），应清空为空字符串
8. 从原始文本中用正则提取 post_date（如 "Posted (\\d+ Days? Ago)"）和 dead_line（如 "End Date: (.*?)\\("）

---
`;
}

/**
 * 将域名转换为类名
 */
export function toClassName(domain: string): string {
  return domain
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * 从域名推断公司名称
 */
function guessCompanyName(domain: string): string {
  const knownCompanies: Record<string, string> = {
    'oraclecloud': 'JPMorgan Chase',
    'microsoft': 'Microsoft',
    'google': 'Google',
    'amazon': 'Amazon',
    'apple': 'Apple',
    'netflix': 'Netflix',
    'meta': 'Meta',
    'capgemini': 'Capgemini',
    'myworkdayjobs': 'TD Bank',
    'linkedin': 'LinkedIn',
  };

  for (const [key, name] of Object.entries(knownCompanies)) {
    if (domain.includes(key)) return name;
  }

  const parts = domain.split('.');
  for (const part of parts) {
    if (part !== 'www' && part !== 'com' && part !== 'org' && part !== 'net' && part.length > 2) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }
  }
  return 'Unknown';
}

/**
 * 分析页面类型
 */
function analyzePageType(snapshot: string, url: string): { type: 'list' | 'detail' } {
  const isDetail =
    url.includes('detail') ||
    url.includes('preview') ||
    /\/job\/\d+/.test(url) ||
    (url.includes('job/') && !url.endsWith('/jobs') && !url.includes('keyword=')) ||
    snapshot.includes('job description') ||
    snapshot.includes('responsibilities');

  return { type: isDetail ? 'detail' : 'list' };
}

/**
 * 分析职位卡片 refs
 */
function analyzeJobCards(refMap: Record<string, any>, snapshot: string): string {
  const longLinks = Object.entries(refMap)
    .filter(([_, info]) => info.role === 'link' && info.name && info.name.length > 40)
    .sort(([a], [b]) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

  if (longLinks.length === 0) {
    return '  (未找到长链接，可能是详情页或需要交互才能显示列表)';
  }

  const display = longLinks.slice(0, 5);
  const lines = display.map(([ref, info]) =>
    `  - @${ref} (${info.role}): "${info.name.substring(0, 120)}${info.name.length > 120 ? '...' : ''}"`
  );

  if (longLinks.length > 5) {
    lines.push(`  ... 共 ${longLinks.length} 个长链接`);
    const last = longLinks[longLinks.length - 1];
    lines.push(`  - @${last[0]} (${last[1].role}): "${last[1].name.substring(0, 120)}..."`);
  }

  // 分析 link name 的字段结构模式
  if (longLinks.length >= 2) {
    lines.push('');
    lines.push('  **Link name 结构分析：**');
    const names = longLinks.slice(0, 3).map(([_, info]) => info.name);
    lines.push(`  示例1: "${names[0]}"`);
    if (names[1]) lines.push(`  示例2: "${names[1]}"`);
    if (names[2]) lines.push(`  示例3: "${names[2]}"`);
    lines.push('  → 请根据这些示例推断 name 中各字段（title/country/location/level/type）的排列规律');
  }

  // 找出 heading 元素
  const headings = Object.entries(refMap)
    .filter(([_, info]) => info.role === 'heading' && info.name && info.name.length > 5);
  if (headings.length > 0) {
    lines.push('');
    lines.push('  **Heading 元素：**');
    headings.slice(0, 3).forEach(([ref, info]) => {
      lines.push(`  - @${ref}: "${info.name}"`);
    });
  }

  return lines.join('\n');
}

/**
 * 提取有意义的快照部分（过滤国家选择器、页脚等模板）
 */
function extractMeaningfulSnapshot(snapshot: string): string {
  const lines = snapshot.split('\n');
  const meaningful: string[] = [];
  let skipMode = false;

  for (const line of lines) {
    // 跳过国家/地区选择器列表
    if (line.includes('Select Country') || line.includes('site selection menu')) {
      skipMode = true;
      continue;
    }
    if (skipMode && (
      line.includes('Job Search') ||
      line.includes('Filter') ||
      line.includes('sort top') ||
      line.includes('heading')
    )) {
      skipMode = false;
    }
    if (line.match(/link "[\w\s]+ \| [A-Z]{2}"/)) {
      continue;
    }
    // 页脚之后的内容通常无用
    if (line.includes('Cookie Policy') || (line.includes('cookie') && line.includes('button'))) {
      break;
    }

    if (!skipMode) {
      meaningful.push(line);
    }
  }

  const result = meaningful.join('\n');
  if (result.length > 6000) {
    return result.substring(0, 6000) + '\n... (截断)';
  }
  return result;
}

/**
 * 分析页面结构
 */
function analyzeStructure(snapshot: string, refMap: Record<string, any>): string[] {
  const hints: string[] = [];

  const longLinks = Object.values(refMap).filter(
    (info) => info.role === 'link' && info.name && info.name.length > 40
  );

  if (longLinks.length > 3) {
    hints.push(`列表页，包含约 ${longLinks.length} 个职位链接`);
    const sampleName = longLinks[0].name;
    const words = sampleName.split(/\s+/);
    hints.push(`职位链接的 name 约含 ${words.length} 个单词，可能包含 title + country + location + level + type`);
  } else {
    hints.push('可能是详情页或职位较少的列表页');
  }

  if (snapshot.includes('description') || snapshot.includes('responsibilities')) {
    hints.push('页面包含职位描述区域');
  }
  if (snapshot.includes('apply') || snapshot.includes('Apply Now') || snapshot.includes('Apply')) {
    hints.push('页面包含申请按钮（可能是详情页）');
  }
  if (snapshot.includes('Load More') || snapshot.includes('next') || snapshot.includes('pagination')) {
    hints.push('页面可能有分页/加载更多功能');
  }

  // 检测具体的翻页元素
  const paginationRefs = Object.entries(refMap).filter(([_, info]) => {
    const name = (info.name || '').toLowerCase();
    return (info.role === 'button' || info.role === 'link') &&
      (/load more|show more|更多|next|下一页|›|»|page \d|previous/.test(name));
  });
  if (paginationRefs.length > 0) {
    const names = paginationRefs.map(([k, v]) => `@${k}: "${v.name}" (${v.role})`);
    hints.push(`⚡ 发现翻页元素: ${names.join(', ')} — 请在 while 循环末尾点击此元素实现翻页`);
  } else {
    hints.push('⚡ 快照中未发现明显翻页按钮，请尝试 URL 参数翻页（如 ?page=2 或 ?offset=20）或检查是否有隐藏的 Load More 按钮');
  }

  const hasSearch = Object.values(refMap).some(info =>
    info.role === 'textbox' && (info.name?.includes('Search') || info.name?.includes('search'))
  );
  if (hasSearch) hints.push('页面有搜索框');

  const hasFilter = Object.values(refMap).some(info =>
    info.role === 'combobox' || (info.role === 'button' && info.name?.includes('Filter'))
  );
  if (hasFilter) hints.push('页面有筛选功能');

  return hints;
}

// 保留旧的导出接口以兼容
export const PARSER_GENERATOR_SYSTEM = COMMON_SYSTEM_PROMPT;

export const PARSER_GENERATOR_USER = (
  domain: string,
  snapshot: string,
  url: string,
  refMap: Record<string, any>,
  pageType?: 'list' | 'detail',
  detailSnapshot?: { tree: string; refs: Record<string, any>; url: string; rawText: string }
): string => {
  return generateCustomPrompt(domain, snapshot, url, refMap, pageType, detailSnapshot);
};
