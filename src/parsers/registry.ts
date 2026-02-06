import path from 'path';
import fs from 'fs-extra';
import type { Parser } from './base/Parser.js';
import type { BrowserService } from '../services/BrowserService.js';
import type { ParseOptions, JobData } from '../models/JobData.js';
import { findMatchingParser, generateParserFilename, parseParserFilename } from '../utils/parserFilename.js';

/**
 * 解析器注册表
 * 管理所有解析器的加载、注册和选择
 */
export class ParserRegistry {
  private parsers: Map<string, Parser> = new Map();
  private parsersDir: string;

  constructor(parsersDir?: string) {
    this.parsersDir = parsersDir || path.join(process.cwd(), 'src/parsers/generated');
  }

  /**
   * 注册解析器
   */
  register(parser: Parser): void {
    // 使用 metadata.domain + pageType 作为唯一 key，支持同一域名多个解析器
    const pageType = parser.metadata.pageType || 'unknown';
    const key = `${parser.metadata.domain}::${pageType}`;

    this.parsers.set(key, parser);
    console.log(`✅ 已注册解析器: ${parser.metadata.name} (${parser.metadata.domain} - ${pageType})`);
  }

  /**
   * 批量注册解析器
   */
  registerAll(parsers: Parser[]): void {
    parsers.forEach(parser => this.register(parser));
  }

  /**
   * 获取解析器（按域名）
   */
  get(domain: string): Parser | undefined {
    return this.parsers.get(domain);
  }

  /**
   * 查找匹配的解析器（支持三段式命名）
   */
  findMatchingParser(snapshot: string, url: string, pageType?: 'list' | 'detail'): Parser | undefined {
    // 提取域名
    const domain = this.extractDomain(url);

    // 1. 精确域名匹配（旧格式，向后兼容）
    let parser = this.parsers.get(domain);
    if (parser) {
      return parser;
    }

    // 2. 通配符匹配（旧格式，向后兼容）
    for (const [parserDomain, parserInstance] of this.parsers.entries()) {
      if (parserDomain.startsWith('*.')) {
        const baseDomain = parserDomain.slice(2);
        if (domain === baseDomain || domain.endsWith('.' + baseDomain)) {
          return parserInstance;
        }
      }
    }

    // 3. 智能匹配：查找最符合域名、URL 和页面类型的解析器
    const matchingParsers: Array<{ parser: Parser; score: number }> = [];

    for (const parser of this.parsers.values()) {
      let score = 0;

      // 优先从 metadata.url 提取真实域名进行匹配
      if (parser.metadata.url) {
        try {
          const parserUrl = new URL(parser.metadata.url);
          const parserDomain = parserUrl.hostname;

          if (parserDomain === domain) {
            // 域名完全匹配
            score += 100;

            // 如果指定了页面类型，检查是否匹配
            if (pageType && parser.metadata.pageType) {
              if (parser.metadata.pageType === pageType) {
                // 页面类型也匹配，加分
                score += 50;
              } else {
                // 页面类型不匹配，减分
                score -= 30;
              }
            }
          }
        } catch {
          // URL 解析失败，忽略
        }
      }

      // 其次检查 metadata.domain（向后兼容旧格式）
      if (score === 0 && parser.metadata.domain) {
        // 清理可能的类名格式，提取真实域名
        const parserDomainFromMeta = this.extractDomainFromMetadata(parser.metadata.domain);

        if (parserDomainFromMeta === domain) {
          score += 80;
        } else if (parser.metadata.domain.startsWith('*.')) {
          const baseDomain = parser.metadata.domain.slice(2);
          if (domain === baseDomain || domain.endsWith('.' + baseDomain)) {
            score += 70;
          }
        }
      }

      // 如果有匹配分数，加入候选列表
      if (score > 0) {
        matchingParsers.push({ parser, score });
      }
    }

    // 返回分数最高的解析器
    if (matchingParsers.length > 0) {
      matchingParsers.sort((a, b) => b.score - a.score);
      return matchingParsers[0].parser;
    }

    return undefined;
  }

