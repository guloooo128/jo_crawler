import type { BrowserService } from '../../services/BrowserService.js';
import type { JobData, ParseOptions, ParserMetadata } from '../../models/JobData.js';

/**
 * 解析器接口
 * 所有解析器必须实现此接口
 */
export interface Parser {
  /**
   * 解析器元数据
   */
  metadata: ParserMetadata;

  /**
   * 判断是否可以解析此页面
   * @param snapshot 页面快照
   * @param url 当前 URL
   * @returns 是否可以解析
   */
  canParse(snapshot: string, url: string): boolean | Promise<boolean>;

  /**
   * 解析页面，提取职位数据
   * @param browser 浏览器服务实例
   * @param options 解析选项
   * @returns 提取的职位数据列表
   */
  parse(browser: BrowserService, options: ParseOptions): Promise<JobData[]>;

  /**
   * 获取默认解析选项
   */
  getDefaults(): Partial<ParseOptions>;
}
