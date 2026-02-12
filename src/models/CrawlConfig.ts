/**
 * 爬虫配置
 */
export interface CrawlConfig {
  urls: string[];
  maxJobsPerSite?: number;
  maxPages?: number;
  concurrency?: number;
  output: {
    format: 'json' | 'csv';
    path: string;
    pretty?: boolean;
  };
  parser: {
    regenerate?: boolean;
    validate?: boolean;
    useCached?: boolean;
  };
  browser: {
    headless?: boolean;
    timeout?: number;
  };
}

/**
 * CLI 命令选项
 */
export interface GenerateOptions {
  domain?: string;
  validate?: boolean;
  force?: boolean;
  verbose?: boolean;
  /** CDP 端口或 URL，连接到已打开的 Chrome */
  cdp?: string;
}

export interface CrawlOptions {
  maxJobs?: number;
  maxPages?: number;
  concurrency?: number;
  output?: string;
  format?: 'json' | 'csv';
  input?: string;
  csv?: boolean;
  headless?: boolean;
  verbose?: boolean;
  /** CDP 端口或 URL，连接到已打开的 Chrome */
  cdp?: string;
}
