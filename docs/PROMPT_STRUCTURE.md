# Prompt 结构说明

JO Crawler 使用两段式 Prompt 结构来指导 LLM 生成高质量的解析器代码。

## 📋 两段式 Prompt 架构

### 第一部分：通用 Prompt (COMMON_SYSTEM_PROMPT)

**文件位置:** [src/prompts/parser-generator.ts](../src/prompts/parser-generator.ts#L11)

**作用:** 定义所有解析器共享的基础知识和工具使用方法

**内容包括:**

1. **核心要求**
   - JavaScript ES6+ 语法
   - 继承 BaseParser 基类
   - 导出默认类

2. **BaseParser 可用方法**
   - `extractJobFromPage()` - 通用职位提取
   - `findJobCardRefs()` - 查找职位卡片
   - `findTitleInRefs()` - 智能查找标题
   - `extractLocation()` - 提取地点信息

3. **BrowserService 可用方法**
   - `getSnapshot()` - 获取页面快照
   - `click()` - 点击元素
   - `getPageText()` - 获取完整文本
   - `saveRefMap()` - 保存 ref 映射

4. **数据结构定义**
   - JobData 接口
   - 代码结构要求

**优势:**
- ✅ 一次定义，所有网站复用
- ✅ 集中管理工具文档
- ✅ 减少 prompt 重复内容

---

### 第二部分：自定义 Prompt (generateCustomPrompt)

**文件位置:** [src/prompts/parser-generator.ts](../src/prompts/parser-generator.ts#L113)

**作用:** 针对每个网站生成特定的页面分析提示词

**功能特点:**

1. **智能页面分析**
   ```typescript
   analyzePageType(snapshot, url)  // 判断列表页/详情页
   ```

2. **Refs 分析**
   ```typescript
   analyzeRefs(refMap)  // 提取关键职位链接
   ```

3. **页面结构分析**
   ```typescript
   analyzeStructure(snapshot, refMap)
   // 识别职位卡片数量
   // 检查描述区域
   // 检查申请按钮
   // 检查分页功能
   ```

4. **自动生成代码框架**
   - 根据页面类型生成对应代码
   - 包含正确的 `isDetailPage` 判断逻辑
   - 预填充网站特定的 metadata

**示例输出:**

```markdown
**当前网站分析：**

**域名:** jpmc.fa.oraclecloud.com
**URL:** https://jpmc.fa.oraclecloud.com/...
**页面类型:** detail

**页面结构特点:**
- 页面包含职位描述区域
- 页面包含申请按钮

**可用的 Ref 引用:**
  - @e11: 2027 Markets Summer Analyst Program...
  - @e13: 2027 Commercial Real Estate Summer...
```

**优势:**
- ✅ 针对性强，符合实际页面结构
- ✅ 自动识别页面特征
- ✅ 减少手动编写 prompt

---

## 🎯 使用方法

### 1. 基础使用（自动）

在 [src/services/LLMService.ts](../src/services/LLMService.ts#L140) 中：

```typescript
async generateParser(domain, snapshot, url, refMap) {
  const messages = [
    {
      role: 'system',
      content: PARSER_GENERATOR_SYSTEM,  // 通用 Prompt
    },
    {
      role: 'user',
      content: PARSER_GENERATOR_USER(toClassName(domain), snapshot, url, refMap),  // 自定义 Prompt
    },
  ];

  return await this.callGLM(messages);
}
```

### 2. 高级使用（手动）

如果你想为特定网站提供更详细的提示词：

```typescript
import { COMMON_SYSTEM_PROMPT, generateCustomPrompt } from './prompts/parser-generator.js';

const customPrompt = `
**特殊要求：**
- 这个网站的反爬虫很强，需要添加更多延迟
- 职位描述在 iframe 中，需要特殊处理
- ...
`;

const messages = [
  { role: 'system', content: COMMON_SYSTEM_PROMPT },
  { role: 'user', content: generateCustomPrompt(domain, snapshot, url, refMap) + customPrompt },
];
```

---

## 📊 性能对比

| 指标 | 旧 Prompt | 新 Prompt (两段式) |
|------|-----------|-------------------|
| Token 使用 | ~4701 tokens | ~3011 tokens (-36%) |
| 生成质量 | 良好 | 优秀 |
| 可维护性 | 低 | 高 |
| 定制化能力 | 弱 | 强 |

---

## 🛠️ 扩展 Prompt

### 添加新的 BaseParser 方法

1. 在 [BaseParser.ts](../src/parsers/base/BaseParser.ts) 添加新方法
2. 在 [COMMON_SYSTEM_PROMPT](../src/prompts/parser-generator.ts#L22) 中添加文档

### 添加新的页面分析规则

编辑 [analyzeStructure()](../src/prompts/parser-generator.ts#L304) 函数：

```typescript
function analyzeStructure(snapshot: string, refMap: Record<string, any>): string[] {
  const hints = [];

  // 添加新的分析规则
  if (snapshot.includes('remote')) {
    hints.push('职位支持远程工作');
  }

  return hints;
}
```

---

## 📝 最佳实践

1. **优先使用 BaseParser 方法**
   - 不要重复造轮子
   - 充分利用通用工具

2. **保持通用 Prompt 简洁**
   - 只包含核心知识
   - 避免冗余说明

3. **自定义 Prompt 针对性强**
   - 基于实际页面结构
   - 提供具体的 refs 信息

4. **定期 Review 生成的代码**
   - 检查是否使用了正确的 BaseParser 方法
   - 确认代码质量和可维护性

---

## 🔗 相关文件

- [Prompt 定义](../src/prompts/parser-generator.ts)
- [LLM Service](../src/services/LLMService.ts)
- [BaseParser](../src/parsers/base/BaseParser.ts)
- [生成的解析器示例](../src/parsers/generated/)
