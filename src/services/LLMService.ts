import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { PARSER_GENERATOR_SYSTEM, PARSER_GENERATOR_USER, toClassName } from '../prompts/parser-generator.js';
import { generateParserFilename } from '../utils/parserFilename.js';

/**
 * LLM API 消息格式（兼容豆包和GLM）
 */
interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM API 响应（兼容豆包和GLM）
 */
interface LLMResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * LLM 服务配置
 */
export interface LLMServiceConfig {
  apiKey: string;
  apiUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * LLM 服务（支持豆包、GLM等多种LLM）
 * 用于生成解析器和智能分析页面结构
 */
export class LLMService {
  private config: Required<LLMServiceConfig>;

  /**
   * 修复生成的代码中的常见错误
   */
  private static fixGeneratedCodeErrors(code: string): string {
    let fixedCode = code;

    // 修复 "this browser.xxx" 错误
    // 例如: await this browser.delay(1000) -> await this.delay(1000)
    fixedCode = fixedCode.replace(/this\s+browser\./g, 'browser.');

    // 修复 "await this browser" 错误
    // 例如: await this browser.delay(1000) -> await this.delay(1000)
    fixedCode = fixedCode.replace(/await\s+this\s+browser\s+/g, 'await this.');

    // 修复变量名错误：job.length -> jobRefs.length（在特定的上下文中）
    // 检测模式：const jobRefs = this.findJobCardRefs 后面跟着 console.log(job.length)
    // 但由于这是一个上下文相关的错误，我们使用更简单的启发式方法
    fixedCode = fixedCode.replace(
      /console\.log\(`找到 \$\{job\.length\} 个职位卡片`\);/g,
      'console.log(`找到 ${jobRefs.length} 个职位卡片`);'
    );

    // 修复其他常见的 jobRefs -> job 错误
    fixedCode = fixedCode.replace(
      /console\.log\(`找到 \$\{job\.length\} 个职位/g,
      'console.log(`找到 ${jobRefs.length} 个职位'
    );

    return fixedCode;
  }

  constructor(config: LLMServiceConfig) {
    this.config = {
      apiKey: config.apiKey,
      apiUrl: config.apiUrl || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      model: config.model || 'doubao-seed-1-6-251015',
      temperature: config.temperature || 0.7,
      maxTokens: config.maxTokens || 8000,
    };
  }

  /**
   * 调用 LLM API（支持豆包、GLM等）
   */
  private async callGLM(messages: LLMMessage[]): Promise<{ content: string; usage: any; requestTime: number }> {
    try {
      const startTime = Date.now();

      // 检测是否为豆包 API
      const isDoubao = this.config.apiUrl.includes('volces.com');

      const requestBody: any = {
        model: this.config.model,
        messages,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      };

      // 豆包特有的 thinking 参数
      if (isDoubao) {
        requestBody.thinking = {
          type: 'disabled'  // 生成代码时禁用思考模式以提高速度
        };
      }

      const response = await axios.post<LLMResponse>(
        this.config.apiUrl,
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          timeout: 60000,
        }
      );

      const requestTime = Date.now() - startTime;

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('LLM API 返回空内容');
      }

      // 记录 token 使用情况
      const usage = response.data.usage;
      const provider = isDoubao ? '豆包' : 'GLM';
      console.log(`📊 ${provider} Token 使用: ${usage.prompt_tokens} + ${usage.completion_tokens} = ${usage.total_tokens}`);

      return { content, usage, requestTime };
    } catch (error: any) {
      console.error('❌ LLM API 调用失败:', error.response?.data || error.message);
      throw error;
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
        content: `URL: ${url}

页面快照：
${snapshot.substring(0, 3000)}

请判断页面类型，只返回以下三个选项之一：
1. list - 列表页
2. detail - 详情页
3. unknown - 无法确定

只返回类型名称，不要其他解释。`,
      },
    ];

    const { content: response } = await this.callGLM(messages);
    const type = response.toLowerCase().trim();

