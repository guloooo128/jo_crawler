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
  // 保留 glm 配置以向后兼容
  glm: {
    apiKey: getEnv('GLM_API_KEY'),
    apiUrl: getEnv('GLM_API_URL', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'),
    model: getEnv('GLM_MODEL', 'glm-4.7'),
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
    links: path.join(process.cwd(), 'links.txt'),
    linksCsv: path.join(process.cwd(), 'links.csv'),
  },
};
