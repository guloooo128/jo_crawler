/**
 * LLMService - 向后兼容的门面（Facade）
 *
 * Phase 2 重构：原来 624 行的 God Service 已拆分为：
 * - LLMClient       → 纯 API 通信 + 重试
 * - CodePostProcessor → AST 验证 + 代码修复
 * - ParserPersistence → 文件 I/O
 *
 * LLMService 现在仅作为门面，保持旧接口不变，内部委托给新模块。
 * 新代码应直接使用拆分后的模块。
 */

import { LLMClient, type LLMMessage, type LLMClientConfig, type LLMCallResult } from './LLMClient.js';
import { CodePostProcessor } from './CodePostProcessor.js';
import { ParserPersistence, type ParserAssets } from './ParserPersistence.js';
import { PARSER_GENERATOR_SYSTEM, PARSER_GENERATOR_USER } from '../prompts/parser-generator.js';
import { JOB_LINK_IDENTIFIER_SYSTEM, JOB_LINK_IDENTIFIER_USER } from '../prompts/job-link-identifier.js';

// Re-export for backward compatibility
export type LLMServiceConfig = LLMClientConfig;
export type { LLMMessage };

export class LLMService {
  private client: LLMClient;

  constructor(config: LLMClientConfig) {
    this.client = new LLMClient(config);
  }

  /** 获取底层 LLMClient（新代码直接用这个） */
  getClient(): LLMClient {
    return this.client;
  }

  // ==========================================================================
  // 代码修复（@deprecated → 使用 CodePostProcessor.applyKnownFixes）
  // ==========================================================================

  /** @deprecated 使用 CodePostProcessor.applyKnownFixes() */
  static fixGeneratedCodeErrors(code: string): string {
    return CodePostProcessor.applyKnownFixes(code);
  }

  // ==========================================================================
  // LLM 调用（向后兼容委托）
  // ==========================================================================

  /**
   * 识别快照中的职位链接
   */
  async identifyJobLinks(
    snapshot: string,
    refs: Record<string, any>,
    customExcludeKeywords?: string[],
    customPrompt?: string,
  ): Promise<Array<{ ref: string; name: string; reason: string }>> {
    const messages: LLMMessage[] = [
      { role: 'system', content: JOB_LINK_IDENTIFIER_SYSTEM },
      { role: 'user', content: JOB_LINK_IDENTIFIER_USER(snapshot, refs, customExcludeKeywords, customPrompt) },
    ];

    try {
      return await this.client.callForJsonArray(messages);
    } catch (error) {
      console.error('❌ LLM 识别职位链接失败:', error);
      return [];
    }
  }

