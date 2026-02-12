/**
 * LLMClient - 纯 LLM API 通信层
 *
 * 职责：
 * - 统一的 LLM API 调用（支持豆包、GLM等）
 * - 自动重试 + 指数退避
 * - Token 使用跟踪
 * - JSON 响应解析
 */

import axios from 'axios';

// ============================================================================
// Types
// ============================================================================

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMClientConfig {
  apiKey: string;
  apiUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMCallResult {
  content: string;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  requestTime: number;
}

// ============================================================================
// LLMClient
// ============================================================================

export class LLMClient {
  private config: Required<LLMClientConfig>;

  constructor(cfg: LLMClientConfig) {
    this.config = {
      apiKey: cfg.apiKey,
      apiUrl: cfg.apiUrl || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      model: cfg.model || 'doubao-seed-1-6-251015',
      temperature: cfg.temperature ?? 0.7,
      maxTokens: cfg.maxTokens ?? 8000,
    };
  }

  // ---------- public API ----------

  /**
   * 调用 LLM API，自动重试
   * @param messages  对话消息
   * @param retries   最大重试次数（默认 2）
   */
  async call(messages: LLMMessage[], retries = 2): Promise<LLMCallResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.doCall(messages);
      } catch (err: any) {
        lastError = err;
        if (attempt < retries) {
          const backoff = Math.min(1000 * 2 ** attempt, 8000);
          console.warn(`⚠️  LLM 调用失败 (第 ${attempt + 1} 次)，${backoff}ms 后重试...`);
          await this.sleep(backoff);
        }
      }
    }

    throw lastError!;
  }

  /**
   * 调用 LLM 并从结果中解析 JSON 数组
   */
  async callForJsonArray<T = any>(messages: LLMMessage[]): Promise<T[]> {
    const { content } = await this.call(messages);
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    console.warn('⚠️  LLM 返回格式不正确，未找到 JSON 数组');
    return [];
  }

  /**
   * 调用 LLM 并从结果中解析 JSON 对象
   */
  async callForJsonObject<T = Record<string, any>>(messages: LLMMessage[]): Promise<T | null> {
    const { content } = await this.call(messages);
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    console.warn('⚠️  LLM 返回格式不正确，未找到 JSON 对象');
    return null;
  }

  /**
   * 调用 LLM 并提取纯文本（去除 markdown 代码块）
   */
  async callForCode(messages: LLMMessage[]): Promise<LLMCallResult> {
    const result = await this.call(messages);
    const codeBlockMatch = result.content.match(/```(?:javascript)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      result.content = codeBlockMatch[1].trim();
    }
    return result;
  }

  // ---------- internal ----------

  private async doCall(messages: LLMMessage[]): Promise<LLMCallResult> {
    const startTime = Date.now();
    const isDoubao = this.config.apiUrl.includes('volces.com');

    const requestBody: any = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
    };

    if (isDoubao) {
      requestBody.thinking = { type: 'disabled' };
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
      },
    );

    const requestTime = Date.now() - startTime;
    const content = response.data.choices[0]?.message?.content;
    if (!content) {
      throw new Error('LLM API 返回空内容');
    }

    const usage = response.data.usage;
    const provider = isDoubao ? '豆包' : 'GLM';
    console.log(`📊 ${provider} Token: ${usage.prompt_tokens} + ${usage.completion_tokens} = ${usage.total_tokens}`);

    return { content, usage, requestTime };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
