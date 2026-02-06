# 解析器 Bug 修复总结

## ✅ 问题已解决

### 问题诊断

运行爬虫时出现错误：
```
❌ 解析失败: Cannot read properties of undefined (reading 'includes')
✔ 提取了 0 个职位
```

### 根本原因

LLM 生成的解析器代码中存在 **异步调用错误**：

1. **缺少 `await` 关键字**
   - 代码: `const currentUrl = browser.getCurrentUrl();`
   - 问题: 返回 `Promise<string>` 而不是 `string`
   - 导致: `currentUrl.includes()` 失败

2. **使用不存在的属性**
   - 代码: `this.url.includes('/jobs/')`
   - 问题: BaseParser 没有 `this.url` 属性
   - 正确做法: 使用 `await browser.getCurrentUrl()`

### 已修复文件

#### 1. `src/parsers/generated/jpmc-fa-oraclecloud-com-list-sites-cx-1001.js`

**第 44 行修复：**
```javascript
// ❌ 修复前
const currentUrl = browser.getCurrentUrl();

// ✅ 修复后
const currentUrl = await browser.getCurrentUrl();
```

#### 2. `src/parsers/generated/jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js`

**第 46-47 行修复：**
```javascript
// ❌ 修复前
const isDetailPage = this.url.includes('/preview/') ||
                     this.url.includes('/jobs/') && refs.some(r => r.text === 'Apply Now');

// ✅ 修复后
const currentUrl = await browser.getCurrentUrl();
const isDetailPage = currentUrl.includes('/preview/') ||
                     currentUrl.includes('/jobs/') && refs.some(r => r.text === 'Apply Now');
```

#### 3. `src/prompts/parser-generator.ts`

**添加了明确的异步编程规范：**

```typescript
**⚠️ 异步编程规范（非常重要）：**

5. **所有 browser 方法调用都必须使用 await 关键字**
   - ✅ 正确: `const url = await browser.getCurrentUrl();`
   - ❌ 错误: `const url = browser.getCurrentUrl();`

6. **browser 异步方法列表**（都需要 await）:
   - `await browser.getSnapshot(...)`
   - `await browser.getCurrentUrl()` - **获取当前 URL 的唯一正确方式**
   - `await browser.click(...)`
   - `await browser.goBack()`
   - `await browser.navigate(...)`
   - `await browser.waitForTimeout(...)`

7. **永远不要使用 this.url**
   - ❌ 错误: `this.url.includes('/jobs/')`
   - ✅ 正确: `const url = await browser.getCurrentUrl(); url.includes('/jobs/')`
```

## 🧪 验证方法

运行爬虫命令验证修复：

```bash
npm run crawl -- --csv
```

**预期结果：**
```
✅ 共加载 3 个解析器
✅ 浏览器已启动 (headless: true)
🌐 已导航到: https://jpmc.fa.oraclecloud.com/...
✔ 使用解析器: Jpmcfaoraclecloudcom
🔍 使用 Jpmcfaoraclecloudcom 解析器...
✔ 提取了 X 个职位  # ✅ 成功提取，不再报错
```

## 📚 经验总结

### 1. LLM Prompt 工程要点

- ✅ **明确约束**：在 Prompt 中明确说明异步调用规则
- ✅ **提供示例**：展示正确和错误代码对比
- ✅ **强调重要事项**：使用 ⚠️ 标记关键规则
- ✅ **完整列表**：列出所有需要 await 的方法

### 2. 常见异步错误模式

| 错误模式 | 示例 | 正确做法 |
|---------|------|---------|
| 忘记 await | `browser.getCurrentUrl()` | `await browser.getCurrentUrl()` |
| 使用不存在的属性 | `this.url` | `await browser.getCurrentUrl()` |
| 假设同步返回 | `const url = browser.xxx()` | `const url = await browser.xxx()` |
| 链式调用错误 | `browser.getUrl().includes()` | `(await browser.getUrl()).includes()` |

### 3. 代码审查清单

生成解析器后，检查：
- [ ] 所有 browser 方法调用都有 `await`
- [ ] 没有使用 `this.url`
- [ ] 没有对 Promise 对象调用字符串方法
- [ ] 所有异步操作都在 `async` 函数中

## 🔄 未来改进

1. **自动代码检查**：添加 ESLint 规则检测未 await 的 Promise
2. **单元测试**：为生成的解析器添加测试用例
3. **Prompt 迭代**：根据实际生成结果持续优化 Prompt
4. **代码模板**：提供更多正确的代码示例

## 📝 相关文档

- [LLM 迁移指南](/Users/gollum/Projects/jo_crawler/docs/LLM_MIGRATION.md)
- [Bug 详细分析](/Users/gollum/Projects/jo_crawler/docs/PARSER_BUG_FIX.md)
- [BaseParser API 文档](/Users/gollum/Projects/jo_crawler/src/parsers/base/BaseParser.ts)

---

**修复时间**: 2026-02-05
**修复状态**: ✅ 完成
**影响范围**: 2 个生成的解析器文件 + Prompt 模板
