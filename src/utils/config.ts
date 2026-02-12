import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config();

/**
 * 获取环境变量
 */
export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined && defaultValue === undefined) {
    throw new Error(`环境变量 ${key} 未设置`);
  }
  return value || defaultValue || '';
}

/**
 * 配置对象
 */
export const config = {
  llm: {
    apiKey: getEnv('DOUBAO_API_KEY'),
    apiUrl: getEnv('DOUBAO_API_URL', 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'),
    model: getEnv('DOUBAO_MODEL', 'doubao-seed-1-6-251015'),
  },
  browser: {
    headless: getEnv('BROWSER_HEADLESS', 'true') === 'true',
    timeout: parseInt(getEnv('BROWSER_TIMEOUT', '30000')),
  },
  crawler: {
    maxJobsPerSite: parseInt(getEnv('MAX_JOBS_PER_SITE', '10')),
    concurrency: parseInt(getEnv('CONCURRENCY', '2')),
    outputFormat: getEnv('OUTPUT_FORMAT', 'json') as 'json' | 'csv',
    outputPath: getEnv('OUTPUT_PATH', 'output/jobs.json'),
  },
  paths: {
    parsers: path.join(process.cwd(), 'src/parsers/generated'),
    output: path.join(process.cwd(), 'output'),
    database: getEnv('DATABASE_PATH', path.join(process.cwd(), 'output', 'jobs.db')),
    links: path.join(process.cwd(), 'links.txt'),
    linksCsv: path.join(process.cwd(), 'links.csv'),
  },

  // ────────────────────────────────────────────
  // Phase 3: 中心化超时 / 重试 / 限制常量
  // ────────────────────────────────────────────

  /** 各类超时（ms） */
  timeouts: {
    /** 页面导航超时 */
    navigation: 60000,
    /** 等待页面内容出现 */
    contentWait: 15000,
    /** 快照稳定等待 */
    snapshotStability: 2000,
    /** SPA 额外渲染等待 */
    pageRender: 3000,
    /** 翻页 / 详情页加载后等待 */
    betweenPages: 2000,
    /** LLM API 请求超时 */
    llmRequest: 60000,
  },

  /** 各类重试次数 */
  retry: {
    /** 页面导航 */
    navigation: 2,
    /** 快照获取 */
    snapshot: 5,
    /** 快照重试间隔（ms） */
    snapshotInterval: 2000,
    /** LLM API 调用 */
    llmCall: 2,
    /** 解析器生成（AST 验证不通过则重试） */
    parserGeneration: 2,
  },

  /** 各类容量限制 */
  limits: {
    /** 快照截断长度 */
    snapshotMaxChars: 5000,
    /** LLM 最大返回 token */
    maxTokens: 8000,
    /** 滚动次数（触发懒加载） */
    scrollTimes: 3,
    /** 每次滚动等待（ms） */
    scrollWait: 800,
    /** 最小 ref 元素数（判断内容已加载） */
    minContentElements: 3,
  },

  /** 域名 → 公司名映射 */
  companyMap: {
    'oraclecloud.com': 'JPMorgan Chase',
    'microsoft.com': 'Microsoft',
    'google.com': 'Google',
    'amazon.com': 'Amazon',
    'apple.com': 'Apple',
    'capgemini.com': 'Capgemini',
    'cbre.com': 'CBRE',
    'cibc.com': 'CIBC',
    'td.com': 'TD Bank',
  } as Record<string, string>,
};
