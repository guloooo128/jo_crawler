/**
 * 职位数据模型
 */
export interface JobData {
  title: string;              // 职位标题
  company: string;            // 公司名称
  location: string;           // 工作地点
  description: string;        // 职位描述
  requirements?: string[];    // 职位要求列表
  salary?: string;            // 薪资范围
  postedDate?: Date;          // 发布日期
  url: string;               // 职位详情链接
  department?: string;        // 部门
  employmentType?: string;    // 雇佣类型（全职、实习等）
  source?: string;           // 来源网站
  extractedAt: Date;         // 提取时间戳
}

/**
 * 解析选项
 */
export interface ParseOptions {
  maxItems?: number;          // 最大提取职位数量
  followPagination?: boolean; // 是否翻页
  includeDetails?: boolean;   // 是否进入详情页
  timeout?: number;          // 超时时间（毫秒）
}

/**
 * 解析器元数据
 */
export interface ParserMetadata {
  name: string;
  version: string;
  domain: string;            // 支持的域名（支持 *.example.com 格式）
  url?: string;              // 示例 URL（用于精确匹配）
  pageType?: 'list' | 'detail';  // 页面类型
  author?: string;           // 作者（AI 生成时为 'AI'）
  createdAt: Date;
  description?: string;
}
