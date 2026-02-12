/**
 * ParserPersistence - 解析器文件 I/O
 *
 * 职责：
 * - 保存生成的解析器代码到文件系统
 * - 管理 output/parsers/ 和 src/parsers/generated/ 双份存储
 * - 生成 README、日志、快照等关联文件
 * - 文件命名（三段式命名）
 */

import fs from 'fs-extra';
import path from 'path';
import { generateParserFilename } from '../utils/parserFilename.js';
import { CodePostProcessor } from './CodePostProcessor.js';

// ============================================================================
// Types
// ============================================================================

export interface ParserAssets {
  snapshot: { tree: string; refs: Record<string, any> };
  detailSnapshot?: { tree: string; refs: Record<string, any>; url: string };
  screenshotPath?: string;
  generationLog: string[];
  logStartTime: string;
  customPrompt?: string;
  configType?: string;
  llmUsage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  requestTime?: number;
}

export interface SaveResult {
  parserPath: string;
  generatedParserPath?: string;
  snapshotPath?: string;
  screenshotPath?: string;
  logPath?: string;
  readmePath?: string;
  folderPath: string;
}

// ============================================================================
// ParserPersistence
// ============================================================================

export class ParserPersistence {

  /**
   * 简单保存（仅保存解析器 .js 文件）
   */
  static async saveParser(
    domain: string,
    code: string,
    outputDir: string,
    url?: string,
    pageType?: 'list' | 'detail' | 'auto',
  ): Promise<string> {
    await fs.ensureDir(outputDir);

    const filename = url && pageType
      ? `${generateParserFilename(domain, url, pageType)}.js`
      : `${domain.replace(/\*/g, '_').replace(/\./g, '-')}.js`;

    const filepath = path.join(outputDir, filename);

    if (await fs.pathExists(filepath)) {
      console.log(`⚠️  解析器已存在: ${filename}`);
      console.log(`💡 使用 --force 选项可覆盖现有解析器`);
      return filepath;
    }

    // 通过 CodePostProcessor 修复
    const { fixedCode } = CodePostProcessor.process(code);
    const finalCode = fixedCode ?? code;

    const header = ParserPersistence.fileHeader(domain, url, pageType);
    await fs.writeFile(filepath, header + finalCode, 'utf-8');
    console.log(`✅ 解析器已保存: ${filepath}`);

    return filepath;
  }

