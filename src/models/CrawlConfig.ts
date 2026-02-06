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
}
