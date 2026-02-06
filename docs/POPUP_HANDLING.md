# 弹窗处理

## 问题说明

许多现代网站使用各种弹窗和横幅，包括：

1. **Cookie 同意横幅**（Cookie Consent Banner）
   - 符合 GDPR 和其他隐私法规
   - 覆盖在页面内容上方
   - 拦截所有点击事件

2. **满意度调查弹窗**（Satisfaction Surveys）
   - 收集用户反馈
   - 阻止页面交互
   - 常见于企业网站（SAP、Capgemini 等）

这些弹窗会阻止自动化工具正常操作。

## 解决方案

系统现在会自动处理常见的弹窗，包括：

### 1. 调查弹窗（优先处理）

- **Bowen & Craggs** (SAP 等使用)
  - `#JSQuestion` - 调查对话框
  - `#JSOverlay` - 遮罩层
  - 关闭按钮: "Close", "No thanks", "Not now", "×"

- **Qualtrics**
  - `.qualtrics-survey-css-close`

- **通用模式**
  - `div[role="alertdialog"]` 中的关闭按钮
  - `div[role="dialog"]` 中的关闭按钮
  - 包含 "survey" 的元素中的关闭按钮

### 2. Cookie 横幅

- **TrustArc** (Capgemini 等使用)
  - 选择器: `#truste-consent-button`, `#truste-consent-required`

- **OneTrust**
  - 选择器: `#onetrust-accept-btn-handler`, `#accept-recommended-btn-handler`

- **CookieBot**
  - 选择器: `#CybotCookiebotDialogBodyButtonAccept`

- **通用模式**
  - 按钮文本包含: "Accept", "Accept All", "Accept Cookies", "I Agree", "Agree"
  - 类名/ID 包含: "cookie", "consent"

## 处理策略

系统按以下优先级处理弹窗：

### 1. 调查弹窗优先（最高优先级）
- CSS 选择器查找并点击关闭按钮
- JavaScript 移除 DOM 元素

### 2. Cookie 横幅（第二优先级）
- CSS 选择器直接点击
- JavaScript 评估查找并点击
- 通用文本匹配

### 3. JavaScript 强制移除（最后手段）
- 当点击失败时直接移除 DOM 元素

## 自动触发时机

弹窗会在以下情况自动处理：

### 1. 页面导航后
- `navigate()` 方法执行后
- `navigateWithRetry()` 方法执行后

### 2. 点击操作前
- `click()` 方法执行前
- 防止弹窗遮挡目标元素

## 实现原理

```typescript
async dismissCookieBanner(): Promise<boolean> {
  // 1. 优先处理调查弹窗
  // 2. 然后处理 Cookie 横幅
  // 3. 最后使用 JavaScript 强制移除
  // 返回是否成功关闭
}
```

## 使用示例

### 自动处理（默认）

无需任何额外操作，系统会自动处理：

```typescript
await browser.navigate(url);
// Cookie 横幅和调查弹窗自动关闭 ✅

await browser.click('@e97');
// 点击前自动检查并关闭弹窗 ✅
```

### 手动处理（可选）

如果需要手动控制：

```typescript
// 导航到页面
await browser.navigate(url);

// 手动关闭弹窗
const dismissed = await browser.dismissCookieBanner();
if (dismissed) {
  console.log('弹窗已关闭');
}

// 继续操作
await browser.click('@e97');
```

## 日志输出

成功关闭弹窗时会显示：

**调查弹窗**：
```
✅ 已关闭调查弹窗 (使用选择器: #JSQuestion button:has-text("Close"))
```

或

```
✅ 已关闭调查弹窗 (通过 JavaScript: Survey modal (removed))
```

**Cookie 横幅**：
```
✅ 已关闭 Cookie 横幅 (使用选择器: #truste-consent-button)
```

或

```
✅ 已关闭 Cookie 横幅 (通过 JavaScript: TrustArc)
```

## 故障排除

### 弹窗仍然存在

如果弹窗没有被自动关闭：