  /**
   * 完整保存（解析器 + 快照 + 截图 + 日志 + README）
   */
  static async saveParserWithAssets(
    domain: string,
    code: string,
    outputDir: string,
    url?: string,
    pageType?: 'list' | 'detail' | 'auto',
    assets?: ParserAssets,
  ): Promise<SaveResult> {
    // 1. 文件夹名
    const folderName = url && pageType
      ? generateParserFilename(domain, url, pageType)
      : domain.replace(/\*/g, '_').replace(/\./g, '-');

    const folderPath = path.join('output/parsers', folderName);
    await fs.ensureDir(folderPath);

    // 2. 修复代码
    const { fixedCode } = CodePostProcessor.process(code);
    const finalCode = fixedCode ?? code;
    const header = ParserPersistence.fileHeader(domain, url, pageType);

    // 3. 保存到 output/parsers/<folder>/parser.js
    const parserPath = path.join(folderPath, 'parser.js');
    await fs.writeFile(parserPath, header + finalCode, 'utf-8');

    const result: SaveResult = { parserPath, folderPath };

    // 4. 复制到 src/parsers/generated/
    const generatedDir = path.join('src/parsers/generated');
    await fs.ensureDir(generatedDir);
    const generatedFilename = `${folderName}.js`;
    const generatedParserPath = path.join(generatedDir, generatedFilename);
    await fs.writeFile(generatedParserPath, header + finalCode, 'utf-8');
    result.generatedParserPath = generatedParserPath;

    // 5. 保存快照
    if (assets?.snapshot) {
      const snapshotPath = path.join(folderPath, 'snapshot.json');
      await fs.writeFile(
        snapshotPath,
        JSON.stringify({
          url, pageType, domain,
          timestamp: new Date().toISOString(),
          tree: assets.snapshot.tree,
          refs: assets.snapshot.refs,
        }, null, 2),
        'utf-8',
      );
      result.snapshotPath = snapshotPath;
    }

    // 5.5 详情页快照
    if (assets?.detailSnapshot) {
      const detailSnapshotPath = path.join(folderPath, 'detail-snapshot.json');
      await fs.writeFile(
        detailSnapshotPath,
        JSON.stringify({
          url: assets.detailSnapshot.url,
          pageType: 'detail',
          domain,
          timestamp: new Date().toISOString(),
          tree: assets.detailSnapshot.tree,
          refs: assets.detailSnapshot.refs,
        }, null, 2),
        'utf-8',
      );
    }

    // 6. 截图
    if (assets?.screenshotPath) {
      const targetPath = path.join(folderPath, 'screenshot.png');
      try {
        await fs.copy(assets.screenshotPath, targetPath);
        result.screenshotPath = targetPath;
      } catch (error) {
        console.warn(`⚠️  无法复制截图: ${error}`);
      }
    }

    // 7. 生成日志
    if (assets?.generationLog) {
      const logPath = path.join(folderPath, 'generation.log');
      const startTime = new Date(assets.logStartTime).getTime();
      const totalDuration = Date.now() - startTime;

      const logContent = [
        'Parser Generation Log',
        '=====================',
        '',
        `URL: ${url}`,
        `Domain: ${domain}`,
        `Page Type: ${pageType}`,
        `Config Type: ${assets.configType || 'N/A'}`,
        '',
        `Start Time: ${assets.logStartTime}`,
        `End Time: ${new Date().toISOString()}`,
        `Total Duration: ${totalDuration}ms`,
        '',
        assets.customPrompt ? `Custom Prompt:\n${assets.customPrompt}\n` : '',
        assets.llmUsage ? [
          'LLM API Details:',
          `  Prompt Tokens: ${assets.llmUsage.prompt_tokens}`,
          `  Completion Tokens: ${assets.llmUsage.completion_tokens}`,
          `  Total Tokens: ${assets.llmUsage.total_tokens}`,
          `  Request Time: ${assets.requestTime}ms`,
        ].join('\n') : '',
        '',
        'Log Entries:',
        ...assets.generationLog,
      ].filter(Boolean).join('\n');

      await fs.writeFile(logPath, logContent, 'utf-8');
      result.logPath = logPath;
    }

    // 8. README
    const readmePath = path.join(folderPath, 'README.md');
    await fs.writeFile(readmePath, ParserPersistence.readme(folderName, domain, url, pageType, generatedFilename, assets), 'utf-8');
    result.readmePath = readmePath;

    return result;
  }

  // ---------- helpers ----------

  private static fileHeader(domain: string, url?: string, pageType?: string): string {
    return `/**
 * Auto-generated parser for ${domain}
 * Generated at: ${new Date().toISOString()}
 * Author: AI
 * URL: ${url || 'N/A'}
 * Type: ${pageType || 'auto'}
 *
 * ⚠️ This file is auto-generated. Manual edits may be overwritten.
 */

`;
  }

  private static readme(
    folderName: string,
    domain: string,
    url?: string,
    pageType?: string,
    generatedFilename?: string,
    assets?: ParserAssets,
  ): string {
    return `# ${folderName}

## 基本信息

- **域名**: ${domain}
- **URL**: ${url || 'N/A'}
- **页面类型**: ${pageType || 'auto'}
- **生成时间**: ${new Date().toISOString()}

## 文件说明

- **parser.js**: 自动生成的解析器代码
${generatedFilename ? `- **src/parsers/generated/${generatedFilename}**: 用于动态加载的副本` : ''}
${assets?.snapshot ? '- **snapshot.json**: 页面快照（可访问性树和 refs）' : ''}
${assets?.screenshotPath ? '- **screenshot.png**: 页面截图' : ''}
${assets?.generationLog ? '- **generation.log**: 生成过程的详细日志' : ''}

---

**注意**: 此文件和解析器代码由 AI 自动生成，手动修改可能会被覆盖。
`;
  }
}
