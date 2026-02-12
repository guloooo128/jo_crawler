/**
 * DetailExtractor — 详情页提取模块
 *
 * 从 BaseParser 中提取的详情页数据提取逻辑。
 * 统一了 JDExtractor、BaseParser.extractDetailFields()、BaseParser.extractJobFromPage() 的功能。
 */

import type { BrowserService } from '../../services/BrowserService.js';
import { TextCleaner } from './TextCleaner.js';
import { FieldParser } from './FieldParser.js';

/**
 * 详情页提取结果
 */
export interface DetailFields {
  description: string;
  post_date: string;
  dead_line: string;
  job_type: string;
  salary: string;
  location: string;
  job_title: string;
}

/**
 * 详情页提取配置
 */
export interface DetailExtractorOptions {
  /** 等待页面加载的时间（ms），默认 1500 */
  waitBeforeExtract?: number;
  /** 描述清洗配置 */
  descriptionOptions?: {
    startMarkers?: string[];
    endMarkers?: string[];
    maxLength?: number;
  };
  /** 默认公司名 */
  defaultCompany?: string;
  /** 是否从 tree/refs 提取标题 */
  extractTitle?: boolean;
}

export class DetailExtractor {
  /**
   * 从当前页面提取详情页全部标准字段
   *
   * 这是生成的解析器在进入详情页后提取数据的推荐方式。
   * 自动提取 description、post_date、job_type、salary、location 等字段。
   *
   * 使用示例：
   * ```
   *   await browser.navigate(link.url);
   *   await delay(2000);
   *   const detail = await DetailExtractor.extract(browser);
   *   const job = createJobData({
   *     job_title: titleFromList,
   *     company_name: 'MyCompany',
   *     job_link: link.url,
   *     ...detail,
   *   });
   * ```
   */
  static async extract(
    browser: BrowserService,
    options?: DetailExtractorOptions,
  ): Promise<DetailFields> {
    // 等待 SPA 内容加载
    if (options?.waitBeforeExtract) {
      await new Promise(resolve => setTimeout(resolve, options.waitBeforeExtract));
    }

    let cleanText = '';

    // 1. 尝试获取主要内容区域文本（最精准）
    try {
      const mainText = await browser.getMainContentText();
      if (mainText && mainText.length > 200) {
        cleanText = mainText;
      }
    } catch { /* ignore */ }

    // 2. 回退到清洁的页面文本
    if (!cleanText) {
      try {
        cleanText = await browser.getCleanPageText();
      } catch {
        try {
          cleanText = await browser.getPageText();
        } catch {
          cleanText = '';
        }
      }
    }

    // 3. 获取 accessibility tree 用于元数据提取
    let tree = '';
    let refs: Record<string, any> = {};
    try {
      const snapshot = await browser.getSnapshot({ interactive: true, maxDepth: 5 });
      tree = snapshot.tree;
      refs = snapshot.refs;
    } catch { /* ignore */ }

    // 4. 从文本中提取结构化元数据
    const metadata = FieldParser.extractJobMetadata(tree, cleanText);

    // 5. 清理 description
    const description = TextCleaner.cleanDescription(cleanText, options?.descriptionOptions);

    // 6. 提取 location（多策略瀑布）
    const location = FieldParser.extractLocationAll(tree, description);

    // 7. 提取 job_title
    let jobTitle = '';
    if (options?.extractTitle !== false) {
      // 从 refs 中查找
      jobTitle = FieldParser.findJobTitleInRefs(refs, tree);

      // 回退到浏览器标题
      if (!jobTitle) {
        try {
          const pageTitle = await browser.getTitle();
          if (pageTitle) {
            jobTitle = FieldParser.extractTitleFromPageTitle(pageTitle);
          }
        } catch { /* ignore */ }
      }

      // 回退到 description
      if (!jobTitle) {
        jobTitle = FieldParser.extractTitleFromDescription(description);
      }
    }

    return {
      description,
      post_date: metadata.postDate,
      dead_line: metadata.deadLine,
      job_type: metadata.jobType,
      salary: metadata.salary,
      location,
      job_title: jobTitle,
    };
  }

  /**
   * 从当前页面提取完整 JD 描述（多种策略）
   */
  static async extractFullDescription(
    browser: BrowserService,
    tree: string,
    refs: Record<string, any>,
  ): Promise<string> {
    try {
      // 方法1: 获取页面的完整文本内容
      const pageText = await browser.getPageText();
      if (pageText && pageText.length > 200) {
        return TextCleaner.cleanPageText(pageText);
      }
    } catch {
      // ignore
    }

    // 方法2: 从 tree 中提取段落
    const sections = TextCleaner.extractJDSections(tree);
    if (sections.length > 0) {
      return sections.join('\n\n');
    }

    // 方法3: 返回清理后的 tree
    return TextCleaner.cleanTreeForDescription(tree);
  }
}
