import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'fs-extra';
import { LLMService } from '../services/LLMService.js';
import { DatabaseService } from '../services/DatabaseService.js';
import { ParserRegistry } from '../parsers/registry.js';
import { CrawlEngine } from '../services/CrawlEngine.js';
import { config } from '../utils/config.js';
import { loadLinksConfig } from '../utils/loadLinksCsv.js';
import type { CrawlOptions } from '../models/CrawlConfig.js';
import type { LinkConfig } from '../models/LinksConfig.js';

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
    .option('--cdp <url>', '连接已有 Chrome（CDP 端口或 ws:// URL），绕过反爬')
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
  const cdpUrl = options.cdp;

  console.log(chalk.gray('配置:'));
  console.log(chalk.gray(`  最大职位数: ${maxJobs}`));
  console.log(chalk.gray(`  最大翻页数: ${maxPages}`));
  console.log(chalk.gray(`  并发数: ${concurrency}`));
  console.log(chalk.gray(`  数据库: ${dbPath}`));
  console.log(chalk.gray(`  无头模式: ${headless}`));
  if (cdpUrl) console.log(chalk.gray(`  CDP 连接: ${cdpUrl}`));
  console.log('');

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

  // 加载所有解析器
  console.log(chalk.yellow('📦 加载解析器...\n'));
  await registry.loadAll();

  // ── 使用 CrawlEngine ──────────────────────────────
  const engine = new CrawlEngine(llmService, registry, db, {
    concurrency,
    maxJobs,
    maxPages,
    headless,
    verbose: !!options.verbose,
    cdpUrl,
  });

  try {
    const summary = concurrency > 1
      ? await engine.crawlAll(linkConfigs)
      : await engine.crawlSerial(linkConfigs);

    // 输出统计
    const finalCount = db.getJobCount();
    console.log(chalk.bold('\n✅ 爬取完成!\n'));
    console.log(chalk.green(`  本次提取: ${summary.totalExtracted} 个职位`));
    console.log(chalk.green(`  新增入库: ${summary.totalInserted}`));
    if (summary.totalSkipped > 0) {
      console.log(chalk.yellow(`  跳过重复: ${summary.totalSkipped}`));
    }
    if (summary.failed > 0) {
      console.log(chalk.red(`  失败站点: ${summary.failed}`));
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
  } finally {
    db.close();
  }
}
