#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import packageJson from '../package.json';
import { generateCommand } from './commands/generate.js';
import { crawlCommand } from './commands/crawl.js';

/**
 * JO Crawler CLI
 * 智能职位爬虫系统
 */
const program = new Command();

program
  .name('jo-crawler')
  .description('基于 Agent-Browser 和 GLM-4.7 的智能职位爬虫')
  .version(packageJson.version);

// 添加命令
program.addCommand(generateCommand());
program.addCommand(crawlCommand());

// 解析参数
program.parse();