    if (type.includes('list')) return 'list';
    if (type.includes('detail')) return 'detail';
    return 'unknown';
  }

  /**
   * 生成解析器代码（使用外部 Prompt 模板）
   */
  async generateParser(
    domain: string,
    snapshot: string,
    url: string,
    refMap: Record<string, any>,
    customPrompt?: string,
    pageType?: 'list' | 'detail'  // 新增：页面类型（优先使用 CSV 配置）
  ): Promise<{ code: string; usage: any; requestTime: number }> {
    let userContent = PARSER_GENERATOR_USER(toClassName(domain), snapshot, url, refMap, pageType);

    // 添加自定义 prompt
    if (customPrompt) {
      userContent += `\n\n**自定义要求：**\n${customPrompt}\n`;
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: PARSER_GENERATOR_SYSTEM,
      },
      {
        role: 'user',
        content: userContent,
      },
    ];

    const result = await this.callGLM(messages);

    // 清理可能的 markdown 代码块标记
    let cleanedCode = result.content;
    const codeBlockMatch = result.content.match(/```(?:javascript)?\n([\s\S]*?)\`\`/);
    if (codeBlockMatch) {
      cleanedCode = codeBlockMatch[1];
    }

    return {
      code: cleanedCode.trim(),
      usage: result.usage,
      requestTime: result.requestTime
    };
  }

  /**
   * 提取职位数据（使用 LLM 直接从快照提取）
   */
  async extractJobDataFromSnapshot(
    snapshot: string,
    url: string
  ): Promise<Partial<Record<string, string>>> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个职位数据提取专家。请从页面快照中提取完整的职位信息（JD），并以 JSON 格式返回。

**重要要求：**
1. 完整提取职位描述（JD），不要截断
2. 提取所有关键信息（职责、要求、福利等）
3. 保持原文格式和换行`,
      },
      {
        role: 'user',
        content: `URL: ${url}

页面快照（这是可访问性树，包含页面结构）：
${snapshot}

**请提取以下字段（如果存在）：**
- title: 职位标题
- company: 公司名称
- location: 工作地点
- description: **完整的职位描述（JD）**，包括：
  - 职位概述
  - 主要职责
  - 任职要求
  - 福利待遇
  - 任何其他相关信息
- department: 部门
- salary: 薪资范围
- employmentType: 雇佣类型（全职/兼职/实习等）
- requirements: 要求列表（数组格式）
- responsibilities: 职责列表（数组格式）

**返回格式：**
返回 JSON 格式，只包含提取到的字段，不要包含 null 值。
description 字段必须包含完整的 JD 内容，不要截断。`,
      },
    ];

    const { content: response } = await this.callGLM(messages);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error('❌ 解析 LLM 返回的 JSON 失败:', error);
    }

    return {};
  }

  /**
   * 保存生成的解析器到文件（JavaScript 版本）
   */
  async saveGeneratedParser(
    domain: string,
    code: string,
    outputDir: string,
    url?: string,
    pageType?: 'list' | 'detail' | 'auto'
  ): Promise<string> {
    await fs.ensureDir(outputDir);

    // 生成唯一文件名（包含域名、类型和 URL 签名）
    const filename = url && pageType
      ? `${generateParserFilename(domain, url, pageType)}.js`
      : `${domain.replace(/\*/g, '_').replace(/\./g, '-')}.js`;

    const filepath = path.join(outputDir, filename);

    // 检查文件是否已存在
    if (await fs.pathExists(filepath)) {
      console.log(`⚠️  解析器已存在: ${filename}`);
      console.log(`💡 使用 --force 选项可覆盖现有解析器`);
      return filepath;
    }

    // 修复生成的代码中的常见错误
    const fixedCode = LLMService.fixGeneratedCodeErrors(code);

    // 添加文件头注释
    const header = `/**
 * Auto-generated parser for ${domain}
 * Generated at: ${new Date().toISOString()}
 * Author: AI (GLM-4.7)
 * URL: ${url || 'N/A'}
 * Type: ${pageType || 'auto'}
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

`;

    await fs.writeFile(filepath, header + fixedCode, 'utf-8');
    console.log(`✅ 解析器已保存: ${filepath}`);

    return filepath;
  }

  /**
   * 保存生成的解析器及其相关资源（快照、截图、日志）
   * 为每个站点创建独立文件夹
   */
  async saveGeneratedParserWithAssets(
    domain: string,
    code: string,
    outputDir: string,
    url?: string,
    pageType?: 'list' | 'detail' | 'auto',
    assets?: {
      snapshot: { tree: string; refs: Record<string, any> };
      screenshotPath?: string;
      generationLog: string[];
      logStartTime: string;
      customPrompt?: string;
      configType?: string;
      llmUsage?: any;
      requestTime?: number;
    }
  ): Promise<{
    parserPath: string;
    generatedParserPath?: string;  // src/parsers/generated 中的路径
    snapshotPath?: string;
    screenshotPath?: string;
    logPath?: string;
    readmePath?: string;
    folderPath: string;
  }> {
    // fs 和 path 已在文件顶部导入，直接使用

    // 1. 生成站点文件夹名称
    // 例如: jpmc-fa-oraclecloud-com-list-sites-cx-1001
    const folderName = url && pageType
      ? generateParserFilename(domain, url, pageType)
      : domain.replace(/\*/g, '_').replace(/\./g, '-');

    // 2. 保存到 output/parsers/ 下
    const folderPath = path.join('output/parsers', folderName);
    await fs.ensureDir(folderPath);

    // 3. 保存解析器 JS 文件到 output/parsers/
    const parserFilename = 'parser.js';
    const parserPath = path.join(folderPath, parserFilename);

    const header = `/**
 * Auto-generated parser for ${domain}
 * Generated at: ${new Date().toISOString()}
 * Author: AI (GLM-4.7)
 * URL: ${url || 'N/A'}
 * Type: ${pageType || 'auto'}
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

`;

    // 修复生成的代码中的常见错误
    const fixedCode = LLMService.fixGeneratedCodeErrors(code);

    await fs.writeFile(parserPath, header + fixedCode, 'utf-8');

    const result: any = {
      parserPath,
      folderPath,
    };

    // 4. 同时复制到 src/parsers/generated/ 用于动态加载
    const generatedDir = path.join('src/parsers/generated');
    await fs.ensureDir(generatedDir);

    // 使用相同的文件名（三段式命名）
    const generatedFilename = `${folderName}.js`;
    const generatedParserPath = path.join(generatedDir, generatedFilename);
    await fs.writeFile(generatedParserPath, header + fixedCode, 'utf-8');
    result.generatedParserPath = generatedParserPath;

    // 5. 保存快照（如果提供）
    if (assets?.snapshot) {
      const snapshotPath = path.join(folderPath, 'snapshot.json');
      await fs.writeFile(
        snapshotPath,
        JSON.stringify({
          url,
          pageType,
          domain,
          timestamp: new Date().toISOString(),
          tree: assets.snapshot.tree,
          refs: assets.snapshot.refs,
        }, null, 2),
        'utf-8'
      );
      result.snapshotPath = snapshotPath;
    }

    // 6. 复制截图（如果提供）
    if (assets?.screenshotPath) {
      const screenshotFilename = 'screenshot.png';
      const targetScreenshotPath = path.join(folderPath, screenshotFilename);
      try {
        await fs.copy(assets.screenshotPath, targetScreenshotPath);
        result.screenshotPath = targetScreenshotPath;
      } catch (error) {
        console.warn(`⚠️  无法复制截图: ${error}`);
      }
    }

    // 7. 保存生成日志（如果提供）
    if (assets?.generationLog) {
      const logPath = path.join(folderPath, 'generation.log');

      // 计算总耗时
      const startTime = new Date(assets.logStartTime).getTime();
      const endTime = new Date().getTime();
      const totalDuration = endTime - startTime;

      const logContent = [
        `Parser Generation Log`,
        `=====================`,
        ``,
        `Basic Information:`,
        `------------------`,
        `URL: ${url}`,
        `Domain: ${domain}`,
        `Page Type: ${pageType}`,
        `Config Type: ${assets.configType || 'N/A'}`,
        ``,
        `Timing:`,
        `-------`,
        `Start Time: ${assets.logStartTime}`,
        `End Time: ${new Date().toISOString()}`,
        `Total Duration: ${totalDuration}ms`,
        ``,
        assets.customPrompt ? `Custom Prompt:\n${assets.customPrompt}\n` : '',
        assets?.llmUsage ? `LLM API Call Details:\n---------------------\n- Model: glm-4.7\n- Prompt Tokens: ${assets.llmUsage.prompt_tokens}\n- Completion Tokens: ${assets.llmUsage.completion_tokens}\n- Total Tokens: ${assets.llmUsage.total_tokens}\n- Request Time: ${assets.requestTime}ms\n` : '',
        ``,
        `Log Entries:`,
        `-----------`,
        ...assets.generationLog,
      ].join('\n');

      await fs.writeFile(logPath, logContent, 'utf-8');
      result.logPath = logPath;
    }

    // 8. 创建 README.md
    const readmePath = path.join(folderPath, 'README.md');
    const readmeContent = `# ${folderName}

## 基本信息

- **域名**: ${domain}
- **URL**: ${url || 'N/A'}
- **页面类型**: ${pageType || 'auto'}
- **生成时间**: ${new Date().toISOString()}

## 文件说明

- **parser.js**: 自动生成的解析器代码
- **src/parsers/generated/${generatedFilename}**: 用于动态加载的副本
${assets?.snapshot ? '- **snapshot.json**: 页面快照（可访问性树和 refs）' : ''}
${assets?.screenshotPath ? '- **screenshot.png**: 页面截图' : ''}
${assets?.generationLog ? '- **generation.log**: 生成过程的详细日志' : ''}

## 使用方法

\`\`\`javascript
// 方式1: 从 output/parsers 导入
import Parser from './output/parsers/${folderName}/parser.js';

// 方式2: 自动加载（系统会从 src/parsers/generated 加载）
const parser = new Parser();
const jobs = await parser.parse(browser, { maxItems: 10 });
\`\`\`

## 元数据

\`\`\`json
{
  "domain": "${domain}",
  "url": "${url || ''}",
  "pageType": "${pageType || 'auto'}",
  "generatedAt": "${new Date().toISOString()}"
}
\`\`\`

---

**注意**: 此文件和解析器代码由 AI 自动生成，手动修改可能会被覆盖。
`;

    await fs.writeFile(readmePath, readmeContent, 'utf-8');
    result.readmePath = readmePath;

    return result;
  }
}
