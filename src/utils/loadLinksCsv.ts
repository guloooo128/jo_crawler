import fs from 'fs-extra';
import path from 'path';
import { parse } from 'csv-parse/sync';
import type { LinkConfig } from '../models/LinksConfig.js';
import { parseLinkConfigRow, validateLinkConfig } from '../models/LinksConfig.js';

/**
 * 从 CSV 文件加载配置
 */
export async function loadLinksConfig(csvPath: string): Promise<LinkConfig[]> {
  // 检查文件是否存在
  if (!(await fs.pathExists(csvPath))) {
    throw new Error(`CSV 配置文件不存在: ${csvPath}`);
  }

  // 读取文件内容
  const content = await fs.readFile(csvPath, 'utf-8');

  // 解析 CSV
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  // 转换为 LinkConfig 数组
  const configs: LinkConfig[] = [];
  const errors: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i] as any;

    // 跳过注释行
    if (row.type?.startsWith('#') || row.url?.startsWith('#')) {
      continue;
    }

    const config: LinkConfig = {
      type: (row.type || 'list').trim(),
      url: row.url?.trim() || '',
      maxJobs: parseInt(row.max_jobs || row.maxJobs || '10', 10),
      prompt: row.prompt?.trim() || undefined,
    };

    // 验证配置
    const validation = validateLinkConfig(config);
    if (!validation.valid) {
      errors.push(`第 ${i + 2} 行: ${validation.error}`);
      continue;
    }

    configs.push(config);
  }

  if (errors.length > 0) {
    console.warn('⚠️  CSV 配置文件包含错误:');
    errors.forEach(error => console.warn(`  - ${error}`));
  }

  if (configs.length === 0) {
    throw new Error('CSV 配置文件中没有有效的配置行');
  }

  return configs;
}

/**
 * 创建示例 CSV 文件
 */
export async function createExampleCsv(outputPath: string): Promise<void> {
  const example = `# JO Crawler 配置文件
# 字段说明:
# - type: 页面类型 (list=列表页, detail=详情页)
# - url: 目标 URL
# - max_jobs: 最大爬取职位数
# - prompt: 自定义提示词（可选，用于优化解析器生成）

type,url,max_jobs,prompt
list,https://example.com/jobs,10,这个网站的职位卡片包含薪资信息
detail,https://example.com/jobs/123,1,
list,https://careers.company.com,5,注意反爬虫，需要增加延迟
`;

  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, example, 'utf-8');
  console.log(`✅ 已创建示例配置文件: ${outputPath}`);
}