1. **检查选择器**
   - 查看网站的弹窗 HTML 结构
   - 在 `dismissCookieBanner()` 方法中添加对应的选择器

2. **增加延迟**
   ```typescript
   await browser.navigate(url);
   await browser.waitForTimeout(2000); // 等待弹窗加载
   await browser.dismissCookieBanner();
   ```

3. **使用 JavaScript**
   - 如果选择器方法失败，JavaScript 方法会自动尝试
   - 直接移除 DOM 元素

### 点击仍然被拦截

如果 `dismissCookieBanner()` 失败：

1. **检查是否是动态加载的弹窗**
   ```typescript
   await browser.navigate(url);
   await browser.waitForTimeout(3000); // 等待更长时间
   await browser.dismissCookieBanner();
   ```

2. **手动添加特定网站的选择器**
   - 编辑 `src/services/BrowserService.ts`
   - 在 `surveySelectors` 或 `cookieBannerSelectors` 数组中添加

3. **多次尝试**
   ```typescript
   // 某些网站会多次显示弹窗
   await browser.dismissCookieBanner();
   await browser.waitForTimeout(1000);
   await browser.dismissCookieBanner(); // 再次尝试
   ```

## 添加新的弹窗支持

在 `src/services/BrowserService.ts` 的 `dismissCookieBanner()` 方法中添加：

### 添加调查弹窗

```typescript
const surveySelectors = [
  // ... 现有选择器

  // 新网站
  '#your-new-survey-modal',
  '.your-new-site-survey button:has-text("Close")',
];
```

### 添加 Cookie 横幅

```typescript
const cookieBannerSelectors = [
  // ... 现有选择器

  // 新网站
  '.your-new-site-cookie-button',
  '[data-cookie-accept]',
];
```

### 添加 JavaScript 处理

```typescript
const result = await page.evaluate(`
  // ... 现有逻辑

  // 新增处理
  const yourModal = document.querySelector('#your-modal');
  if (yourModal) {
    yourModal.remove();
    return 'Your modal';
  }

  return null;
`);
```

## 技术细节

### 优先级策略

1. **调查弹窗优先**（最紧急）
   - 完全阻止所有交互
   - 必须先处理

2. **Cookie 横幅**（次要）
   - 可能会阻止部分操作
   - 但通常不会完全阻止

3. **通用模式**（最后）
   - 文本匹配
   - 覆盖率最广但可能误点

### 性能影响

- **成功关闭**: ~500ms 额外延迟
- **未找到弹窗**: ~100ms 检查时间
- **总体影响**: 可忽略不计

### 兼容性

- ✅ Playwright 原生选择器
- ✅ CSS 选择器
- ✅ JavaScript DOM 操作
- ✅ 文本匹配选择器

## 相关文件

- `src/services/BrowserService.ts` - 弹窗处理实现
- `src/services/ParserGenerator.ts` - 解析器生成器
- `src/commands/crawl.ts` - 爬虫命令

## 参考资料

- [Playwright: Evaluate JavaScript](https://playwright.dev/docs/emulation#javascript-evaluation)
- [GDPR Cookie Consent](https://www.cookieyes.com/gdpr-cookie-consent/)
- [TrustArc Cookie Consent](https://www.trustarc.com/)
- [Bowen & Craggs Surveys](https://www.bowencraggs.com/)

## 实际案例

### SAP 网站调查弹窗

**问题**：SAP 职位页面显示 Bowen & Craggs 满意度调查
**解决**：自动点击 "No thanks" 或移除 `#JSQuestion` 元素
**结果**：✅ 成功关闭，继续正常爬取

### Capgemini Cookie 横幅

**问题**：TrustArc Cookie 横幅覆盖页面
**解决**：自动点击 `#truste-consent-button`
**结果**：✅ 成功关闭，继续正常操作

### 多重弹窗

**问题**：同时存在 Cookie 横幅和调查弹窗
**解决**：按优先级依次处理（调查 -> Cookie）
**结果**：✅ 两个弹窗都被关闭
