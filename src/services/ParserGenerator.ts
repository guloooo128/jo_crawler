import path from 'path';
import fs from 'fs-extra';
import { BrowserService } from './BrowserService.js';
import { LLMService } from './LLMService.js';
import { config } from '../utils/config.js';
import type { LinkConfig } from '../models/LinksConfig.js';
import { generateParserFilename } from '../utils/parserFilename.js';

/**
 * 解析器生成器
 * 使用 LLM 自动生成网站解析器
 */
export class ParserGenerator {
  private browser: BrowserService;
  private llm: LLMService;
  private outputDir: string;

  constructor(llmService: LLMService, outputDir?: string) {
    this.browser = new BrowserService();
    this.llm = llmService;
    this.outputDir = outputDir || config.paths.parsers;
  }

  /**
   * 为指定 URL 生成解析器
   */
  async generateForUrl(url: string): Promise<{
    domain: string;
    parserPath: string;
    success: boolean;
  }> {
    try {
      console.log(`\n🔍 正在分析: ${url}`);

      // 1. 导航到页面（使用带重试的导航方法）
      await this.browser.navigateWithRetry(url, 2);
      await this.browser.waitForTimeout(3000); // 等待页面加载

      // 2. 获取快照
      console.log('📸 获取页面快照...');
      const enhancedSnapshot = await this.browser.getSnapshot({
        interactive: true,
        maxDepth: 5,
      });

      const { tree, refs } = enhancedSnapshot;
      console.log(`✅ 快照获取成功 (${tree.length} 字符)`);

      // 3. 分析页面类型
      console.log('🔬 分析页面类型...');
      const pageType = await this.llm.analyzePageType(tree, url);
      console.log(`📊 页面类型: ${pageType}`);

      // 4. 提取域名
      const domain = this.extractDomain(url);
      console.log(`🌐 域名: ${domain}`);

      // 5. 生成解析器代码
      console.log('🤖 使用 LLM 生成解析器代码...');
      const generateResult = await this.llm.generateParser(
        domain,
        tree,
        url,
        refs,
        undefined // customPrompt
      );

      // 6. 保存解析器
      console.log('💾 保存解析器...');
      const parserPath = await this.llm.saveGeneratedParser(
        domain,
        generateResult.code,
        this.outputDir
      );

      // 7. 编译检查（如果有 TypeScript）
      await this.validateParserSyntax(parserPath);

      return {
        domain,
        parserPath,
        success: true,
      };
    } catch (error: any) {
      console.error(`❌ 生成解析器失败 (${url}):`, error.message);
      return {
        domain: this.extractDomain(url),
        parserPath: '',
        success: false,
      };
    }
  }

  /**
   * 批量生成解析器
   */
  async generateBatch(urls: string[]): Promise<{
    successful: number;
    failed: number;
    results: Array<{ url: string; domain: string; success: boolean }>;
  }> {
    console.log(`\n🚀 开始批量生成解析器 (${urls.length} 个 URL)\n`);

    let successful = 0;
    let failed = 0;
    const results: Array<{ url: string; domain: string; success: boolean }> = [];

    for (const url of urls) {
      const result = await this.generateForUrl(url);
      results.push({
        url,
        domain: result.domain,
        success: result.success,
      });

      if (result.success) {
        successful++;
      } else {
        failed++;
      }

      // 延迟，避免请求过快
      await this.delay(2000);
    }

    console.log(`\n✅ 生成完成: ${successful} 成功, ${failed} 失败\n`);

    return { successful, failed, results };
  }

  /**
   * 从文件读取 URL 并生成解析器
   */
  async generateFromFile(filepath: string): Promise<{
    successful: number;
    failed: number;
    results: Array<{ url: string; domain: string; success: boolean }>;
  }> {
    const content = await fs.readFile(filepath, 'utf-8');
    const urls = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    return await this.generateBatch(urls);
  }

