# 解析器生成 Bug 修复报告

## 问题描述

运行爬虫时出现错误：
```
❌ 解析失败: Cannot read properties of undefined (reading 'includes')
```

## 根本原因

生成的解析器代码中存在 **两个关键错误**：

### 错误 1：缺少 `await` 关键字

**文件**: `jpmc-fa-oraclecloud-com-list-sites-cx-1001.js:44`

```javascript
// ❌ 错误代码
const currentUrl = browser.getCurrentUrl();  // 返回 Promise<string>
const isDetailPage = currentUrl.includes('/job/');  // Promise 没有 .includes() 方法

// ✅ 正确代码
const currentUrl = await browser.getCurrentUrl();
const isDetailPage = currentUrl.includes('/job/');
```

**原因**: `getCurrentUrl()` 是异步方法，返回 `Promise<string>`，不使用 `await` 会导致变量是 Promise 对象而不是字符串。

### 错误 2：使用不存在的属性

**文件**: `jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js:46`

```javascript
// ❌ 错误代码
const isDetailPage = this.url.includes('/preview/');  // this.url 不存在

// ✅ 正确代码
const currentUrl = await browser.getCurrentUrl();
const isDetailPage = currentUrl.includes('/preview/');
```

**原因**: BaseParser 类没有 `this.url` 属性。

## 已修复

✅ **文件 1**: `src/parsers/generated/jpmc-fa-oraclecloud-com-list-sites-cx-1001.js`
- 第 44 行：添加 `await` 关键字

## 待修复

⚠️ **文件 2**: `src/parsers/generated/jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js`
- 第 46-47 行：需要将 `this.url` 改为 `await browser.getCurrentUrl()`

## 修复文件 2

执行以下修复：

```javascript
// 第 44-47 行
// 判断页面类型：URL 包含 preview 或 jobs/ 且 ID 较长通常为详情页
// 或者根据页面特征判断（如是否有 Apply 按钮）
- const isDetailPage = this.url.includes('/preview/') ||
-                      this.url.includes('/jobs/') && refs.some(r => r.text === 'Apply Now');
+ const currentUrl = await browser.getCurrentUrl();
+ const isDetailPage = currentUrl.includes('/preview/') ||
+                      currentUrl.includes('/jobs/') && refs.some(r => r.text === 'Apply Now');
```

## 根本解决方案：优化 Prompt

为了避免未来 LLM 生成类似的错误代码，需要在 Prompt 中明确强调异步调用的规则。

### 建议的 Prompt 优化

在 `src/prompts/parser-generator.ts` 的模板中添加：

```typescript
**代码规范（必须遵守）:**

1. **所有 browser 方法调用都必须使用 await**
   - ✅ 正确: `const url = await browser.getCurrentUrl();`
   - ❌ 错误: `const url = browser.getCurrentUrl();`

2. **browser 异步方法列表**（都需要 await）:
   - `await browser.getSnapshot(...)`
   - `await browser.getCurrentUrl()`
   - `await browser.click(...)`
   - `await browser.goBack()`
   - `await browser.navigate(...)`
   - `await browser.waitForTimeout(...)`

3. **不要使用 this.url**
   - ❌ 错误: `this.url`
   - ✅ 正确: `await browser.getCurrentUrl()`

4. **页面类型判断示例**:
   \`\`\`javascript
   // 正确的页面类型判断
   const currentUrl = await browser.getCurrentUrl();
   const isDetailPage = currentUrl.includes('/preview/') || currentUrl.includes('/job/');
   \`\`\`
```

### 更新系统提示词

在 PARSER_GENERATOR_SYSTEM 中添加：

```typescript
**异步编程规范**:
- browser 对象的所有方法都是异步的，必须使用 await
- 永远不要假设 browser 方法返回的是同步值
- 如果需要获取 URL，必须使用: `await browser.getCurrentUrl()`
```

## 验证修复

修复后，运行以下命令验证：

```bash
# 测试爬取功能
npm run crawl -- --csv
```

预期输出：
```
✅ 共加载 3 个解析器
✅ 浏览器已启动 (headless: true)
🌐 已导航到: https://jpmc.fa.oraclecloud.com/...
✔ 使用解析器: Jpmcfaoraclecloudcom
🔍 使用 Jpmcfaoraclecloudcom 解析器...
✔ 提取了 X 个职位  # 不再报错
```

## 学习总结

1. **LLM 需要更明确的约束**：异步调用规则必须在 Prompt 中明确说明
2. **示例代码很重要**：提供正确使用 `await` 的完整示例
3. **常见错误模式**：
   - 忘记 `await` 关键字
   - 使用不存在的属性（如 `this.url`）
   - 假设异步方法返回同步值

## 相关文件

- `/Users/gollum/Projects/jo_crawler/src/parsers/generated/jpmc-fa-oraclecloud-com-list-sites-cx-1001.js` - ✅ 已修复
- `/Users/gollum/Projects/jo_crawler/src/parsers/generated/jpmc-fa-oraclecloud-com-detail-sites-cx-1001.js` - ⚠️ 待修复
- `/Users/gollum/Projects/jo_crawler/src/prompts/parser-generator.ts` - 需要优化 Prompt
- `/Users/gollum/Projects/jo_crawler/src/parsers/base/BaseParser.ts` - 参考：正确使用 await
