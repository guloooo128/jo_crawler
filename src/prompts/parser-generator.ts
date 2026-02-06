/**
 * Parser Generator Prompt
 *
 * 用于指导 GLM-4.7 生成 JavaScript 解析器的提示词模板
 */

/**
 * ===== 第一部分：通用 Prompt =====
 * 关于 BaseParser、BrowserService 等内部工具的使用说明
 */
export const COMMON_SYSTEM_PROMPT = `你是一个专业的前端数据提取专家。你需要生成 **JavaScript** 解析器代码来从招聘网站提取职位数据。

**核心要求：**

1. **必须使用 JavaScript ES6+ 语法**，不要使用 TypeScript
2. **必须继承 BaseParser 基类**
3. **必须导出一个默认的类**
4. **优先使用 BaseParser 和 BrowserService 的通用方法**，而不是重复造轮子

**⚠️ 异步编程规范（非常重要）：**

5. **所有 browser 方法调用都必须使用 await 关键字**
   - ✅ 正确: \`const url = await browser.getCurrentUrl();\`
   - ❌ 错误: \`const url = browser.getCurrentUrl();\`

6. **browser 异步方法列表**（都需要 await）:
   - \`await browser.getSnapshot(...)\`
   - \`await browser.getCurrentUrl()\` - **获取当前 URL 的唯一正确方式**
   - \`await browser.click(...)\`
   - \`await browser.goBack()\`
   - \`await browser.navigate(...)\`
   - \`await browser.waitForTimeout(...)\`
   - \`await browser.getText(...)\`
   - \`await browser.fill(...)\`

7. **永远不要使用 this.url**
   - ❌ 错误: \`this.url.includes('/jobs/')\`
   - ✅ 正确: \`const url = await browser.getCurrentUrl(); url.includes('/jobs/')\`

8. **⚠️ API 作用域严格区分（非常重要）：**
   - \`browser\` 是外部传入的浏览器服务实例
   - \`this\` 是解析器实例（继承自 BaseParser）
   - **延迟方法只能用 this.delay()**，不能用 browser.delay()
   - ❌ 错误: \`await this browser.delay(1000);\` 或 \`await browser.delay(1000);\`
   - ❌ 错误: \`await this.delay(1000);\` 放到 browser 方法调用链中
   - ✅ 正确: \`await this.delay(1000);\`（独立调用）
   - ✅ 正确: \`await browser.click('@e1'); await this.delay(500);\`（分开调用）

---

## BaseParser 可用方法（强烈推荐使用）

### 数据提取方法
- \`extractJobFromPage(browser, options)\` - **通用职位提取方法**
  - 智能提取标题、地点、描述
  - 支持自定义 options: { titleRef, locationRef, defaultCompany }

- \`findJobCardRefs(tree, refs)\` - **查找列表页的职位卡片 refs**
  - 返回职位卡片元素的 ref 数组
  - 自动过滤导航链接
  - **重要: 不要重写此方法，直接使用即可**

- \`findTitleInRefs(refs)\` - **智能查找标题**
  - 优先选择最长的 link
  - 自动排除导航关键词

- \`extractLocation(text)\` - **从文本提取地点**
  - 支持多种格式: "New York, NY", "New York - NY"

### 辅助方法
- \`createJobData(data)\` - 创建 JobData 对象，带默认值
- \`getCompanyName()\` - 获取公司名称（可重写）
- \`delay(ms)\` - 延迟执行

---

## BrowserService 可用方法

### 导航和快照
- \`navigate(url)\` - 导航到 URL
- \`getSnapshot({ interactive, maxDepth })\` - 获取快照，返回 \`{ tree, refs }\`
  - interactive: 只显示交互元素（默认 true）
  - maxDepth: 最大深度（默认 5）

### 元素操作
- \`getText('@e1')\` - 获取元素文本内容
- \`click('@e1')\` - 点击元素
- \`fill('@e1', value)\` - 填写输入框

### 页面信息
- \`getCurrentUrl()\` - 获取当前 URL
- \`getPageText()\` - 获取页面的完整文本内容
- \`goBack()\` - 返回上一页
- \`waitForTimeout(ms)\` - 等待指定毫秒数

### Ref 管理
- \`saveRefMap()\` - **保存当前的 refMap**（页面跳转后 refs 会失效）
- \`getSavedRefMap()\` - 获取保存的 refMap

**重要：** 在列表页点击职位卡片前，必须调用 \`browser.saveRefMap()\` 保存 refs！

---

## JobData 接口定义

\`\`\`javascript
{
  title: string;        // 职位标题
  company: string;      // 公司名称
  location: string;     // 工作地点
  description: string;  // 职位描述（JD）
  url: string;         // 职位链接
  source: string;      // 来源网站
  extractedAt: Date;   // 提取时间
}
\`\`\`

---

## 代码结构要求

1. **metadata** - 必须包含以下字段：
   - \`name\`: 解析器名称
   - \`version\`: 版本号
   - \`domain\`: 域名（用于匹配）
   - \`url\`: 示例 URL（用于精确匹配）
   - \`pageType\`: 页面类型 ('list' | 'detail')
   - \`author\`: 作者
   - \`description\`: 描述
2. **canParse(snapshot, url)** - 判断是否可以解析此页面
3. **parse(browser, options)** - 主解析方法，必须实现
   - 支持 \`maxItems\` 参数限制提取数量
   - 返回 JobData[] 数组
4. **getDefaults()** - 返回默认配置（可选）

---

## 返回格式要求

- 只返回纯 JavaScript 代码
- 不要包含 \`\`\`javascript 或 \`\`\` 标记
- 代码必须可以直接保存为 .js 文件并运行
- 添加详细注释说明每个步骤
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
  providedPageType?: 'list' | 'detail'  // ✅ 新增：外部传入的页面类型（优先使用）
): string => {
  // 分析页面类型（如果未提供）
  const analyzedType = analyzePageType(snapshot, url);
  const finalPageType = providedPageType || analyzedType.type;  // 优先使用外部传入的 pageType

  // 分析可用的 refs
  const refAnalysis = analyzeRefs(refMap);

  // 分析页面结构特点
  const structureHints = analyzeStructure(snapshot, refMap);

  return `
