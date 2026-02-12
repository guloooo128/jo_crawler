import path from 'path';
import fs from 'fs-extra';
import { BrowserService } from './BrowserService.js';
import { LLMService } from './LLMService.js';
import { CodePostProcessor } from './CodePostProcessor.js';
import { ParserPersistence } from './ParserPersistence.js';
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

      // 2. 等待页面内容加载（SPA 可能需要更长时间）
      console.log('⏳ 等待页面内容渲染...');
      await this.browser.waitForContent(15000, 3);

      // 3. 获取快照（带重试，处理 SPA 延迟渲染）
      console.log('📸 获取页面快照...');
      const enhancedSnapshot = await this.browser.getSnapshotWithRetry({
        interactive: true,
        maxDepth: 5,
      }, 5, 2000);

      const { tree, refs } = enhancedSnapshot;
      console.log(`✅ 快照获取成功 (${tree.length} 字符)`);

      // 4. 分析页面类型
      console.log('🔬 分析页面类型...');
      const pageType = await this.llm.analyzePageType(tree, url);
      console.log(`📊 页面类型: ${pageType}`);

      // 5. 提取域名
      const domain = this.extractDomain(url);
      console.log(`🌐 域名: ${domain}`);

      // 6. 生成解析器代码
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
   * 验证生成的解析器代码语法（使用 AST）
   */
  private async validateParserSyntax(parserPath: string): Promise<void> {
    try {
      if (!(await fs.pathExists(parserPath))) {
        throw new Error(`解析器文件不存在: ${parserPath}`);
      }

      const content = await fs.readFile(parserPath, 'utf-8');

      if (content.trim().length === 0) {
        throw new Error(`解析器文件为空: ${parserPath}`);
      }

      // 使用 CodePostProcessor 进行 AST + 结构验证
      const result = CodePostProcessor.process(content);
      console.log(CodePostProcessor.formatReport(result));

      if (!result.valid) {
        console.warn('⚠️  解析器有验证问题，但已保存');
      }
    } catch (error: any) {
      console.error('❌ 解析器验证失败:', error.message);
      throw error;
    }
  }

  /**
   * 获取详情页快照：使用 LLM 识别职位链接，导航过去获取快照和原始文本，再导航回来
   */
  private async captureDetailPageSnapshot(
    tree: string,
    refs: Record<string, any>,
    listUrl: string,
    customPrompt?: string,
    addLog?: (msg: string) => void
  ): Promise<{ tree: string; refs: Record<string, any>; url: string; rawText: string } | undefined> {
    const log = addLog || console.log;

    // 使用 LLM 识别职位链接
    log('🤖 使用 LLM 识别职位链接...');

    // 从自定义 prompt 中提取排除关键词（如果有）
    let excludeKeywords: string[] | undefined;
    if (customPrompt) {
      // 匹配 "排除 XXX" 或 "XXX 不是职位" 等模式
      const excludeMatches = customPrompt.match(/(?:排除|不是职位)[：:]\s*([^\n]+)/gi);
      if (excludeMatches) {
        excludeKeywords = excludeMatches.map(m => m.replace(/(?:排除|不是职位)[：:]\s*/i, '').trim());
      }
    }

    const identifiedLinks = await this.llm.identifyJobLinks(tree, refs, excludeKeywords, customPrompt);

    // 如果 LLM 识别不到，尝试使用 HTML 解析方法（支持 JavaScript 渲染的内容和 SPA 点击式卡片）
    if (identifiedLinks.length === 0) {
      log('⚠️  LLM 未识别到职位链接，尝试使用 HTML 解析方法...');
      try {
        const htmlLinks = await this.browser.getJobLinksFromHTML();
        log(`🔍 HTML 解析结果: 找到 ${htmlLinks.length} 个链接`);
        if (htmlLinks.length > 0) {
          log(`📋 前 3 个链接:`);
          htmlLinks.slice(0, 3).forEach((link, i) => {
            log(`   ${i + 1}. ${link.name} - ${link.url}`);
          });
        }

        if (htmlLinks.length > 0) {
          log(`✅ HTML 解析找到 ${htmlLinks.length} 个职位链接`);
          const firstLink = htmlLinks[0];
          const detailUrl = firstLink.url;

          // 判断是否是 SPA 点击式卡片（合成 URL 含 #card-）
          const isSpaCard = detailUrl.includes('#card-');

          if (isSpaCard) {
            // SPA 点击式卡片：通过文本定位并点击进入详情页
            log(`📄 SPA 点击式卡片: "${firstLink.name.substring(0, 60)}"`);
            log('🖱️  通过文本匹配点击第一个职位卡片...');

            try {
              const page = this.browser.getPage();
              // 找到包含该职位名的 <a> 元素并点击
              const titleSnippet = firstLink.name.substring(0, 40).replace(/['"]/g, '');
              const clicked = await page.evaluate((snippet) => {
                const links = document.querySelectorAll('a');
                for (const link of links) {
                  const text = (link.textContent || '').trim();
                  if (text.includes(snippet)) {
                    (link as HTMLElement).click();
                    return true;
                  }
                }
                return false;
              }, titleSnippet);

              if (!clicked) {
                log('⚠️  未能通过文本匹配找到并点击职位卡片');
                log('⚠️  无法获取职位链接，跳过详情页快照');
                return undefined;
              }

              log('✅ 已点击职位卡片，等待详情页加载...');
              await this.browser.waitForTimeout(3000);

              // 检查是否导航到了新 URL
              const currentUrl = await this.browser.getCurrentUrl();
              const navigatedToDetail = currentUrl !== listUrl;

              if (navigatedToDetail) {
                log(`🔗 已跳转到详情页: ${currentUrl}`);
              } else {
                log('ℹ️  URL 未变化，可能是弹窗/侧边栏式详情');
              }

              // 等待内容渲染
              await this.browser.waitForContent(8000, 3);

              // 获取详情页快照
              const detailSnapshot = await this.browser.getSnapshotWithRetry(
                { interactive: true, maxDepth: 5 },
                2, 1000
              );
              log(`✅ 详情页快照获取成功 (${detailSnapshot.tree.length} 字符, ${Object.keys(detailSnapshot.refs).length} 个 refs)`);

              // 获取原始文本
              let rawText = '';
              try {
                rawText = await this.browser.getMainContentText();
              } catch (e) {
                rawText = await this.browser.getCleanPageText();
              }
              log(`✅ 详情页原始文本获取成功 (${rawText.length} 字符)`);

              // 导航回列表页
              await this.browser.navigateWithRetry(listUrl, 1);
              log('↩️  已导航回列表页');

              return {
                tree: detailSnapshot.tree,
                refs: detailSnapshot.refs,
                url: navigatedToDetail ? currentUrl : detailUrl,
                rawText,
              };
            } catch (e: any) {
              log(`⚠️  SPA 点击式卡片处理失败: ${e.message}`);
              // 确保回到列表页
              try { await this.browser.navigateWithRetry(listUrl, 1); } catch {}
            }
          } else {
            // 传统链接：直接导航
            log(`📄 获取详情页快照: "${firstLink.name}"`);
            log(`🔗 详情页 URL: ${detailUrl}`);

            await this.browser.navigate(detailUrl);
            await this.browser.waitForContent(5000, 2);

            await this.browser.dismissCookieBanner();

            const detailSnapshot = await this.browser.getSnapshotWithRetry(
              { interactive: true, maxDepth: 5 },
              2, 1000
            );
            log(`✅ 详情页快照获取成功 (${detailSnapshot.tree.length} 字符, ${Object.keys(detailSnapshot.refs).length} 个 refs)`);

            let rawText = '';
            try {
              rawText = await this.browser.getMainContentText();
            } catch (e) {
              rawText = await this.browser.getCleanPageText();
            }
            log(`✅ 详情页原始文本获取成功 (${rawText.length} 字符)`);

            await this.browser.navigateWithRetry(listUrl, 1);
            log('↩️  已导航回列表页');

            return {
              tree: detailSnapshot.tree,
              refs: detailSnapshot.refs,
              url: detailUrl,
              rawText,
            };
          }
        }
      } catch (e: any) {
        log(`⚠️  HTML 解析方法失败: ${e.message}`);
        log(`⚠️  错误堆栈: ${e.stack}`);
      }

      log('⚠️  无法获取职位链接，跳过详情页快照');
      return undefined;
    }

    // 选择第一个识别出的职位链接
    const firstJobLink = identifiedLinks[0];
    log(`📄 获取详情页快照: "${firstJobLink.name.substring(0, 60)}..."`);
    log(`   理由: ${firstJobLink.reason}`);

    // 从 ref ID 中提取数字部分
    const refId = firstJobLink.ref.replace('@', '');

    // 获取链接 href
    let detailUrl: string | null = null;
    try {
      const href = await this.browser.getAttribute(firstJobLink.ref, 'href');
      if (href) {
        detailUrl = href.startsWith('http') ? href : new URL(href, listUrl).href;
      }
    } catch (e: any) {
      log(`⚠️  获取 href 失败: ${e.message}`);
    }

    if (!detailUrl) {
      log('⚠️  无法获取详情页 URL，跳过详情页快照');
      return undefined;
    }

    log(`🔗 详情页 URL: ${detailUrl}`);

    // 导航到详情页
    await this.browser.navigate(detailUrl);
    await this.browser.waitForContent(5000, 2);  // 从 10 秒减少到 5 秒

    // 获取详情页快照 - 减少重试
    const detailSnap = await this.browser.getSnapshotWithRetry({
      interactive: true,
      maxDepth: 5,
    }, 2, 1000);  // 从 3 次 2 秒 改为 2 次 1 秒

    // 获取详情页原始文本（用于展示详情页的真实文本结构）
    let rawText = '';
    try {
      rawText = await this.browser.getMainContentText();
    } catch (e) {
      try {
        rawText = await this.browser.getCleanPageText();
      } catch (e2) { /* ignore */ }
    }

    log(`✅ 详情页快照获取成功 (${detailSnap.tree.length} 字符, ${Object.keys(detailSnap.refs).length} 个 refs, rawText ${rawText.length} 字符)`);

    // 导航回列表页
    await this.browser.navigate(listUrl);
    await this.browser.waitForContent(5000, 2);  // 从 10 秒减少到 5 秒
    log('↩️  已导航回列表页');

    return {
      tree: detailSnap.tree,
      refs: detailSnap.refs,
      url: detailUrl,
      rawText,
    };
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
    configs: LinkConfig[],
    options?: { force?: boolean; cdpUrl?: string }
  ): Promise<Array<{ config: LinkConfig; success: boolean; error?: string; skipped?: boolean }>> {
    await this.browser.launch({ headless: config.browser.headless, cdpUrl: options?.cdpUrl });

    const results: Array<{ config: LinkConfig; success: boolean; error?: string; skipped?: boolean }> = [];
    const force = options?.force ?? false;

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

        // 检查文件是否已存在（--force 时跳过此检查）
        const expectedFilename = generateParserFilename(domain, url, pageType) + '.js';
        const alreadyExists = existingParsers.includes(expectedFilename);

        if (alreadyExists && !force) {
          console.log(`⏭️  跳过已存在的解析器: ${expectedFilename}`);
          results.push({
            config: linkConfig,
            success: true,
            skipped: true,
          });
          continue;
        }

        if (alreadyExists && force) {
          console.log(`🔄 强制重新生成: ${expectedFilename}`);
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

    // 2. 等待页面内容加载（SPA 可能需要更长时间）
    addLog('⏳ 等待页面内容渲染...');
    const contentLoaded = await this.browser.waitForContent(20000, 5);  // 增加到 20 秒，最小 5 个元素
    if (!contentLoaded) {
      addLog('⚠️  页面内容等待超时，尝试继续...');
    }

    // 2.5 滚动页面以触发懒加载内容
    addLog('📜 滚动页面触发懒加载...');
    await this.browser.scrollPage(3, 800);  // 3 次 800ms

    // 2.6 额外等待时间，让嵌入式内容完全渲染
    addLog('⏳ 等待嵌入式内容完全渲染...');
    await this.browser.waitForTimeout(3000);  // 3 秒

    // 3. 获取快照（带重试，处理 SPA 延迟渲染）
    addLog('📸 获取页面快照...');
    const enhancedSnapshot = await this.browser.getSnapshotWithRetry({
      interactive: true,
      maxDepth: 5,
    }, 3, 1500);  // 从 5 次 2 秒 改为 3 次 1.5 秒

    const { tree, refs } = enhancedSnapshot;
    addLog(`✅ 快照获取成功 (${tree.length} 字符, ${Object.keys(refs).length} 个 refs)`);

    // 3.5 稀疏快照检测 — 尝试获取页面文本作为补充
    let supplementaryPageText = '';
    const refCount = Object.keys(refs).length;
    const isSparseSnapshot = tree.length < 1000 || refCount < 25;

    if (isSparseSnapshot) {
      addLog(`⚠️  快照内容稀疏 (${tree.length} 字符, ${refCount} 个 refs)，可能是反爬/SPA 未完整渲染`);
      addLog('💡 建议使用 --cdp 9222 连接已打开的 Chrome 浏览器以绕过反爬检测');
      addLog('📄 尝试获取页面文本作为补充信息...');

      try {
        supplementaryPageText = await this.browser.getCleanPageText();
        if (supplementaryPageText.length > 200) {
          addLog(`✅ 获取到补充页面文本 (${supplementaryPageText.length} 字符)`);
        } else {
          supplementaryPageText = '';
          addLog('⚠️  补充页面文本也很少，页面可能被反爬拦截');
        }
      } catch (e: any) {
        addLog(`⚠️  获取补充页面文本失败: ${e.message}`);
      }
    }

    // 4. 截图
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

    // 5. 确定页面类型
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

    // 6. 提取域名
    const domain = this.extractDomain(url);
    addLog(`🌐 域名: ${domain}`);

    // 6.1 如果快照稀疏但有补充文本，将其追加到 customPrompt 中供 LLM 参考
    let enrichedCustomPrompt = customPrompt;
    if (supplementaryPageText && isSparseSnapshot) {
      const textPreview = supplementaryPageText.substring(0, 2000);
      const pageTextSection = `\n\n【补充信息 — 页面可见文本（因快照稀疏自动获取）】:\n${textPreview}`;
      enrichedCustomPrompt = (customPrompt || '') + pageTextSection;
      addLog('📎 已将页面文本作为补充信息附加到提示词中');
    }

    // 6.5 如果是列表页，获取第一个职位的详情页快照
    let detailSnapshot: { tree: string; refs: Record<string, any>; url: string; rawText: string } | undefined;
    if (pageType === 'list') {
      try {
        detailSnapshot = await this.captureDetailPageSnapshot(tree, refs, url, enrichedCustomPrompt, addLog);
      } catch (error: any) {
        addLog(`⚠️  获取详情页快照失败: ${error.message}`);
      }
    }

    // 7. 生成解析器代码（带重试循环）
    addLog('🤖 使用 LLM 生成解析器代码...');
    if (enrichedCustomPrompt) {
      addLog(`📝 自定义提示词: ${(customPrompt || '').substring(0, 50)}${customPrompt && customPrompt.length > 50 ? '...' : ''}`);
    }

    const generateResult = await this.llm.generateParserWithRetry(
      domain,
      tree,
      url,
      refs,
      enrichedCustomPrompt,
      pageType,
      detailSnapshot,
      2  // 最多重试 2 次
    );

    addLog(`✅ 解析器代码生成成功 (${generateResult.code.length} 字符, 重试 ${generateResult.retries} 次)`);
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
          detailSnapshot: detailSnapshot ? { tree: detailSnapshot.tree, refs: detailSnapshot.refs, url: detailSnapshot.url } : undefined,
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
