import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs-extra';
import { DatabaseService } from '../services/DatabaseService.js';
import { config } from '../utils/config.js';
import type { JobData } from '../models/JobData.js';

/**
 * 导出命令选项
 */
interface ExportOptions {
  output?: string;
  format?: 'json' | 'csv';
  source?: string;
  company?: string;
  keyword?: string;
  limit?: number;
  db?: string;
  fields?: string;
  desc?: boolean; // Commander converts --no-desc to desc: false
}

/**
 * 导出命令
 */
export function exportCommand(): Command {
  const cmd = new Command('export');

  cmd
    .description('从数据库导出职位数据到 JSON 或 CSV 文件')
    .option('-o, --output <path>', '输出文件路径（默认根据格式自动生成）')
    .option('-f, --format <format>', '输出格式 (json|csv)', 'json')
    .option('-s, --source <source>', '按来源过滤（模糊匹配）')
    .option('-c, --company <company>', '按公司过滤（模糊匹配）')
    .option('-k, --keyword <keyword>', '按关键字过滤（匹配标题和描述）')
    .option('-l, --limit <number>', '最大导出条数')
    .option('--db <path>', '数据库文件路径', config.paths.database)
    .option('--fields <fields>', '导出字段（逗号分隔），默认全部')
    .option('--no-desc', '不导出 description 字段（减小文件体积）')
    .action(async (options: ExportOptions) => {
      try {
        await runExport(options);
      } catch (error: any) {
        console.error(chalk.red('❌ 导出失败:'), error.message);
        process.exit(1);
      }
    });

  return cmd;
}

/**
 * 执行导出
 */
async function runExport(options: ExportOptions) {
  const dbPath = options.db || config.paths.database;
  const format = options.format || 'json';

  // 检查数据库是否存在
  if (!(await fs.pathExists(dbPath))) {
    console.error(chalk.red(`❌ 数据库文件不存在: ${dbPath}`));
    console.log(chalk.yellow('💡 请先运行 npm run crawl 爬取数据'));
    process.exit(1);
  }

  // 初始化数据库
  const db = new DatabaseService(dbPath);
  await db.init();

  // 查询
  const limit = options.limit ? parseInt(String(options.limit), 10) : undefined;
  const jobs = db.queryJobs({
    source: options.source,
    company: options.company,
    keyword: options.keyword,
    limit,
  });

  if (jobs.length === 0) {
    console.log(chalk.yellow('⚠️  没有匹配的职位数据'));
    db.close();
    return;
  }

  // 处理字段过滤
  let exportData: any[] = jobs;

  if (options.fields) {
    const selectedFields = options.fields.split(',').map(f => f.trim());
    exportData = jobs.map(job => {
      const filtered: any = {};
      for (const field of selectedFields) {
        if (field in job) {
          filtered[field] = job[field as keyof JobData];
        }
      }
      return filtered;
    });
  } else if (options.desc === false) {
    // --no-desc 被提供时，desc 为 false，移除 description 字段
    exportData = jobs.map(({ description, ...rest }) => rest);
  }

  // 确定输出路径
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const defaultFilename = `jobs-export-${timestamp}.${format}`;
  const outputPath = options.output || path.join('output', defaultFilename);

  // 确保目录存在
  await fs.ensureDir(path.dirname(outputPath));

  // 写入文件
  if (format === 'json') {
    await fs.writeJson(outputPath, exportData, { spaces: 2 });
  } else if (format === 'csv') {
    const csv = convertToCSV(exportData);
    await fs.writeFile(outputPath, csv, 'utf-8');
  }

  // 输出统计
  console.log(chalk.bold.blue('\n📤 JO Crawler - 数据导出\n'));
  console.log(chalk.green(`  导出条数: ${jobs.length}`));
  console.log(chalk.gray(`  输出格式: ${format.toUpperCase()}`));
  console.log(chalk.gray(`  输出文件: ${outputPath}`));

  if (options.source) console.log(chalk.gray(`  来源过滤: ${options.source}`));
  if (options.company) console.log(chalk.gray(`  公司过滤: ${options.company}`));
  if (options.keyword) console.log(chalk.gray(`  关键字: ${options.keyword}`));

  // 按来源统计
  const sourceCounts: Record<string, number> = {};
  for (const job of jobs) {
    const src = job.source || '未知';
    sourceCounts[src] = (sourceCounts[src] || 0) + 1;
  }
  console.log(chalk.gray('\n  按来源:'));
  for (const [src, count] of Object.entries(sourceCounts).sort((a, b) => b[1] - a[1])) {
    console.log(chalk.gray(`    ${src}: ${count}`));
  }

  console.log('');
  db.close();
}

/**
 * 转换为 CSV
 */
function convertToCSV(data: any[]): string {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row =>
      headers.map(header => {
        const value = row[header];
        const str = value != null ? String(value) : '';
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(',')
    ),
  ];

  return csvRows.join('\n');
}