**当前网站分析：**

**域名:** ${domain}
**URL:** ${url}
**页面类型:** ${finalPageType}

**页面结构特点:**
${structureHints.map(hint => `- ${hint}`).join('\n')}

---

**页面快照（可访问性树）:**
\`\`\`
${snapshot.substring(0, 5000)}
\`\`\`

---

**可用的 Ref 引用:**
${refAnalysis}

---

**生成要求：**

1. **根据上述页面分析**，生成最适合当前网站结构的解析器代码
2. **页面类型判断:**
   - 如果是 ${finalPageType === 'list' ? '列表页' : '详情页'}，使用对应的提取策略
3. **关键 refs:**
   - 优先使用以下 refs 进行数据提取
4. **特殊处理:**
   - ${finalPageType === 'list' ? '列表页需要遍历职位卡片并点击进入详情页' : '详情页直接提取职位信息'}
5. **必须调用 browser.saveRefMap()** 在页面跳转前保存 refs

**代码框架：**

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
    description: '${domain} 职位解析器',
  };

  canParse(_snapshot, url) {
    return url.includes('${domain}');
  }

  async parse(browser, options) {
    const jobs = [];
    const { maxItems = 10 } = options;

    console.log('🔍 使用 ${toClassName(domain)} 解析器...');

    try {
      const { tree, refs } = await browser.getSnapshot({
        interactive: true,
        maxDepth: 4,
      });

      // 判断页面类型
      const isDetailPage = ${finalPageType === 'detail' ? 'true' : 'false'};

      if (isDetailPage) {
        // 详情页：使用基类方法提取
        const job = await this.extractJobFromPage(browser);
        if (job) {
          jobs.push(job);
        }
      } else {
        // 列表页：查找职位卡片
        const jobRefs = this.findJobCardRefs(tree, refs);
        console.log(\`找到 \${jobRefs.length} 个职位卡片\`);

        const limit = Math.min(jobRefs.length, maxItems);

        // 保存当前的 refMap，因为页面跳转后 refs 会失效
        await browser.saveRefMap();

        for (let i = 0; i < limit; i++) {
          const ref = jobRefs[i];

          try {
            console.log(\`  [\${i + 1}/\${limit}] 提取职位 \${ref}...\`);

            await browser.click(\`@\${ref}\`);
            // ⚠️ 注意：delay 方法属于 this（解析器实例），不属于 browser
            await this.delay(1500);

            const job = await this.extractJobFromPage(browser);
            if (job) {
              jobs.push(job);
            }

            await browser.goBack();
            // ⚠️ 注意：使用 this.delay()，不要使用 browser.delay()
            await this.delay(1000);
          } catch (error) {
            console.error(\`  ❌ 提取失败 (\${ref}):\`, error.message);
          }
        }
      }
    } catch (error) {
      console.error('❌ 解析失败:', error.message);
    }

    return jobs;
  }

  getDefaults() {
    return {
      maxItems: 10,
      followPagination: false,
      includeDetails: true,
    };
  }
}
\`\`\`

**重要提示:**

1. **不要重写 BaseParser 的方法** - 直接使用 \`this.findJobCardRefs()\`, \`this.extractJobFromPage()\` 等方法即可
2. **只需要重写必要的方法** - 主要是 \`parse()\` 方法，根据当前网站特点调整提取逻辑
3. **refs 参数格式** - \`refs\` 是一个对象 (Record<string, any>)，不是数组，不要使用 \`refs.filter()\`
4. **metadata.domain** - 使用真实的域名（如 'jpmc.fa.oraclecloud.com'），而不是类名格式
5. **⚠️ 变量命名必须准确** - 如果代码框架中定义了 \`const isDetailPage = ...\`，则后续必须使用 \`if (isDetailPage)\`，不能简写为 \`if (isDetail)\`
6. **⚠️ 保持代码框架的变量名** - 不要修改代码框架中已经定义好的变量名
7. **⚠️⚠️⚠️ 严格区分 this 和 browser 的方法：**
   - \`this.delay(ms)\` - ✅ 正确的延迟方法（属于 BaseParser）
   - \`browser.delay(ms)\` - ❌ 不存在此方法
   - \`this browser.delay(ms)\` - ❌ 语法错误，绝对不要这样写
   - 延迟必须独立调用：\`await this.delay(1000);\`
8. **⚠️⚠️⚠️ 严禁使用未定义的变量：**
   - 必须使用代码框架中已经定义的变量名
   - ❌ 错误示例: \`const jobRefs = this.findJobCardRefs(tree, refs);\` 然后 \`console.log(job.length);\` - job 未定义
   - ✅ 正确示例: \`console.log(jobRefs.length);\` - 使用已定义的变量名
   - 常见错误：将 jobRefs 误写为 job、jobs、ref、refs 等

请根据页面分析结果，优化上述代码框架，使其最适合当前网站的结构。
`;
};

