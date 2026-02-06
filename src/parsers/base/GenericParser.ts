import { BaseParser } from './BaseParser.js';
import type { BrowserService } from '../../services/BrowserService.js';
import type { JobData, ParseOptions, ParserMetadata } from '../../models/JobData.js';
import { LLMService } from '../../services/LLMService.js';

/**
 * 通用解析器
 * 使用 LLM 直接从快照提取数据
 * 作为没有专门解析器时的后备方案
 */
export class GenericParser extends BaseParser {
  metadata: ParserMetadata = {
    name: 'Generic',
    version: '1.0.0',
    domain: '*',
    author: 'System',
    createdAt: new Date(),
    description: '通用 LLM 解析器，适用于任何招聘网站',
  };

  private llmService: LLMService;

  constructor(llmService: LLMService) {
    super();
    this.llmService = llmService;
  }

  canParse(snapshot: string, url: string): boolean {
    // 通用解析器可以处理任何 URL
    return true;
  }

  async parse(browser: BrowserService, options: ParseOptions): Promise<JobData[]> {
    const jobs: JobData[] = [];
    const { maxItems = 1 } = options;

    console.log('🤖 使用通用 LLM 解析器...');

    // 获取当前页面快照
    const { tree } = await browser.getSnapshot({
      interactive: true,
      maxDepth: 5,
    });

    // 使用 LLM 提取数据
    const extractedData = await this.llmService.extractJobDataFromSnapshot(
      tree,
      await browser.getCurrentUrl()
    );

    // 构建 JobData
    const job = this.createJobData({
      title: extractedData.title || 'Unknown',
      company: extractedData.company || 'Unknown',
      location: extractedData.location || 'Unknown',
      description: extractedData.description || '',
      department: extractedData.department,
      salary: extractedData.salary,
      employmentType: extractedData.employmentType,
      url: await browser.getCurrentUrl(),
    });

    jobs.push(job);

    return jobs;
  }
}
