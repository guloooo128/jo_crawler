import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs-extra';
import { ParserGenerator } from '../services/ParserGenerator.js';
import { LLMService } from '../services/LLMService.js';
import { config } from '../utils/config.js';
import { loadLinksConfig } from '../utils/loadLinksCsv.js';
import type { GenerateOptions } from '../models/CrawlConfig.js';
import type { LinkConfig } from '../models/LinksConfig.js';

/**
 * 生成解析器命令
 */
export function generateCommand(): Command {
  const cmd = new Command('generate');

  cmd
    .description('为 links.csv 或 links.txt 中的网站自动生成解析器')
    .option('-d, --domain <domain>', '只为指定域名生成解析器')
    .option('-f, --force', '强制重新生成，覆盖已存在的解析器')
    .option('-v, --verbose', '详细输出')
    .option('--csv', '使用 CSV 配置文件（links.csv）')
    .option('--txt', '使用 TXT 配置文件（links.txt）')
    .action(async (options: GenerateOptions & { csv?: boolean; txt?: boolean }) => {
      try {
        await runGenerate(options);
      } catch (error: any) {
        console.error(chalk.red('❌ 生成失败:'), error.message);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * 执行生成命令
 */
async function runGenerate(options: GenerateOptions & { csv?: boolean; txt?: boolean }) {
  console.log(chalk.bold.blue('\n🚀 JO Crawler - 解析器生成器\n'));

  // 检查 API Key
  if (!config.llm.apiKey) {
    console.error(chalk.red('❌ 未设置 DOUBAO_API_KEY 环境变量'));
    console.log(chalk.yellow('💡 请在 .env 文件中设置 DOUBAO_API_KEY'));
    process.exit(1);
  }

  // 确定使用哪种配置文件
  const useCsv = options.csv || (!options.txt && await fs.pathExists(config.paths.linksCsv));
  const useTxt = options.txt || (!options.csv && await fs.pathExists(config.paths.links));

  let linkConfigs: LinkConfig[] = [];

  if (useCsv) {
    // 使用 CSV 配置
    console.log(chalk.yellow('📄 使用 CSV 配置文件\n'));
    linkConfigs = await loadLinksConfig(config.paths.linksCsv);
  } else if (useTxt) {
    // 使用 TXT 配置（向后兼容）
    console.log(chalk.yellow('📄 使用 TXT 配置文件\n'));
    linkConfigs = await loadTxtLinks();
  } else {
    console.error(chalk.red('❌ 未找到配置文件'));
    console.log(chalk.yellow('💡 请创建 links.csv 或 links.txt'));
    process.exit(1);
  }

  // 过滤域名（如果指定）
  if (options.domain) {
    linkConfigs = linkConfigs.filter(config => config.url.includes(options.domain!));
    console.log(chalk.yellow(`🔍 过滤域名: ${options.domain}\n`));
  }

  if (linkConfigs.length === 0) {
    console.log(chalk.yellow('⚠️  没有找到需要处理的 URL'));
    return;
  }

  console.log(chalk.gray(`找到 ${linkConfigs.length} 个 URL\n`));

  // 初始化服务
  const llmService = new LLMService({
    apiKey: config.llm.apiKey,
    apiUrl: config.llm.apiUrl,
    model: config.llm.model,
  });

  const generator = new ParserGenerator(llmService, config.paths.parsers);

  const spinner = ora('正在生成解析器...').start();

  try {
    // 生成解析器
    const results = await generator.generateBatchWithConfigs(linkConfigs, { force: options.force });

    spinner.stop();

    // 显示结果
    console.log(chalk.bold('\n📊 生成结果:\n'));

    let successful = 0;
    let failed = 0;
    let skipped = 0;

    results.forEach((result, index) => {
      let icon: string;
      let status: string;

      if (result.skipped) {
        icon = '⏭️ ';
        status = chalk.gray('已存在');
        skipped++;
      } else if (result.success) {
        icon = '✅';
        status = chalk.green('成功');
        successful++;
      } else {
        icon = '❌';
        status = chalk.red('失败');
        failed++;
      }

      const url = chalk.cyan(result.config.url.substring(0, 60));
      console.log(`${icon} ${index + 1}. ${url} - ${status}`);
    });

    console.log(chalk.bold('\n📈 统计:'));
    console.log(chalk.green(`  成功: ${successful}`));
    console.log(chalk.gray(`  跳过: ${skipped}`));
    console.log(chalk.red(`  失败: ${failed}`));
    console.log(chalk.gray(`  总计: ${linkConfigs.length}\n`));

    if (successful > 0) {
      console.log(chalk.yellow('💡 解析器已保存到: src/parsers/generated/'));
      console.log(chalk.gray('   下一步: npm run crawl 开始爬取\n'));
    } else if (skipped > 0) {
      console.log(chalk.yellow('💡 所有解析器都已存在，无需重新生成\n'));
    }
  } catch (error: any) {
    spinner.stop();
    throw error;
  } finally {
    await generator.close();
  }
}

/**
 * 从 TXT 文件加载链接（向后兼容）
 */
async function loadTxtLinks(): Promise<LinkConfig[]> {
  const linksPath = config.paths.links;

  if (!(await fs.pathExists(linksPath))) {
    throw new Error(`links.txt 不存在: ${linksPath}`);
  }

  const content = await fs.readFile(linksPath, 'utf-8');
  const urls = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));

  // 转换为 LinkConfig 格式
  return urls.map(url => ({
    type: 'auto' as const,
    url,
    maxJobs: 10,
  }));
}
