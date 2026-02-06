/**
 * 解析器文件名生成工具
 * 解决相同域名但不同类型/公司的 URL 导致的解析器覆盖问题
 */

import crypto from 'crypto';

/**
 * 生成唯一的解析器文件名
 *
 * @param domain - 域名
 * @param url - 完整 URL
 * @param pageType - 页面类型 (list | detail | auto)
 * @returns 解析器文件名（不含扩展名）
 */
export function generateParserFilename(
  domain: string,
  url: string,
  pageType: 'list' | 'detail' | 'auto' = 'auto'
): string {
  // 1. 清理域名，移除特殊字符
  const cleanDomain = domain
    .replace(/\*/g, '_')   // 通配符替换为下划线
    .replace(/\./g, '-');  // 点替换为连字符

  // 2. 从 URL 提取关键路径信息（用于区分不同公司/部门）
  const urlSignature = extractUrlSignature(url);

  // 3. 组合：域名 + 页面类型 + URL 签名
  // 例如: jpmc-fa-oraclecloud-com-list-cx-1001
  const baseName = `${cleanDomain}-${pageType}-${urlSignature}`;

  // 4. 确保文件名合法且不太长
  return sanitizeFilename(baseName);
}

/**
 * 从 URL 提取签名信息
 * 用于区分相同域名下的不同公司/部门
 */
function extractUrlSignature(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const searchParams = urlObj.search;

    // 提取路径中的关键部分
    // 例如: /hcmUI/CandidateExperience/en/sites/CX_1001/jobs
    // 提取: CX_1001
    const pathParts = pathname.split('/').filter(p => p && p.length > 2);

    // 优先使用站点 ID 或路径关键字
    const siteIdMatch = pathname.match(/\/(CX_\d+|sites\/[^\/]+|job\/[^\/]+)/i);
    if (siteIdMatch) {
      return siteIdMatch[1]
        .replace(/\//g, '-')  // 移除斜杠
        .replace(/_/g, '-')   // 下划线转连字符
        .toLowerCase();
    }

    // 使用路径的最后两个部分
    if (pathParts.length >= 2) {
      const lastTwo = pathParts.slice(-2);
      return lastTwo
        .join('-')
        .replace(/_/g, '-')
        .substring(0, 30); // 限制长度
    }

    // 如果路径太简单，使用 URL 的哈希值（前 8 位）
    return crypto
      .createHash('md5')
      .update(url)
      .digest('hex')
      .substring(0, 8);
  } catch {
    // URL 解析失败，使用哈希值
    return crypto
      .createHash('md5')
      .update(url)
      .digest('hex')
      .substring(0, 8);
  }
}

/**
 * 清理文件名，确保合法且不太长
 */
function sanitizeFilename(name: string): string {
  let cleaned = name
    .replace(/[^a-zA-Z0-9-_]/g, '-')  // 移除非法字符
    .replace(/-+/g, '-')              // 多个连字符合并为一个
    .toLowerCase();

  // 限制长度（避免文件名过长）
  if (cleaned.length > 60) {
    cleaned = cleaned.substring(0, 60);
  }

  // 移除结尾的连字符
  cleaned = cleaned.replace(/-+$/, '');

  return cleaned;
}

/**
 * 生成解析器类名
 *
 * @param filename - 解析器文件名
 * @returns 类名（PascalCase）
 */
export function filenameToClassName(filename: string): string {
  return filename
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * 从已有的解析器文件名解析信息
 *
 * @param filename - 解析器文件名（不含扩展名）
 * @returns 解析后的信息
 */
export function parseParserFilename(filename: string): {
  domain?: string;
  pageType?: string;
  signature?: string;
} {
  const parts = filename.split('-');

  if (parts.length >= 3) {
    const pageType = parts[parts.length - 2]; // 倒数第二部分是类型
    const signature = parts[parts.length - 1]; // 最后部分是签名
    const domain = parts.slice(0, -2).join('.'); // 前面是域名

    return { domain, pageType, signature };
  }

  return {};
}

/**
 * 检查是否已经为某个 URL 生成过解析器
 *
 * @param existingParsers - 已存在的解析器文件名列表
 * @param domain - 域名
 * @param url - URL
 * @param pageType - 页面类型
 * @returns 是否已存在
 */
export function hasParserForUrl(
  existingParsers: string[],
  domain: string,
  url: string,
  pageType: 'list' | 'detail' | 'auto'
): boolean {
  const expectedFilename = generateParserFilename(domain, url, pageType) + '.js';
  return existingParsers.includes(expectedFilename);
}

/**
 * 为 URL 查找最匹配的现有解析器
 *
 * @param existingParsers - 已存在的解析器文件名列表
 * @param domain - 域名
 * @param url - URL
 * @returns 匹配的解析器文件名，如果没有返回 null
 */
export function findMatchingParser(
  existingParsers: string[],
  domain: string,
  url: string
): string | null {
  // 1. 精确匹配（相同域名、类型、签名）
  for (const type of ['list', 'detail', 'auto'] as const) {
    const expectedFilename = generateParserFilename(domain, url, type) + '.js';
    if (existingParsers.includes(expectedFilename)) {
      return expectedFilename;
    }
  }

  // 2. 域名匹配（忽略类型和签名）
  const domainPrefix = domain
    .replace(/\*/g, '_')
    .replace(/\./g, '-')
    .toLowerCase();

  const matchingParsers = existingParsers.filter(parser =>
    parser.startsWith(domainPrefix)
  );

  if (matchingParsers.length > 0) {
    // 返回最新的匹配解析器
    return matchingParsers[0];
  }

  return null;
}