  /**
   * 验证生成的解析器代码语法
   */
  private async validateParserSyntax(parserPath: string): Promise<void> {
    try {
      // 检查文件是否存在
      if (!(await fs.pathExists(parserPath))) {
        throw new Error(`解析器文件不存在: ${parserPath}`);
      }

      // 检查文件大小
      const stats = await fs.stat(parserPath);
      if (stats.size === 0) {
        throw new Error(`解析器文件为空: ${parserPath}`);
      }

      // 读取内容检查基本结构
      const content = await fs.readFile(parserPath, 'utf-8');

      // 检查必需的类和方法
      const hasClass = content.includes('class ') && content.includes('extends');
      const hasParseMethod = content.includes('async parse(');
      const hasCanParseMethod = content.includes('canParse(');
      const hasMetadata = content.includes('metadata');

      if (!hasClass) {
        console.warn('⚠️  警告: 生成的代码可能缺少类定义');
      }

      if (!hasParseMethod) {
        console.warn('⚠️  警告: 生成的代码可能缺少 parse 方法');
      }

      if (!hasCanParseMethod) {
        console.warn('⚠️  警告: 生成的代码可能缺少 canParse 方法');
      }

      if (!hasMetadata) {
        console.warn('⚠️  警告: 生成的代码可能缺少 metadata');
      }

      console.log('✅ 解析器代码语法验证通过');
    } catch (error: any) {
      console.error('❌ 解析器验证失败:', error.message);
      throw error;
    }
  }

  /**
   * 提取域名
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return 'unknown';
    }
  }

  /**
   * 延迟执行
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    await this.browser.close();
  }

  /**
   * 使用 LinkConfig 配置批量生成解析器
   */
  async generateBatchWithConfigs(
    configs: LinkConfig[]
  ): Promise<Array<{ config: LinkConfig; success: boolean; error?: string; skipped?: boolean }>> {
    await this.browser.launch({ headless: config.browser.headless });

    const results: Array<{ config: LinkConfig; success: boolean; error?: string; skipped?: boolean }> = [];

    // 获取已存在的解析器文件列表
    const existingParsers = await this.getExistingParsers();

    for (const linkConfig of configs) {
      try {
        // 检查是否已经存在解析器
        const { url, type: configType } = linkConfig;
        const domain = this.extractDomain(url);

        // 确定页面类型
        let pageType: 'list' | 'detail' = 'list';
        if (configType === 'auto' || !configType) {
          // 需要访问页面才能确定类型，暂时假设为 list
          pageType = 'list';
        } else {
          pageType = configType;
        }

        // 检查文件是否已存在
        const expectedFilename = generateParserFilename(domain, url, pageType) + '.js';
        const alreadyExists = existingParsers.includes(expectedFilename);

        if (alreadyExists) {
          console.log(`⏭️  跳过已存在的解析器: ${expectedFilename}`);
          results.push({
            config: linkConfig,
            success: true,
            skipped: true,
          });
          continue;
        }

        // 不存在，开始生成
        const result = await this.generateForUrlWithConfig(linkConfig);
        results.push({
          config: linkConfig,
          success: true,
          skipped: false,
        });
      } catch (error: any) {
        results.push({
          config: linkConfig,
          success: false,
          error: error.message,
        });
      }

      // 延迟，避免请求过快
      await this.delay(2000);
    }

    await this.browser.close();

    return results;
  }

