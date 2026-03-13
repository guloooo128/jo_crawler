# jo_crawler 配置文件生成操作文档

本文档详细说明如何为新的招聘站点生成爬虫配置文件，包括**自动生成**和**手动生成**两种方式。

---

## 目录

- [前置准备](#前置准备)
- [方式一：全自动生成（推荐）](#方式一全自动生成推荐)
  - [单个 URL 自动生成](#1-单个-url-自动生成)
  - [批量 URL 自动生成](#2-批量-url-自动生成)
  - [运行时自动生成（懒人模式）](#3-运行时自动生成懒人模式)
- [方式二：半自动生成（LLM 辅助）](#方式二半自动生成llm-辅助)
  - [从文件读取 DOM](#1-从文件读取-dom)
  - [从剪贴板读取 DOM](#2-从剪贴板读取-dom)
  - [通过脚本测试生成](#3-通过脚本测试生成)
- [方式三：纯手动编写配置文件](#方式三纯手动编写配置文件)
  - [第 1 步：分析页面结构](#第-1-步分析页面结构)
  - [第 2 步：判断 URL 获取方式](#第-2-步判断-url-获取方式)
  - [第 3 步：编写 JSON 配置文件](#第-3-步编写-json-配置文件)
- [配置文件字段详解](#配置文件字段详解)
- [反爬与隐身机制](#反爬与隐身机制)
- [详情页配置生成](#详情页配置生成)
- [验证与调试](#验证与调试)
- [常见问题](#常见问题)

---

## 前置准备

```bash
# 确保已安装依赖
pip install playwright requests
playwright install chromium
```

项目目录结构：
```
jo_crawler/
├── run.py               # 爬虫入口脚本（支持自动生成配置）
├── auto_gen.py          # 全自动配置生成器
├── gen_config.py        # 半自动配置生成器（需要手动提供 DOM）
├── test_gen.py          # 测试脚本（粘贴 DOM 快速测试）
├── crawler.py           # 爬虫引擎
├── dom_extractor.py     # DOM 结构检测器
├── browser_service.py   # 浏览器服务
└── config/              # 配置文件目录（每个站点一个 JSON）
    ├── aidc-jobs_alibaba_com.json
    ├── careers_shopee_sg.json
    └── ...
```

---

## 方式一：全自动生成（推荐）

使用 `auto_gen.py`，只需提供 URL，程序会自动：打开页面 → 检测职位列表容器 → 调用 LLM 生成配置 → 保存到 `config/` 目录。

### 1. 单个 URL 自动生成

```bash
# 基本用法
python auto_gen.py "https://careers.example.com/jobs"

# 使用有头浏览器（可视化调试，可以看到浏览器操作过程）
python auto_gen.py "https://careers.example.com/jobs" --headed

# 同时生成详情页配置（自动取第一个职位 URL 进入详情页分析）
python auto_gen.py "https://careers.example.com/jobs" --detail

# 指定输出路径（额外保存一份到自定义位置）
python auto_gen.py "https://careers.example.com/jobs" --output my_config.json
```

**自动生成的过程：**

```
  [自动生成] 打开页面: https://careers.example.com/jobs
  [自动生成] 等待页面加载...
  [自动生成] 滚动触发懒加载...
  [自动生成] 分析页面结构...
  [自动生成] 检测到 3 个候选容器:
    [0] .job-list  (20 个 <div>, 评分 95)
    [1] .sidebar   (5 个 <li>, 评分 40)
    [2] nav.menu   (8 个 <a>, 评分 30)
  高置信度直接采用候选 0: 评分 95, 20 个子元素
  [自动生成] 调用 LLM 生成配置...
  [自动生成] 配置已保存: config/careers_example_com.json
```

**配置文件自动命名规则：** 域名中的 `.` 替换为 `_`，如：
- `careers.example.com` → `careers_example_com.json`
- `aidc-jobs.alibaba.com` → `aidc-jobs_alibaba_com.json`

### 2. 批量 URL 自动生成

先准备一个 URL 文件（每行一个 URL，`#` 开头为注释）：

```bash
# urls.txt
https://careers.example.com/jobs
https://jobs.another.com/positions
# 下面这个先跳过
# https://hr.skip.com/openings
```

```bash
# 批量生成（已有配置的 URL 会自动跳过）
python auto_gen.py --batch urls.txt

# 有头模式批量生成
python auto_gen.py --batch urls.txt --headed
```

**输出示例：**
```
读取到 2 个 URL

[1/2] 生成配置: https://careers.example.com/jobs
  [自动生成] 打开页面...
  [自动生成] 配置已保存: config/careers_example_com.json

[2/2] 跳过 (已有配置): jobs.another.com

========================================
批量生成完成: 成功 1, 失败 0, 跳过 1, 共 2
```

### 3. 运行时自动生成（懒人模式）

使用 `run.py` 爬取时，如果找不到对应配置文件，会**自动触发配置生成**，生成后直接开始爬取：

```bash
# 自动匹配配置，无配置则自动生成后爬取
python run.py "https://careers.example.com/jobs"

# 如果不想自动生成，加 --no-auto
python run.py "https://careers.example.com/jobs" --no-auto
```

**批量爬取时也支持自动生成：**
```bash
python run.py --batch urls.txt --output results.json
# 每个 URL 先查本地配置，没有就自动生成，然后爬取
```

---

## 方式二：半自动生成（LLM 辅助）

当自动生成失败时（页面结构复杂、需要登录、反爬严格等），可以**手动获取页面 DOM**，然后让 LLM 分析生成配置。

### 操作步骤

1. 在浏览器中打开目标招聘页面
2. 按 `F12` 打开开发者工具
3. 在 Elements 面板中，找到包含职位列表的 **父容器元素**
4. 右键该元素 → **Copy** → **Copy outerHTML**
5. 将 HTML 保存到文件（如 `dom.html`）

> **提示：** 不需要复制整个页面的 HTML，只需要复制包含职位列表区域的 HTML 片段即可。复制 2-3 个职位卡片的 HTML 就足够 LLM 分析。

### 1. 从文件读取 DOM

```bash
# 将复制的 HTML 保存为 dom.html，然后运行：
python gen_config.py --url "https://careers.example.com/jobs" --file dom.html

# 指定输出路径
python gen_config.py --url "https://careers.example.com/jobs" --file dom.html --output config/my_site.json
```

### 2. 从剪贴板读取 DOM（macOS）

```bash
# 复制 HTML 后直接运行（macOS 使用 pbpaste）
pbpaste | python gen_config.py --url "https://careers.example.com/jobs"
```

### 3. 通过脚本测试生成

适合需要反复调试的场景。编辑 `test_gen.py` 中的 `URL` 和 `DOM` 变量：

```python
# test_gen.py
URL = "https://careers.example.com/jobs"

DOM = """
<div class="job-list">
  <div class="job-card">
    <a href="/jobs/123">
      <h3 class="title">Software Engineer</h3>
      <span class="location">Beijing</span>
    </a>
  </div>
  <div class="job-card">
    <a href="/jobs/456">
      <h3 class="title">Product Manager</h3>
      <span class="location">Shanghai</span>
    </a>
  </div>
</div>
"""
```

然后运行：
```bash
python test_gen.py
```

程序会调用 LLM 分析 DOM，生成配置文件并保存到 `config/` 目录。

---

## 方式三：纯手动编写配置文件

完全不依赖 LLM，自己分析页面结构并手写 JSON 配置。

### 第 1 步：分析页面结构

1. 打开目标招聘页面，按 `F12` 打开开发者工具
2. 使用 **元素选择器**（点击 Elements 面板左上角的箭头图标）点击一个职位卡片
3. 观察 HTML 结构，找到：
   - **卡片选择器**：能选中所有职位卡片的 CSS 选择器
   - **字段子选择器**：卡片内各字段（标题、地点等）的 CSS 选择器

4. 在 Console 中验证：

```javascript
// 验证卡片选择器（结果数量应等于页面上的职位数）
document.querySelectorAll('你的卡片选择器').length

// 验证标题字段
document.querySelectorAll('你的卡片选择器')[0]
  .querySelector('标题子选择器')?.textContent

// 验证地点字段
document.querySelectorAll('你的卡片选择器')[0]
  .querySelector('地点子选择器')?.textContent
```

### 第 2 步：判断 URL 获取方式

点击一个职位卡片，观察浏览器行为：

| 观察到的行为 | `url_mode` 值 | 典型场景 |
|-------------|--------------|---------|
| 卡片是 `<a>` 标签或内部有 `<a>` 子元素 | `"href"` | 大多数传统站点 |
| 点击后打开了**新标签页** | `"click_newtab"` | SPA 站点、React/Vue 应用 |
| 点击后**当前页面跳转** | `"click_navigate"` | SPA 路由跳转 |
| URL 存在 `data-url` 等自定义属性中 | `"attr:data-url"` | 自定义组件 |
| 无需获取 URL | `"none"` | 只需要列表数据 |

> **注意：** 很多 SPA 站点会用 `<a>` 标签但**不给 href 或 href 为空**，这种情况必须用 `"click_newtab"` 而不是 `"href"`。

### 第 3 步：编写 JSON 配置文件

在 `config/` 目录下创建 JSON 文件，命名规则：`域名.json`（点号替换为下划线）。

**最简配置（只需 4 个字段）：**

```json
{
  "domain": "careers.example.com",
  "card_selector": ".job-card",
  "fields": {
    "title": ".job-title"
  },
  "url_mode": "href"
}
```

**完整配置示例：**

```json
{
  "domain": "careers.example.com",
  "name": "Example公司招聘",

  "card_selector": ".job-list > .job-item",

  "fields": {
    "title": ".job-title",
    "location": ".location",
    "department": ".department",
    "date": ".post-date",
    "category": ".job-type"
  },

  "url_mode": "href",
  "url_selector": "a",
  "wait_after_click_ms": 2000,

  "pre_actions": [
    {"action": "wait_for_content", "timeout_ms": 15000}
  ],

  "pagination": {
    "mode": "click_next",
    "next_selector": "button.next-page",
    "wait_ms": 2000
  },

  "fetch_detail": false,

  "detail": {
    "container_selector": ".job-details",
    "fields": {
      "description": ".job-description",
      "requirements": ".requirements-section",
      "salary": ".compensation"
    },
    "wait_ms": 2000,
    "pre_actions": []
  }
}
```

---

## 配置文件字段详解

### 基础字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `domain` | 是 | 站点域名，用于自动匹配 URL。如 `"careers.example.com"` |
| `name` | 否 | 站点中文描述，方便识别。如 `"阿里巴巴国际校招"` |
| `card_selector` | 是 | 职位卡片的 CSS 选择器。如 `".job-card"`、`"div[class*='HDMvPV']"` |
| `fields` | 是 | 字段映射表，`title` 为必填子字段 |
| `url_mode` | 是 | URL 获取方式：`href` / `click_newtab` / `click_navigate` / `attr:属性名` / `none` |

### URL 相关字段

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `url_selector` | `null` | 从卡片内哪个子元素取 URL 或触发点击。如 `"a"`、`".detail-btn"` |
| `wait_after_click_ms` | `2000` | click 模式下点击后等待的毫秒数 |

### 预操作（pre_actions）

在提取卡片前执行的操作列表：

```json
"pre_actions": [
  {"action": "wait_for_content", "timeout_ms": 20000},
  {"action": "scroll", "times": 5},
  {"action": "wait", "ms": 2000},
  {"action": "click", "selector": ".load-all-jobs", "wait_ms": 1500},
  {"action": "dismiss_popup"}
]
```

| action | 参数 | 说明 |
|--------|------|------|
| `wait_for_content` | `timeout_ms` | 等待页面 DOM 稳定 |
| `wait` | `ms` | 固定等待毫秒数 |
| `scroll` | `times` | 滚动页面 N 次（触发懒加载） |
| `click` | `selector`, `wait_ms` | 点击指定元素（如"展开全部"按钮） |
| `dismiss_popup` | 无 | 尝试关闭弹窗/Cookie 横幅 |

### 翻页配置（pagination）

翻页通常会被自动检测，但也可以手动指定：

```json
"pagination": {
  "mode": "click_next",
  "next_selector": "button.next",
  "wait_ms": 2000
}
```

| mode | 说明 |
|------|------|
| `click_next` | 点击"下一页"按钮 |
| `load_more` | 点击"加载更多"按钮 |
| `scroll` | 滚动到底部触发加载 |

### 详情页抓取

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `fetch_detail` | `false` | 是否抓取详情页内容 |
| `detail` | `{}` | 详情页结构化配置（见下方说明） |

**`detail` 配置块（结构化模式，推荐）：**

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `detail.container_selector` | `"body"` | 详情页主内容区域的 CSS 选择器 |
| `detail.fields` | `{}` | 字段映射表，`description` 为推荐必填字段 |
| `detail.wait_ms` | `2000` | 进入详情页后等待时间 |
| `detail.pre_actions` | `[]` | 详情页预操作（如关闭弹窗、点击展开等） |

当配置中有 `detail.fields` 时，爬虫会按字段结构化提取，结果写入 `job["detail_fields"]`。
没有 `detail.fields` 时，退回整块文本提取模式（兼容旧配置 `detail_selector` / `detail_format` / `detail_wait_ms`）。

### 其他字段

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `headless` | `true` | 是否使用无头浏览器。部分反爬严格的站点需设为 `false` |

---

## 反爬与隐身机制

爬虫内置了以下反检测措施，无需手动配置：

| 措施 | 说明 |
|------|------|
| 真实 User-Agent | 使用 Chrome 131 的真实 UA 字符串 |
| 隐藏 webdriver 标志 | 移除 `navigator.webdriver`，避免被 JS 检测 |
| 禁用自动化特征 | Chromium 启动参数 `--disable-blink-features=AutomationControlled` |
| 伪装浏览器属性 | 注入 `window.chrome`、`navigator.plugins` 等常见属性 |
| 自动关闭 Cookie 弹窗 | 支持 OneTrust、TrustArc、CookieBot 等主流框架，自动点击"Accept" |

**如果无头模式仍被拦截**，在配置中强制使用有头模式：

```json
"headless": false
```

或在命令行加 `--headed` 参数。

---

## 详情页配置生成

详情页配置支持自动生成，跟列表页配置一样，通过打开详情页 → 检测内容容器 → LLM 分析结构 → 按字段生成选择器。

**生成时文本会被截断**（每个叶子节点截断到 30 字符），只保留 DOM 结构传给 LLM，从而将 50KB+ 的详情页压缩到 3-5KB，大幅节省 token。

### 1. 与列表配置同时生成

```bash
# 生成列表配置时同时生成详情页配置
python auto_gen.py "https://careers.example.com/jobs" --detail
```

程序会自动：生成列表配置 → 取第一个职位 URL → 导航到详情页 → 分析结构 → 将 `detail` 配置块写入同一个配置文件。

### 2. 单独为一个详情页生成配置

```bash
# 给定详情页 URL，生成 detail 配置块
python auto_gen.py --detail-url "https://careers.example.com/jobs/12345"

# 保存到文件
python auto_gen.py --detail-url "https://careers.example.com/jobs/12345" --output detail_config.json
```

生成的配置需要手动添加到对应站点配置文件的 `"detail"` 字段中。

### 3. 运行爬虫时自动生成

```bash
# 如果配置中没有 detail 字段，自动生成并保存
python run.py "https://careers.example.com/jobs" --detail --gen-detail -l 5
```

### 生成的 detail 配置示例

```json
{
  "container_selector": "#job-detail-content",
  "fields": {
    "description": ".job-description",
    "responsibilities": ".responsibilities-section",
    "requirements": ".qualifications-list",
    "salary": ".compensation-info",
    "benefits": ".benefits-section"
  },
  "wait_ms": 2000,
  "pre_actions": []
}
```

### 两种提取模式对比

| | 结构化模式（新） | 整块文本模式（旧） |
|---|---|---|
| 配置 | `detail.fields` 定义各字段选择器 | `detail_selector` + `detail_format` |
| 输出 | `job["detail_fields"]` = `{"description": "...", "requirements": "..."}` | `job["detail_content"]` = 整块文本 |
| 优势 | 数据结构清晰，可直接使用 | 简单，不需要分析详情页结构 |
| 适用 | 需要结构化数据的场景 | 只需要原始文本的场景 |

---

## 验证与调试

### 1. 验证配置是否有效

```bash
# 爬取少量职位验证（默认 limit=50）
python run.py "https://careers.example.com/jobs"

# 只爬 5 个快速验证
python run.py "https://careers.example.com/jobs" -l 5

# 指定配置文件
python run.py "https://careers.example.com/jobs" --config config/careers_example_com.json
```

### 2. 有头模式调试

使用 `--headed` 可以看到浏览器的实际操作过程：

```bash
# 自动生成时有头调试
python auto_gen.py "https://careers.example.com/jobs" --headed

# 爬取时有头调试
python run.py "https://careers.example.com/jobs" --headed -l 5
```

### 3. 保存爬取结果

```bash
# 保存为 JSON 文件
python run.py "https://careers.example.com/jobs" --output result.json

# 同时抓取详情页
python run.py "https://careers.example.com/jobs" --detail --output result.json

# 批量爬取并保存
python run.py --batch urls.txt --output batch_results.json
```

### 4. 常见调试技巧

**选择器选不到元素：**
```bash
# 使用有头模式观察页面
python run.py "https://..." --headed -l 1
```
然后在浏览器 Console 中测试选择器：
```javascript
document.querySelectorAll('你的选择器').length
```

**页面需要加载时间：**
在配置中增大 `wait_for_content` 的 `timeout_ms`：
```json
"pre_actions": [
  {"action": "wait_for_content", "timeout_ms": 30000}
]
```

**CSS class 名是混淆的（如随机字符串）：**
使用部分匹配：
```json
"card_selector": "div[class*='HDMvPV']"
```

---

## 常见问题

### Q: 自动生成和手动生成怎么选？

| 场景 | 推荐方式 |
|------|---------|
| 普通招聘页面 | **全自动**（`auto_gen.py` 或 `run.py` 懒人模式） |
| 自动生成失败 | **半自动**（手动复制 DOM，用 `gen_config.py` 生成） |
| 页面需要登录/反爬严格 | 先试 `--headed`，仍不行则**手动编写** JSON 配置 |
| 页面结构特殊 | **半自动** 生成后手动微调 |
| 批量添加站点 | **批量自动**（`auto_gen.py --batch`） |

### Q: 自动生成失败了怎么办？

1. **先用有头模式重试：**
   ```bash
   python auto_gen.py "https://..." --headed
   ```
2. **如果还不行，用半自动方式：**
   在浏览器中手动复制职位列表 HTML，保存为 `dom.html`：
   ```bash
   python gen_config.py --url "https://..." --file dom.html
   ```
3. **LLM 生成的配置不准确：** 手动编辑 `config/` 下的 JSON 文件微调选择器

### Q: 配置文件的域名匹配规则是什么？

`run.py` 会自动匹配配置文件：
1. **精确匹配**：URL 域名 == 配置的 `domain`（忽略 `www.` 前缀）
2. **子域名匹配**：同平台不同子域名（如 `td.wd3.myworkdayjobs.com` 和 `xx.wd3.myworkdayjobs.com` 会匹配同一个配置）

### Q: 怎么处理需要点击"加载更多"才能显示全部职位的页面？

爬虫会**自动检测**翻页按钮（包括"加载更多"和"下一页"）。如果自动检测不到，手动在配置中添加：

```json
"pagination": {
  "mode": "load_more",
  "next_selector": "button.show-more",
  "wait_ms": 2000
}
```

### Q: `click_newtab` 模式太慢？

- 每个卡片需要 3-4 秒（点击→等待→切 tab→读 URL→关 tab）
- 50 个职位约 3 分钟，这是此模式的固有限制
- 使用 `-l` 限制数量：`python run.py "https://..." -l 10`

### Q: 批量爬取支持断点续爬吗？

支持。`run.py --batch` 模式会在每个 URL 爬取完后立即保存结果到输出文件。中断后重新运行相同命令，已处理的 URL 会自动跳过。

---

## 完整操作流程示例

### 示例：为 Alibaba AIDC 生成配置

**方式 A：全自动**
```bash
python auto_gen.py "https://aidc-jobs.alibaba.com/en/campus/position-list?campusType=freshman&lang=en"
# 自动生成 config/aidc-jobs_alibaba_com.json
# 验证
python run.py "https://aidc-jobs.alibaba.com/en/campus/position-list?campusType=freshman&lang=en" -l 5
```

**方式 B：半自动**
```bash
# 1. 浏览器打开页面，F12 复制职位列表 HTML，保存为 dom.html
# 2. 运行
python gen_config.py --url "https://aidc-jobs.alibaba.com/en/campus/position-list" --file dom.html
# 3. 验证
python run.py "https://aidc-jobs.alibaba.com/en/campus/position-list" -l 5
```

**方式 C：纯手动**
```bash
# 1. F12 分析页面，发现卡片是 div[class*='HDMvPV436']
# 2. 创建 config/aidc-jobs_alibaba_com.json：
```
```json
{
  "domain": "aidc-jobs.alibaba.com",
  "name": "阿里巴巴国际校招",
  "card_selector": "div[class*='HDMvPV436']",
  "fields": {
    "title": "div[class*='1wvoPKubL7sI3wAkoHAwiu']",
    "date": "div[class*='1pVljnA']",
    "category": "div[class*='2rGrML8']",
    "location": "div[class*='1-lelHx8']"
  },
  "url_mode": "click_newtab",
  "wait_after_click_ms": 2000,
  "pre_actions": [
    {"action": "wait_for_content", "timeout_ms": 20000}
  ]
}
```
```bash
# 3. 验证
python run.py "https://aidc-jobs.alibaba.com/en/campus/position-list" -l 5
```

---

## 命令速查表

| 操作 | 命令 |
|------|------|
| 全自动生成单个配置 | `python auto_gen.py "URL"` |
| 全自动生成（含详情页） | `python auto_gen.py "URL" --detail` |
| 全自动批量生成 | `python auto_gen.py --batch urls.txt` |
| 单独生成详情页配置 | `python auto_gen.py --detail-url "详情页URL"` |
| 半自动（DOM 文件） | `python gen_config.py --url "URL" --file dom.html` |
| 半自动（剪贴板） | `pbpaste \| python gen_config.py --url "URL"` |
| 脚本测试生成 | 编辑 `test_gen.py` 后运行 `python test_gen.py` |
| 爬取（自动匹配/生成配置） | `python run.py "URL"` |
| 爬取（指定配置） | `python run.py "URL" --config config/xxx.json` |
| 爬取 + 详情页 | `python run.py "URL" --detail -l 10 --output result.json` |
| 爬取 + 自动生成详情配置 | `python run.py "URL" --detail --gen-detail -l 10` |
| 批量爬取 | `python run.py --batch urls.txt --output results.json` |
| 并发批量爬取 | `python run.py --batch urls.txt -j 5 --output results.json` |
| 有头模式调试 | 任意命令加 `--headed` |
