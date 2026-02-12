/**
 * CodePostProcessor - AST 验证 + 代码修复
 *
 * 职责：
 * - 使用 acorn 进行真正的 AST 级别语法验证（替代脆弱的正则修补）
 * - 结构性验证（class/metadata/parse/canParse 方法）
 * - 安全的代码修复（仅修复已知的 LLM 常见输出错误）
 * - 生成人类可读的验证报告
 */

import * as acorn from 'acorn';

// ============================================================================
// Types
// ============================================================================

export interface ValidationError {
  type: 'syntax' | 'structure' | 'import';
  message: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  /** 修复后的代码（如果有修复） */
  fixedCode?: string;
}

// ============================================================================
// CodePostProcessor
// ============================================================================

export class CodePostProcessor {

  /**
   * 完整流程：修复 → AST 验证 → 结构验证
   */
  static process(rawCode: string): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // Step 1: 应用已知修复
    let code = CodePostProcessor.applyKnownFixes(rawCode);

    // Step 2: AST 语法验证
    const syntaxResult = CodePostProcessor.validateSyntax(code);
    if (!syntaxResult.valid) {
      errors.push(...syntaxResult.errors);
      return { valid: false, errors, warnings, fixedCode: code };
    }

    // Step 3: 结构验证
    const structureResult = CodePostProcessor.validateStructure(code);
    errors.push(...structureResult.errors);
    warnings.push(...structureResult.warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      fixedCode: code,
    };
  }

  /**
   * 仅做 AST 语法验证
   */
  static validateSyntax(code: string): { valid: boolean; errors: ValidationError[] } {
    const errors: ValidationError[] = [];

    try {
      acorn.parse(code, {
        ecmaVersion: 2022,
        sourceType: 'module',
        allowImportExportEverywhere: true,
      });
    } catch (err: any) {
      errors.push({
        type: 'syntax',
        message: err.message,
        line: err.loc?.line,
        column: err.loc?.column,
        severity: 'error',
      });
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * 结构验证：检查 parser 代码必须包含的结构
   */
  static validateStructure(code: string): { errors: ValidationError[]; warnings: ValidationError[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    // 必须：class extends BaseParser
    if (!/class\s+\w+\s+extends\s+BaseParser\b/.test(code)) {
      errors.push({
        type: 'structure',
        message: '缺少 class xxx extends BaseParser 定义',
        severity: 'error',
      });
    }

    // 必须：import BaseParser
    if (!/import\s+\{?\s*BaseParser\s*\}?\s+from/.test(code)) {
      errors.push({
        type: 'import',
        message: '缺少 import { BaseParser } from \'../base/BaseParser.js\'',
        severity: 'error',
      });
    }

    // 必须：async parse(browser, options)
    if (!/async\s+parse\s*\(\s*browser/.test(code)) {
      errors.push({
        type: 'structure',
        message: '缺少 async parse(browser, options) 方法',
        severity: 'error',
      });
    }

    // 必须：canParse 方法
    if (!/canParse\s*\(/.test(code)) {
      errors.push({
        type: 'structure',
        message: '缺少 canParse() 方法',
        severity: 'error',
      });
    }

    // 必须：metadata
    if (!/metadata\s*=/.test(code)) {
      warnings.push({
        type: 'structure',
        message: '缺少 metadata 定义',
        severity: 'warning',
      });
    }

    // 必须：export default
    if (!/export\s+default\s+class/.test(code)) {
      warnings.push({
        type: 'structure',
        message: '建议使用 export default class',
        severity: 'warning',
      });
    }

    // 必须：createJobData 调用
    if (!/this\s*\.\s*createJobData\s*\(/.test(code)) {
      warnings.push({
        type: 'structure',
        message: '未调用 this.createJobData() — 可能导致数据格式问题',
        severity: 'warning',
      });
    }

    // 警告：使用了 browser.goBack（反模式）
    if (/browser\s*\.\s*goBack\s*\(/.test(code)) {
      warnings.push({
        type: 'structure',
        message: '使用了 browser.goBack() — 推荐使用 navigate() 模式替代',
        severity: 'warning',
      });
    }

    return { errors, warnings };
  }

  /**
   * 应用已知的 LLM 常见输出错误修复
   * 这些是经过验证的安全修复，不会破坏正确代码
   */
  static applyKnownFixes(code: string): string {
    let fixed = code;

    // Fix 1: "this browser.xxx" → "browser.xxx"
    // LLM 有时把 this.browser.method 错误地写成 this browser.method
    fixed = fixed.replace(/this\s+browser\./g, 'browser.');

    // Fix 2: "await this browser" → "await this."
    fixed = fixed.replace(/await\s+this\s+browser\s+/g, 'await this.');

    // Fix 3: 双等号 "= =" → "="（变量赋值时的错误，注意不要动 "==" 和 "==="）
    fixed = fixed.replace(/=\s+=(?!=)/g, '=');

    // Fix 4: "this. collectJobLinks" → "this.collectJobLinks"（空格typo）
    fixed = fixed.replace(/this\.\s+(\w+)/g, 'this.$1');

    // Fix 5: 尾随逗号在函数调用中 "fn(arg,)" → "fn(arg)"
    fixed = fixed.replace(/,\s*\)/g, ')');

    // Fix 6: import 路径修复：确保 BaseParser 的 import 路径正确
    fixed = fixed.replace(
      /from\s+['"]\.\.\/base\/BaseParser['"]/g,
      "from '../base/BaseParser.js'"
    );
    // 保留已有的 .js 后缀
    fixed = fixed.replace(
      /from\s+['"]\.\.\/base\/BaseParser\.js\.js['"]/g,
      "from '../base/BaseParser.js'"
    );

    return fixed;
  }

  /**
   * 生成人类可读的验证报告
   */
  static formatReport(result: ValidationResult): string {
    const lines: string[] = [];

    if (result.valid) {
      lines.push('✅ 代码验证通过');
    } else {
      lines.push('❌ 代码验证失败');
    }

    for (const err of result.errors) {
      const loc = err.line ? ` (行 ${err.line}:${err.column})` : '';
      lines.push(`  ❌ [${err.type}]${loc} ${err.message}`);
    }

    for (const warn of result.warnings) {
      lines.push(`  ⚠️  [${warn.type}] ${warn.message}`);
    }

    return lines.join('\n');
  }

  /**
   * 生成重试提示（将验证错误转为 LLM 可理解的反馈）
   */
  static generateRetryPrompt(code: string, result: ValidationResult): string {
    const lines: string[] = [];
    lines.push('你生成的代码有以下问题，请修复后重新输出完整代码：\n');

    for (const err of result.errors) {
      const loc = err.line ? ` (行 ${err.line})` : '';
      lines.push(`- ${err.message}${loc}`);
    }

    for (const warn of result.warnings) {
      lines.push(`- [警告] ${warn.message}`);
    }

    lines.push('\n请修复上述问题，重新输出完整的 JavaScript 解析器代码。');
    lines.push('注意：只返回纯 JavaScript 代码，不要包含 ``` 标记。');

    return lines.join('\n');
  }
}
