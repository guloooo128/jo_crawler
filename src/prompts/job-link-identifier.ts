/**
 * Job Link Identifier Prompt
 *
 * 用于 LLM 识别快照中的职位链接
 */

/**
 * System Prompt - 识别职位链接
 */
export const JOB_LINK_IDENTIFIER_SYSTEM = `你是一个专业的网页结构分析专家。你需要从页面快照（可访问性树）中识别出哪些是职位卡片的链接。

**职位链接的特征：**

1. **内容特征**：
   - 包含职位名称（如 "Senior Engineer", "Product Manager", "Data Analyst"）
   - 可能包含公司名、地点、职位类型等信息
   - 文本长度通常在 20-150 字符之间

2. **非职位链接（需要排除）**：
   - 导航菜单链接（Home, About, Contact, Careers, Login等）
   - 页脚链接（Privacy Policy, Terms of Use, Cookie Settings等）
   - 功能性链接（Learn More, Read More, Share, Apply, Filter等）
   - 社交媒体链接（Facebook, Twitter, LinkedIn, YouTube等）
   - 学习中心/资源链接（Blog, News, Insights, Podcast等）

**输出格式：**

只返回 JSON 数组，格式如下：
[
  {"ref": "@e12", "name": "职位名称", "reason": "这是职位链接的原因"},
  ...
]

如果没有找到职位链接，返回空数组 []。

**只返回 JSON，不要包含其他文字。**`;

/**
 * User Prompt 生成函数
 */
export function generateJobLinkIdentifierPrompt(
  snapshot: string,
  refs: Record<string, any>,
  customExcludeKeywords?: string[],
  customPrompt?: string
): string {
  // 将 refs 转换为可读格式
  const linksList = Object.entries(refs)
    .filter(([_, info]) => info.role === 'link' && info.name)
    .map(([key, info]) => {
      const name = info.name.substring(0, 120);
      return `  ${key}: "${name}${info.name.length > 120 ? '...' : ''}"`;
    })
    .join('\n');

  const customExclusion = customExcludeKeywords && customExcludeKeywords.length > 0
    ? `\n\n**额外排除关键词：**\n${customExcludeKeywords.join(', ')}`
    : '';

  const customContext = customPrompt
    ? `\n\n**用户自定义提示（重要，请优先参考）：**\n${customPrompt}`
    : '';

  return `URL: (未提供，仅分析快照结构)

**页面快照（可访问性树）- 前 3000 字符：**
\`\`\`
${snapshot.substring(0, 3000)}
\`\`\`

**所有链接元素（refs）：**
${linksList}

**任务：**
从上面的链接元素中，识别出哪些是真正的职位卡片链接。

对于每个识别出的职位链接，返回：
- ref: 元素的 ref ID（如 "@e12"）
- name: 职位名称
- reason: 判断理由（简要说明为什么这是职位链接）

${customExclusion}${customContext}

**只返回 JSON 数组，不要包含其他文字。**`;
}

// 导出生成函数的接口
export const JOB_LINK_IDENTIFIER_USER = (
  snapshot: string,
  refs: Record<string, any>,
  customExcludeKeywords?: string[],
  customPrompt?: string
): string => {
  return generateJobLinkIdentifierPrompt(snapshot, refs, customExcludeKeywords, customPrompt);
};