  /**
   * 从 metadata.domain 提取真实域名
   * 处理类名格式（如 JpmcFaOraclecloudCom）和真实域名格式
   */
  private extractDomainFromMetadata(metadataDomain: string): string {
    // 如果包含点，可能是真实域名
    if (metadataDomain.includes('.')) {
      return metadataDomain;
    }

    // 如果是类名格式（驼峰命名），尝试转换
    // 例如: JpmcFaOraclecloudCom -> jpmc.fa.oraclecloud.com
    return metadataDomain
      .replace(/([a-z])([A-Z])/g, '$1.$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1.$2')
      .toLowerCase();
  }

  /**
   * 从文件动态加载解析器（支持三段式命名）
   */
  async loadParser(domain: string, url?: string, pageType?: 'list' | 'detail'): Promise<Parser | null> {
    try {
      // 获取所有已存在的解析器文件
      const files = await fs.readdir(this.parsersDir);
      const parserFiles = files.filter(file => file.endsWith('.js'));

      let targetFilename: string | null = null;

      if (url && pageType) {
        // 使用三段式命名精确匹配
        const expectedFilename = generateParserFilename(domain, url, pageType) + '.js';
        if (parserFiles.includes(expectedFilename)) {
          targetFilename = expectedFilename;
        }
      }

      // 如果没有精确匹配，尝试域名前缀匹配（向后兼容）
      if (!targetFilename) {
        const domainPrefix = domain.replace(/\*/g, '_').replace(/\./g, '-').toLowerCase();
        const matchingFiles = parserFiles.filter(file => file.startsWith(domainPrefix));

        if (matchingFiles.length > 0) {
          // 优先选择没有额外后缀的（旧格式）
          const simpleMatch = matchingFiles.find(f => f === `${domainPrefix}.js`);
          targetFilename = simpleMatch || matchingFiles[0];
        }
      }

      // 如果还是找不到，返回 null
      if (!targetFilename) {
        console.warn(`⚠️  解析器文件不存在: ${domain}${url ? ` (URL: ${url})` : ''}`);
        return null;
      }

      const filepath = path.join(this.parsersDir, targetFilename);

      // 动态导入
      const module = await import(filepath);
      const ParserClass = module.default;

      if (!ParserClass) {
        console.error(`❌ 解析器文件没有默认导出: ${filepath}`);
        return null;
      }

      // 实例化
      const parser = new ParserClass();

      // 注册到缓存
      this.register(parser);

      console.log(`✅ 已加载解析器: ${parser.metadata.name} (${targetFilename})`);
      return parser;
    } catch (error: any) {
      console.error(`❌ 加载解析器失败 (${domain}):`, error.message);
      return null;
    }
  }

  /**
   * 加载所有解析器
   */
  async loadAll(): Promise<void> {
    try {
      await fs.ensureDir(this.parsersDir);
      const files = await fs.readdir(this.parsersDir);

      for (const file of files) {
        if (!file.endsWith('.js')) continue;

        try {
          const filepath = path.join(this.parsersDir, file);
          const module = await import(filepath);
          const ParserClass = module.default;

          if (ParserClass) {
            const parser = new ParserClass();
            this.register(parser);
          }
        } catch (error: any) {
          console.error(`❌ 加载解析器失败 (${file}):`, error.message);
        }
      }

      console.log(`\n✅ 共加载 ${this.parsers.size} 个解析器`);
    } catch (error: any) {
      console.error('❌ 加载解析器目录失败:', error.message);
    }
  }

  /**
   * 获取所有已注册的解析器
   */
  getAll(): Parser[] {
    return Array.from(this.parsers.values());
  }

  /**
   * 获取解析器数量
   */
  get size(): number {
    return this.parsers.size;
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.parsers.clear();
  }

  /**
   * 提取域名
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return '';
    }
  }
}

// 创建全局注册表实例
export const globalRegistry = new ParserRegistry();