/**
 * 辅助函数：将域名转换为类名
 */
export function toClassName(domain: string): string {
  return domain
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * 辅助函数：分析页面类型
 */
function analyzePageType(snapshot: string, url: string): {
  type: 'list' | 'detail';
  isDetailCheck: string;
} {
  const isDetail =
    url.includes('detail') ||
    url.includes('preview') ||
    /\/job\/\d+/.test(url) ||  // 匹配 /job/123456 格式
    (url.includes('job/') && !url.endsWith('/jobs') && !url.includes('keyword=')) ||  // /job/ 但不是 /jobs
    snapshot.includes('detail') ||
    snapshot.includes('job description') ||
    snapshot.includes('responsibilities');

  return {
    type: isDetail ? 'detail' : 'list',
    isDetailCheck: isDetail
      ? "tree.includes('detail') || tree.includes('preview')"
      : "!tree.includes('detail') && !tree.includes('preview')",
  };
}

/**
 * 辅助函数：分析 refs
 */
function analyzeRefs(refMap: Record<string, any>): string {
  const links = Object.entries(refMap)
    .filter(([_, info]) => info.role === 'link' && info.name && info.name.length > 30)
    .slice(0, 5)
    .map(([ref, info]) => `  - @${ref}: ${info.name.substring(0, 60)}...`)
    .join('\n');

  return links || '  (未找到长链接)';
}

/**
 * 辅助函数：分析页面结构
 */
function analyzeStructure(snapshot: string, refMap: Record<string, any>): string[] {
  const hints = [];

  // 检查是否有职位卡片
  const longLinks = Object.values(refMap).filter(
    (info) => info.role === 'link' && info.name && info.name.length > 50
  );

  if (longLinks.length > 5) {
    hints.push(`列表页包含约 ${longLinks.length} 个职位链接`);
  }

  // 检查是否有描述区域
  if (snapshot.includes('description') || snapshot.includes('responsibilities')) {
    hints.push('页面包含职位描述区域');
  }

  // 检查是否有应用按钮
  if (snapshot.includes('apply') || snapshot.includes('Apply Now')) {
    hints.push('页面包含申请按钮');
  }

  // 检查分页
  if (snapshot.includes('next') || snapshot.includes('page') || snapshot.includes('pagination')) {
    hints.push('页面可能有分页功能');
  }

  return hints;
}

// 保留旧的导出接口以兼容
export const PARSER_GENERATOR_SYSTEM = COMMON_SYSTEM_PROMPT;

export const PARSER_GENERATOR_USER = (
  domain: string,
  snapshot: string,
  url: string,
  refMap: Record<string, any>,
  pageType?: 'list' | 'detail'  // ✅ 新增：页面类型参数
): string => {
  return generateCustomPrompt(domain, snapshot, url, refMap, pageType);
};
