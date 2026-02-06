/**
 * CSV 配置文件中的单行配置
 */
export interface LinkConfig {
  /** 页面类型: list(列表页) | detail(详情页) | auto(自动判断) */
  type: 'list' | 'detail' | 'auto';

  /** 目标 URL */
  url: string;

  /** 最大爬取职位数 */
  maxJobs: number;

  /** 自定义 prompt（可选） */
  prompt?: string;
}

/**
 * CSV 配置文件
 */
export type LinksConfig = LinkConfig[];

/**
 * 从 CSV 行解析 LinkConfig
 */
export function parseLinkConfigRow(row: string[]): LinkConfig {
  const [type, url, maxJobs, prompt] = row;

  return {
    type: (type || 'list').trim() as 'list' | 'detail',
    url: (url || '').trim(),
    maxJobs: parseInt(maxJobs || '10', 10),
    prompt: prompt?.trim() || undefined,
  };
}

/**
 * 验证 LinkConfig
 */
export function validateLinkConfig(config: LinkConfig): { valid: boolean; error?: string } {
  if (!config.url) {
    return { valid: false, error: 'URL 不能为空' };
  }

  try {
    new URL(config.url);
  } catch {
    return { valid: false, error: `无效的 URL: ${config.url}` };
  }

  if (config.type !== 'list' && config.type !== 'detail' && config.type !== 'auto') {
    return { valid: false, error: `无效的页面类型: ${config.type}，必须是 'list'、'detail' 或 'auto'` };
  }

  if (isNaN(config.maxJobs) || config.maxJobs < 1) {
    return { valid: false, error: `无效的 maxJobs: ${config.maxJobs}` };
  }

  return { valid: true };
}
