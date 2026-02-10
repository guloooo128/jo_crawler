import crypto from 'crypto';
import type { JobData } from '../models/JobData.js';

/**
 * 已知站点的 URL ID 提取规则
 * 每个规则返回提取到的 ID 或 null
 */
const URL_ID_EXTRACTORS: Array<{
  name: string;
  pattern: RegExp;
  extract: (match: RegExpMatchArray, url: URL) => string | null;
}> = [
  {
    // Workday: .../{Slug}_{NumericID} 或 .../{Slug}_{NumericID-variant}
    name: 'workday',
    pattern: /\.myworkdayjobs\.com\//,
    extract: (_match, url) => {
      const pathMatch = url.pathname.match(/_(\d{5,}(?:-\d+)?)$/);
      return pathMatch ? pathMatch[1] : null;
    },
  },
  {
    // Capgemini: /jobs/{NumericID}-{locale}/
    name: 'capgemini',
    pattern: /capgemini\.com\/jobs\//,
    extract: (_match, url) => {
      const pathMatch = url.pathname.match(/\/jobs\/(\d+)/);
      return pathMatch ? pathMatch[1] : null;
    },
  },
  {
    // Oracle Cloud (JPMC etc.): /job/{NumericID}
    name: 'oraclecloud',
    pattern: /\.oraclecloud\.com\//,
    extract: (_match, url) => {
      const pathMatch = url.pathname.match(/\/job\/(\d+)/);
      return pathMatch ? pathMatch[1] : null;
    },
  },
  {
    // Microsoft Careers: pid={NumericID}
    name: 'microsoft',
    pattern: /careers\.microsoft\.com/,
    extract: (_match, url) => {
      return url.searchParams.get('pid');
    },
  },
  {
    // CBRE: /job/{NumericID}
    name: 'cbre',
    pattern: /careers\.cbre\.com/,
    extract: (_match, url) => {
      const pathMatch = url.pathname.match(/\/job\/(\d+)/);
      return pathMatch ? pathMatch[1] : null;
    },
  },
  {
    // Generic: URL path 末尾的纯数字 ID（至少 4 位）
    name: 'generic-path-id',
    pattern: /.*/,
    extract: (_match, url) => {
      const pathMatch = url.pathname.match(/\/(\d{4,})\/?$/);
      return pathMatch ? pathMatch[1] : null;
    },
  },
];

/**
 * 从 job_link URL 中提取原生 job ID
 * @returns 提取到的 ID 或 null
 */
function extractIdFromUrl(jobLink: string): string | null {
  if (!jobLink) return null;

  try {
    const url = new URL(jobLink);

    for (const extractor of URL_ID_EXTRACTORS) {
      const match = jobLink.match(extractor.pattern);
      if (match) {
        const id = extractor.extract(match, url);
        if (id) return id;
      }
    }
  } catch {
    // URL 解析失败，返回 null
  }

  return null;
}

/**
 * 生成 MD5 哈希的前 16 位
 */
function md5Short(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex').substring(0, 16);
}

/**
 * 为 JobData 生成唯一的 job_id
 *
 * 策略：
 * 1. 优先从 job_link URL 提取原生 ID（按站点模式匹配）
 * 2. 提取不到则取 job_link 的 MD5 前 16 位
 * 3. job_link 为空时，用 company_name + job_title + location 的 MD5 前 16 位兜底
 */
export function generateJobId(job: Partial<JobData>): string {
  // 1. 尝试从 URL 提取原生 ID
  if (job.job_link) {
    const nativeId = extractIdFromUrl(job.job_link);
    if (nativeId) return nativeId;

    // 2. 回退：URL 的 MD5 哈希
    return md5Short(job.job_link);
  }

  // 3. 兜底：组合字段的 MD5 哈希
  const composite = [
    job.company_name || '',
    job.job_title || '',
    job.location || '',
  ].join('|');

  return md5Short(composite);
}
