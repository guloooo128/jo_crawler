import { BrowserService } from './BrowserService.js';
import { LLMService } from './LLMService.js';

/**
 * JD 提取结果（JO 标准字段）
 */
export interface JDExtractionResult {
  job_title?: string;
  company_name?: string;
  location?: string;
  post_date?: string;
  dead_line?: string;
  job_type?: string;
  description?: string;
  salary?: string;
}

/**
 * JD 提取器
 * 使用多种策略提取完整的职位描述
 */
export class JDExtractor {
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  /**
   * 提取完整的 JD 信息
   */
  async extract(
    browser: BrowserService,
    snapshot?: string
  ): Promise<JDExtractionResult> {
    // 如果没有提供 snapshot，获取当前页面
    if (!snapshot) {
      const { tree } = await browser.getSnapshot({
        interactive: true,
        maxDepth: 5,
      });
      snapshot = tree;
    }

    // 使用 LLM 提取结构化数据
    try {
      const extracted = await this.llmService.extractJobDataFromSnapshot(
        snapshot,
        await browser.getCurrentUrl()
      );

      return {
        job_title: extracted.job_title || extracted.title,
        company_name: extracted.company_name || extracted.company,
        location: extracted.location,
        post_date: extracted.post_date,
        dead_line: extracted.dead_line,
        job_type: extracted.job_type,
        description: extracted.description,
        salary: extracted.salary,
      };
    } catch (error) {
      console.error('❌ LLM 提取失败，使用基础方法:', error);
      return this.extractBasic(snapshot);
    }
  }

  /**
   * 基础提取方法（回退方案）
   */
  private extractBasic(snapshot: string): JDExtractionResult {
    // 清理快照
    const cleaned = this.cleanSnapshot(snapshot);

    return {
      description: cleaned.substring(0, 5000),
    };
  }

  /**
   * 清理快照文本
   */
  private cleanSnapshot(snapshot: string): string {
    let cleaned = snapshot;

    // 移除 ref 标记
    cleaned = cleaned.replace(/\[ref=e\d+\]/g, '');

    // 移除按钮和导航项
    cleaned = cleaned.replace(/- button "[^"]*"/g, '');
    cleaned = cleaned.replace(/- link\s+"[^"]*"/g, '');

    // 清理多余空行
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');

    return cleaned.trim();
  }
}