  /**
   * 分析页面类型（列表页 vs 详情页）
   */
  async analyzePageType(snapshot: string, url: string): Promise<'list' | 'detail' | 'unknown'> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: '你是一个专业的网页结构分析专家。请分析给定的页面快照，判断这是招聘网站的列表页还是详情页。',
      },
      {
        role: 'user',
        content: `URL: ${url}\n\n页面快照：\n${snapshot.substring(0, 3000)}\n\n请判断页面类型，只返回以下三个选项之一：\n1. list - 列表页\n2. detail - 详情页\n3. unknown - 无法确定\n\n只返回类型名称，不要其他解释。`,
      },
    ];

    const { content: response } = await this.client.call(messages);
    const type = response.toLowerCase().trim();

    if (type.includes('list')) return 'list';
    if (type.includes('detail')) return 'detail';
    return 'unknown';
  }

  /**
   * 生成解析器代码
   */
  async generateParser(
    domain: string,
    snapshot: string,
    url: string,
    refMap: Record<string, any>,
    customPrompt?: string,
    pageType?: 'list' | 'detail',
    detailSnapshot?: { tree: string; refs: Record<string, any>; url: string; rawText: string },
  ): Promise<{ code: string; usage: any; requestTime: number }> {
    let userContent = PARSER_GENERATOR_USER(domain, snapshot, url, refMap, pageType, detailSnapshot);

    if (customPrompt) {
      userContent += `\n\n**自定义要求：**\n${customPrompt}\n`;
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: PARSER_GENERATOR_SYSTEM },
      { role: 'user', content: userContent },
    ];

    const result = await this.client.callForCode(messages);

    return {
      code: result.content.trim(),
      usage: result.usage,
      requestTime: result.requestTime,
    };
  }

  /**
   * 生成解析器 + AST 验证 + 重试循环（Phase 2 新方法）
   */
  async generateParserWithRetry(
    domain: string,
    snapshot: string,
    url: string,
    refMap: Record<string, any>,
    customPrompt?: string,
    pageType?: 'list' | 'detail',
    detailSnapshot?: { tree: string; refs: Record<string, any>; url: string; rawText: string },
    maxRetries = 2,
  ): Promise<{ code: string; usage: any; requestTime: number; retries: number }> {
    let lastCode = '';
    let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let totalTime = 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let userContent = PARSER_GENERATOR_USER(domain, snapshot, url, refMap, pageType, detailSnapshot);

      if (customPrompt) {
        userContent += `\n\n**自定义要求：**\n${customPrompt}\n`;
      }

      const messages: LLMMessage[] = [
        { role: 'system', content: PARSER_GENERATOR_SYSTEM },
        { role: 'user', content: userContent },
      ];

      // 重试时追加上一轮的错误反馈
      if (attempt > 0 && lastCode) {
        const prevResult = CodePostProcessor.process(lastCode);
        const retryPrompt = CodePostProcessor.generateRetryPrompt(lastCode, prevResult);
        messages.push(
          { role: 'assistant', content: lastCode },
          { role: 'user', content: retryPrompt },
        );
        console.log(`🔄 重试第 ${attempt} 次（共 ${maxRetries} 次）...`);
      }

      const result = await this.client.callForCode(messages);
      lastCode = result.content.trim();
      totalUsage.prompt_tokens += result.usage.prompt_tokens;
      totalUsage.completion_tokens += result.usage.completion_tokens;
      totalUsage.total_tokens += result.usage.total_tokens;
      totalTime += result.requestTime;

      // 验证
      const validation = CodePostProcessor.process(lastCode);
      console.log(CodePostProcessor.formatReport(validation));

      if (validation.valid) {
        return {
          code: validation.fixedCode ?? lastCode,
          usage: totalUsage,
          requestTime: totalTime,
          retries: attempt,
        };
      }

      if (attempt === maxRetries) {
        console.warn(`⚠️  ${maxRetries} 次重试后仍有验证问题，返回最后版本`);
        return {
          code: validation.fixedCode ?? lastCode,
          usage: totalUsage,
          requestTime: totalTime,
          retries: attempt,
        };
      }
    }

    return { code: lastCode, usage: totalUsage, requestTime: totalTime, retries: maxRetries };
  }

  /**
   * 提取职位数据（使用 LLM 直接从快照提取）
   */
  async extractJobDataFromSnapshot(
    snapshot: string,
    url: string,
  ): Promise<Partial<Record<string, string>>> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个职位数据提取专家。你的任务是从页面快照中精确提取职位信息，返回 JSON。

**关键规则：**
1. 只提取页面中真实的职位信息，不要用导航文本、页脚文本、按钮文本充当字段值
2. 如果某个字段在页面中找不到，返回空字符串 ""，不要猜测
3. job_title 必须是具体的职位名称
4. location 必须是具体的城市/地区名
5. description 只包含职位描述正文`,
      },
      {
        role: 'user',
        content: `URL: ${url}\n\n页面快照：\n${snapshot.substring(0, 5000)}\n\n请精确提取以下字段，返回 JSON：\n\n{\n  "job_title": "职位标题",\n  "company_name": "公司名称",\n  "location": "工作地点",\n  "post_date": "发布日期",\n  "dead_line": "截止日期",\n  "job_type": "职位类型",\n  "salary": "薪资范围",\n  "description": "完整的职位描述正文"\n}\n\n**只返回 JSON，不要包含其他文字。**`,
      },
    ];

    try {
      const result = await this.client.callForJsonObject<Record<string, string>>(messages);
      return result ?? {};
    } catch (error) {
      console.error('❌ 解析 LLM 返回的 JSON 失败:', error);
      return {};
    }
  }

  // ==========================================================================
  // 文件 I/O（@deprecated → 使用 ParserPersistence）
  // ==========================================================================

  /** @deprecated 使用 ParserPersistence.saveParser() */
  async saveGeneratedParser(
    domain: string,
    code: string,
    outputDir: string,
    url?: string,
    pageType?: 'list' | 'detail' | 'auto',
  ): Promise<string> {
    return ParserPersistence.saveParser(domain, code, outputDir, url, pageType);
  }

  /** @deprecated 使用 ParserPersistence.saveParserWithAssets() */
  async saveGeneratedParserWithAssets(
    domain: string,
    code: string,
    outputDir: string,
    url?: string,
    pageType?: 'list' | 'detail' | 'auto',
    assets?: any,
  ): Promise<any> {
    return ParserPersistence.saveParserWithAssets(domain, code, outputDir, url, pageType, assets);
  }
}
