import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs-extra';
import { BrowserService } from '../services/BrowserService.js';
import { LLMService } from '../services/LLMService.js';
import { DatabaseService } from '../services/DatabaseService.js';
import { ParserRegistry } from '../parsers/registry.js';
import { GenericParser } from '../parsers/base/GenericParser.js';
import { config } from '../utils/config.js';
import { loadLinksConfig } from '../utils/loadLinksCsv.js';
import type { CrawlOptions } from '../models/CrawlConfig.js';
import type { LinkConfig } from '../models/LinksConfig.js';
import type { JobData } from '../models/JobData.js';

/**
 * 爬取命令
 */
export function crawlCommand(): Command {
  const cmd = new Command('crawl');

  cmd
    .description('爬取职位数据（支持 links.txt 和 links.csv）')
    .option('-m, --max-jobs <number>', '每个站点最大爬取职位数', '10')
    .option('-p, --max-pages <number>', '最大翻页数', '1')
    .option('-c, --concurrency <number>', '并发数', '1')
    .option('-i, --input <path>', '输入文件路径（links.txt）', config.paths.links)
    .option('--csv', '使用 CSV 配置文件（links.csv）')
    .option('--db <path>', '数据库文件路径', config.paths.database)
    .option('--no-headless', '显示浏览器窗口')
    .option('-v, --verbose', '详细输出')
    .action(async (options: CrawlOptions) => {
      try {
        await runCrawl(options);
      } catch (error: any) {
        console.error(chalk.red('❌ 爬取失败:'), error.message);
        if (options.verbose) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * 执行爬取命令
 */
async function runCrawl(options: CrawlOptions) {
  console.log(chalk.bold.blue('\n🕷️  JO Crawler - 智能职位爬虫\n'));

  // 解析选项
  const maxJobs = parseInt(String(options.maxJobs || '10'), 10);
  const maxPages = parseInt(String(options.maxPages || '1'), 10);
  const concurrency = parseInt(String(options.concurrency || '1'), 10);
  const headless = options.headless !== false;
  const dbPath = (options as any).db || config.paths.database;

  console.log(chalk.gray('配置:'));
  console.log(chalk.gray(`  最大职位数: ${maxJobs}`));
  console.log(chalk.gray(`  最大翻页数: ${maxPages}`));
  console.log(chalk.gray(`  并发数: ${concurrency}`));
  console.log(chalk.gray(`  数据库: ${dbPath}`));
  console.log(chalk.gray(`  无头模式: ${headless}\n`));

  // 初始化数据库
  const db = new DatabaseService(dbPath);
  await db.init();

  const existingCount = db.getJobCount();
  if (existingCount > 0) {
    console.log(chalk.gray(`📊 数据库中已有 ${existingCount} 条记录\n`));
  }

  // 读取配置文件
  let linkConfigs: LinkConfig[] = [];

  if (options.csv) {
    // 从 CSV 读取配置
    const csvPath = config.paths.linksCsv;
    if (!(await fs.pathExists(csvPath))) {
      console.error(chalk.red(`❌ CSV 文件不存在: ${csvPath}`));
      process.exit(1);
    }

    console.log(chalk.gray(`📄 使用 CSV 配置文件\n`));
    linkConfigs = await loadLinksConfig(csvPath);
  } else {
    // 从 TXT 读取 URL（向后兼容）
    const linksPath = options.input || config.paths.links;
    if (!(await fs.pathExists(linksPath))) {
      console.error(chalk.red(`❌ Links 文件不存在: ${linksPath}`));
      process.exit(1);
    }

    const content = await fs.readFile(linksPath, 'utf-8');
    const urls = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    // 转换为 LinkConfig 格式（默认为 list 类型）
    linkConfigs = urls.map(url => ({
      type: 'auto' as const,
      url,
      maxJobs: maxJobs,
    }));
  }

  if (linkConfigs.length === 0) {
    console.log(chalk.yellow('⚠️  没有找到可爬取的 URL'));
    db.close();
    return;
  }

  console.log(chalk.gray(`找到 ${linkConfigs.length} 个 URL\n`));

  // 初始化服务
  const llmService = new LLMService({
    apiKey: config.llm.apiKey,
    apiUrl: config.llm.apiUrl,
    model: config.llm.model,
  });

  const registry = new ParserRegistry(config.paths.parsers);
  const genericParser = new GenericParser(llmService);

  // 加载所有解析器
  console.log(chalk.yellow('📦 加载解析器...\n'));
  await registry.loadAll();

  // 爬取统计
  let totalExtracted = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

  const browser = new BrowserService(llmService);

  try {
    await browser.launch({ headless });

    for (let i = 0; i < linkConfigs.length; i++) {
      const linkConfig = linkConfigs[i];
      const { url, type: configType, maxJobs: configMaxJobs } = linkConfig;
      const actualMaxJobs = configMaxJobs || maxJobs;

      // 如果类型是 'auto'，则不传递 pageType（让系统自动判断）
      const pageType = configType === 'auto' ? undefined : configType;

      const spinner = ora(`[${i + 1}/${linkConfigs.length}] 爬取: ${url}`).start();

      try {
        // 导航到页面
        await browser.navigate(url);

        // 等待页面内容加载（SPA 可能需要更长时间）
        await browser.waitForContent(15000, 3);

        // 获取快照（带重试，处理 SPA 延迟渲染）
        const { tree } = await browser.getSnapshotWithRetry({
          interactive: true,
          maxDepth: 5,
        }, 5, 2000);

        // 查找匹配的解析器（传入 pageType 用于三段式命名匹配）
        let parser = registry.findMatchingParser(tree, url, pageType);

        if (!parser) {
          // 尝试动态加载（传入 pageType）
          const domain = extractDomain(url);
          const loadedParser = await registry.loadParser(domain, url, pageType);
          if (loadedParser) {
            parser = loadedParser;
          }
        }

        if (!parser) {
          // 使用通用解析器
          spinner.warn(`未找到专用解析器，使用通用解析器`);
          parser = genericParser;
        } else {
          spinner.succeed(`使用解析器: ${parser.metadata.name}`);
        }

        // 执行解析
        const jobs = await parser.parse(browser, {
          maxItems: actualMaxJobs,
          maxPages: maxPages,
          followPagination: maxPages > 1,
          includeDetails: true,
        });

        totalExtracted += jobs.length;

        // 去重：过滤已存在的职位
        const { newJobs, skippedCount } = db.filterNewJobs(jobs);
        totalSkipped += skippedCount;

        // 保存新职位到数据库
        const inserted = db.saveJobs(newJobs);
        totalInserted += inserted;

        if (skippedCount > 0) {
          spinner.succeed(`提取 ${jobs.length} 个职位 → 新增 ${inserted}, 跳过 ${skippedCount} (已存在)`);
        } else {
          spinner.succeed(`提取 ${jobs.length} 个职位 → 全部新增`);
        }
      } catch (error: any) {
        spinner.fail(`爬取失败: ${error.message}`);
        if (options.verbose) {
          console.error(error.stack);
        }
      }
    }

    await browser.close();

    // 输出统计
    const finalCount = db.getJobCount();
    console.log(chalk.bold('\n✅ 爬取完成!\n'));
    console.log(chalk.green(`  本次提取: ${totalExtracted} 个职位`));
    console.log(chalk.green(`  新增入库: ${totalInserted}`));
    if (totalSkipped > 0) {
      console.log(chalk.yellow(`  跳过重复: ${totalSkipped}`));
    }
    console.log(chalk.cyan(`  数据库总量: ${finalCount}`));
    console.log(chalk.gray(`  数据库路径: ${dbPath}\n`));

    // 按来源统计
    const sourceCounts = db.getCountBySource();
    if (sourceCounts.length > 0) {
      console.log(chalk.gray('📊 按来源统计:'));
      for (const { source, count } of sourceCounts) {
        console.log(chalk.gray(`  ${source || '未知'}: ${count}`));
      }
      console.log('');
    }

    db.close();
  } catch (error: any) {
    await browser.close();
    db.close();
    throw error;
  }
}

/**
 * 提取域名
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return 'unknown';
  }
}