  /**
   * 获取已存在的解析器文件列表
   */
  private async getExistingParsers(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.outputDir);
      return files
        .filter(file => file.endsWith('.js'))
        .sort();
    } catch {
      // 目录不存在或为空
      return [];
    }
  }

  /**
   * 使用 LinkConfig 为单个 URL 生成解析器
   */
  private async generateForUrlWithConfig(linkConfig: LinkConfig): Promise<void> {
    const { url, type: configType, prompt: customPrompt } = linkConfig;

    console.log(`\n🔍 正在分析: ${url}`);

    // 创建生成日志收集器
    const generationLog: string[] = [];
    const logStartTime = new Date().toISOString();

    const addLog = (message: string) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}`;
      generationLog.push(logEntry);
      console.log(message);
    };

    addLog(`开始生成解析器: ${url}`);

    // 1. 导航到页面（使用带重试的导航方法）
    addLog('🌐 导航到页面...');
    await this.browser.navigateWithRetry(url, 2);
    await this.browser.waitForTimeout(3000);

    // 2. 获取快照
    addLog('📸 获取页面快照...');
    const enhancedSnapshot = await this.browser.getSnapshot({
      interactive: true,
      maxDepth: 5,
    });

    const { tree, refs } = enhancedSnapshot;
    addLog(`✅ 快照获取成功 (${tree.length} 字符, ${Object.keys(refs).length} 个 refs)`);

    // 3. 截图
    addLog('📷 获取页面截图...');
    let screenshotPath: string | undefined;
    try {
      screenshotPath = await this.browser.takeScreenshot();
      if (screenshotPath) {
        addLog(`✅ 截图已保存: ${screenshotPath}`);
      }
    } catch (error: any) {
      addLog(`⚠️  截图失败: ${error.message}`);
    }

    // 4. 确定页面类型
    let pageType: 'list' | 'detail';

    if (configType === 'list' || configType === 'detail') {
      pageType = configType;
      addLog(`📊 页面类型: ${pageType} (CSV配置)`);
    } else {
      addLog('🔬 分析页面类型...');
      const analyzedType = await this.llm.analyzePageType(tree, url);
      pageType = analyzedType === 'unknown' ? 'list' : analyzedType;
      addLog(`📊 页面类型: ${pageType} (LLM分析)`);
    }

    // 5. 提取域名
    const domain = this.extractDomain(url);
    addLog(`🌐 域名: ${domain}`);

    // 6. 生成解析器代码
    addLog('🤖 使用 LLM 生成解析器代码...');
    if (customPrompt) {
      addLog(`📝 自定义提示词: ${customPrompt.substring(0, 50)}...`);
    }

    const generateResult = await this.llm.generateParser(
      domain,
      tree,
      url,
      refs,
      customPrompt,
      pageType  // ✅ Pass pageType to LLM generation
    );

    addLog(`✅ 解析器代码生成成功 (${generateResult.code.length} 字符)`);
    addLog(`📊 Token 使用: ${generateResult.usage.prompt_tokens} + ${generateResult.usage.completion_tokens} = ${generateResult.usage.total_tokens}`);
    addLog(`⏱️  请求耗时: ${generateResult.requestTime}ms`);

    // 7. 保存解析器及其相关文件（快照、截图、日志）
    addLog('💾 保存解析器及相关文件...');

    let result: any;
    try {
      result = await this.llm.saveGeneratedParserWithAssets(
        domain,
        generateResult.code,
        this.outputDir,
        url,
        pageType,
        {
          snapshot: { tree, refs },
          screenshotPath,
          generationLog,
          logStartTime,
          customPrompt,
          configType,
          llmUsage: generateResult.usage,
          requestTime: generateResult.requestTime
        }
      );

      addLog(`✅ 解析器已保存到: ${result.parserPath}`);
      if (result.generatedParserPath) {
        addLog(`✅ 已复制到: ${result.generatedParserPath}`);
      }
      if (result.snapshotPath) {
        addLog(`✅ 快照已保存: ${result.snapshotPath}`);
      }
      if (result.screenshotPath) {
        addLog(`✅ 截图已保存: ${result.screenshotPath}`);
      }
      if (result.logPath) {
        addLog(`✅ 生成日志已保存: ${result.logPath}`);
      }
      if (result.readmePath) {
        addLog(`✅ README 已保存: ${result.readmePath}`);
      }
    } catch (error: any) {
      addLog(`❌ 保存失败: ${error.message}`);
      addLog(`堆栈: ${error.stack}`);
      throw error;
    }

    // 8. 编译检查
    addLog('🔍 验证解析器语法...');
    await this.validateParserSyntax(result.parserPath);
    addLog('✅ 解析器语法验证通过');

    const logEndTime = new Date().toISOString();
    addLog(`✅ 生成完成 (耗时: ${new Date(logEndTime).getTime() - new Date(logStartTime).getTime()}ms)`);
  }
}
