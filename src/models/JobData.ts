/**
 * 职位数据模型（JO 标准字段）
 */
export interface JobData {
  company_name: string;       // 公司名称
  job_title: string;          // 职位标题
  location: string;           // 工作地点
  job_link: string;           // 职位详情链接
  post_date: string;          // 发布日期（如 "2026-01-22"）
  dead_line: string;          // 截止日期（如 "2026-03-01"，无则为空）
  job_type: string;           // 职位类型（Full-time/Part-time/Intern/Contract 等）
  description: string;        // 职位描述（完整 JD）
  salary: string;             // 薪资范围（无则为空）
  source?: string;            // 来源网站
  extracted_at?: string;      // 提取时间戳 ISO 字符串
}

/**
 * 解析选项
 */
export interface ParseOptions {
  maxItems?: number;          // 最大提取职位数量
  maxPages?: number;          // 最大翻页数
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
