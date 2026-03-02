# jo_crawler_v2 配置教程

纯配置驱动的职位爬虫。新增站点只需写一个 JSON 文件，无需改代码。

## 快速开始

```bash
# 用已有配置爬取
python run.py "https://aidc-jobs.alibaba.com/en/campus/position-list?campusType=freshman&lang=en"

# 指定配置文件
python run.py "https://example.com/jobs" --config config/my_site.json

# 批量爬取（每行一个 URL）
python run.py --batch urls.txt --output result.json

# 同时抓取每个职位的详情页内容
python run.py "https://example.com/jobs" --detail --output result.json
```

## 目录结构

```
jo_crawler_v2/
├── run.py               # 入口脚本
├── crawler.py           # 爬虫引擎（不需要改）
├── browser_service.py   # 浏览器服务（不需要改）
└── config/              # 站点配置（你只需要在这里写文件）
    ├── aidc-jobs_alibaba_com.json
    ├── careers_shopee_sg.json
    └── ...
```

---

## 写配置文件的 3 步流程

### 第 1 步：用 F12 分析页面结构

打开目标招聘页面，按 F12 打开开发者工具，找到职位卡片的 HTML 结构。

**你需要找到两样东西：**

1. **卡片的选择器** — 哪个 CSS 选择器能选中所有职位卡片
2. **字段的子选择器** — 卡片内部，职位名称、地点等分别在哪个元素里

**在 Console 里验证：**

```javascript
// 看能选到几个卡片（应该等于页面上的职位数）
document.querySelectorAll('你的卡片选择器').length

// 看第一个卡片的职位名称对不对
document.querySelectorAll('你的卡片选择器')[0]
  .querySelector('标题子选择器')?.textContent
```

### 第 2 步：判断 URL 获取方式

点击一个职位卡片，观察浏览器的行为：

| 你看到的行为 | url_mode |
|-------------|----------|
| 卡片本身就是 `<a>` 标签，有 href 属性 | `"href"` |
| 卡片内部有 `<a>` 子元素 | `"href"` |
| 点击后打开了新标签页 | `"click_newtab"` |
| 点击后当前页跳转到了详情页 | `"click_navigate"` |
| URL 存在 data-href 等自定义属性里 | `"attr:data-href"` |

### 第 3 步：写 JSON 配置文件

文件名：`域名_下划线.json`，放到 `config/` 目录下。

---

## 配置字段参考

```json
{
  "domain":              "必填 | 站点域名，用于自动匹配 URL",
  "name":                "可选 | 站点描述，方便自己识别",

  "card_selector":       "必填 | 职位卡片的 CSS 选择器",

  "fields": {
    "title":             "必填 | 卡片内职位名称的子选择器",
    "其他字段":           "可选 | 自由添加，key 是字段名，value 是子选择器"
  },

  "url_mode":            "必填 | href / click_newtab / click_navigate / attr:属性名",
  "url_selector":        "可选 | 从卡片内哪个子元素取 URL（仅 href/attr 模式）",
  "wait_after_click_ms": "可选 | 点击后等待毫秒数（默认 2000）",
  "headless":            "可选 | 是否无头模式（默认 true）",

  "pre_actions":         "可选 | 提取前的准备操作列表",

  "fetch_detail":        "可选 | 是否抓取详情页内容（默认 false）",
  "detail_selector":     "可选 | 详情页内容区域的 CSS 选择器（默认 body）",
  "detail_format":       "可选 | text（纯文本，默认）或 html（原始 HTML）",
  "detail_wait_ms":      "可选 | 进入详情页后等待毫秒数（默认 2000）"
}
```

---

## 详情页抓取（fetch_detail）

启用后，爬虫在收集完所有职位 URL 后，会逐一访问每个职位的详情页，提取页面主体内容并存入 `detail_content` 字段。

### 启用方式

**方式一：命令行参数（不修改配置文件）**

```bash
python run.py "https://example.com/jobs" --detail -l 10 --output result.json
```

`--detail` 与 `--limit` 配合使用，`--limit` 同时控制列表爬取数量和详情抓取数量。

**方式二：写入配置文件（永久生效）**

```json
{
  "fetch_detail": true,
  "detail_selector": ".job-description",
  "detail_format": "text",
  "detail_wait_ms": 2000
}
```

### 配置字段说明

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `fetch_detail` | `false` | 开关 |
| `detail_selector` | `"body"` | 提取内容的 CSS 选择器，建议指定主内容区（如 `.job-content`）避免抓到导航栏 |
| `detail_format` | `"text"` | `text` 返回纯文本，`html` 返回原始 HTML |
| `detail_wait_ms` | `2000` | 进入详情页后等待时间，SPA 站点可适当调大 |

### 输出字段

| 字段 | 说明 |
|------|------|
| `detail_content` | 详情页提取的文本/HTML 内容，最长 50000 字符 |
| `detail_error` | 若该职位详情抓取失败，此字段记录错误信息；`detail_content` 为空字符串 |

### 注意事项

- 详情抓取是**逐个串行**进行的，每个职位需额外 2-5 秒
- 单个职位失败不会中止整体爬取，会记录 `detail_error` 继续下一个
- 控制台显示截断至 200 字符，完整内容保存在 `--output` 指定的 JSON 文件中
- 自动过滤无效 URL（空、`#`、`javascript:void(0)` 等）

---

## 四种 url_mode 详解

### 1. `"href"` — 最常见，卡片是链接

适用于卡片本身是 `<a>` 或卡片内有 `<a>` 子元素。

```html
<!-- 页面结构 -->
<a class="job-card" href="/jobs/123">
  <h3>Software Engineer</h3>
  <span class="loc">Beijing</span>
</a>
```

```json
{
  "domain": "example.com",
  "card_selector": "a.job-card",
  "fields": {
    "title": "h3",
    "location": ".loc"
  },
  "url_mode": "href"
}
```

如果 `<a>` 不是卡片本身而是子元素，用 `url_selector` 指定：

```html
<div class="job-card">
  <a href="/jobs/123">Software Engineer</a>
  <span class="loc">Beijing</span>
</div>
```

```json
{
  "card_selector": ".job-card",
  "fields": { "title": "a", "location": ".loc" },
  "url_mode": "href",
  "url_selector": "a"
}
```

### 2. `"click_newtab"` — 点击打开新标签页

适用于 SPA 站点，卡片是 `<div>`，点击后用 JS 打开新 tab。

```html
<div class="position-card" onclick="openInNewTab('/detail/123')">
  <div class="title">Product Manager</div>
  <div class="city">Hangzhou</div>
</div>
```

```json
{
  "domain": "jobs.example.com",
  "card_selector": ".position-card",
  "fields": {
    "title": ".title",
    "location": ".city"
  },
  "url_mode": "click_newtab",
  "wait_after_click_ms": 2000
}
```

爬虫会依次：点击卡片 → 等 2 秒 → 切到新 tab → 读取 URL → 关闭 tab → 回到列表 → 点下一个。

### 3. `"click_navigate"` — 点击后当前页跳转

适用于点击卡片后当前页 URL 变化（不开新 tab）。

```json
{
  "domain": "hr.example.cn",
  "card_selector": ".list-item",
  "fields": {
    "title": ".pos-name"
  },
  "url_mode": "click_navigate",
  "wait_after_click_ms": 2000
}
```

爬虫会：点击卡片 → 等 2 秒 → 读取新 URL → 按浏览器后退 → 点下一个。

### 4. `"attr:属性名"` — URL 存在自定义属性里

适用于 URL 放在 `data-*` 等属性中。

```html
<div class="job-item" data-url="/position/456">
  <span class="name">Designer</span>
</div>
```

```json
{
  "card_selector": ".job-item",
  "fields": { "title": ".name" },
  "url_mode": "attr:data-url"
}
```

---

## pre_actions 预操作

有些页面需要先滚动、等待、或点击按钮才能加载出职位列表。用 `pre_actions` 定义。

```json
"pre_actions": [
  {"action": "wait_for_content", "timeout_ms": 20000},
  {"action": "scroll", "times": 5},
  {"action": "wait", "ms": 2000},
  {"action": "click", "selector": ".load-more", "wait_ms": 1500}
]
```

| action | 参数 | 说明 |
|--------|------|------|
| `wait_for_content` | `timeout_ms` | 等待页面 DOM 稳定（推荐作为第一个操作）|
| `wait` | `ms` | 固定等待毫秒数 |
| `scroll` | `times` | 滚动页面 N 次（触发懒加载）|
| `click` | `selector`, `wait_ms` | 点击一个按钮（如"加载更多"）|

---

## CSS 选择器速查

| 场景 | 选择器写法 | 例子 |
|------|-----------|------|
| 精确 class | `.class-name` | `.job-card` |
| 包含部分 class | `[class*='关键字']` | `div[class*='HDMvPV436']` |
| ID | `#id-name` | `#job-list` |
| 标签 + class | `tag.class` | `a.item-link` |
| 属性 | `[attr='value']` | `a[href*='/jobs/']` |
| 子元素 | `父 > 子` | `.card > h3` |
| 后代元素 | `祖先 后代` | `.card .title` |
| 第一个子 | `:first-child` | `div:first-child` |
| 第 N 个 | `:nth-child(n)` | `li:nth-child(2)` |

**处理混淆 class 名**（如 `_3K0HDMvPV436asDJZC8Cbc`）：

取 class 中不太会变的片段用 `[class*='片段']`：
```json
"card_selector": "div[class*='HDMvPV436']"
```

---

## 完整示例：从零为新站点写配置

假设要爬取 `https://careers.acme.com/jobs` 这个页面。

**1) F12 看到的 HTML：**

```html
<ul class="job-list">
  <li class="job-item">
    <a href="/jobs/software-engineer-123">
      <div class="job-title">Software Engineer</div>
      <div class="job-meta">
        <span class="department">Engineering</span>
        <span class="location">Shanghai</span>
      </div>
    </a>
  </li>
  <li class="job-item">
    <a href="/jobs/product-manager-456">
      <div class="job-title">Product Manager</div>
      ...
    </a>
  </li>
</ul>
```

**2) 验证选择器：**

```javascript
// Console 里测试
document.querySelectorAll('.job-item').length        // → 2 ✓
document.querySelectorAll('.job-item')[0]
  .querySelector('.job-title')?.textContent           // → "Software Engineer" ✓
document.querySelectorAll('.job-item')[0]
  .querySelector('.location')?.textContent            // → "Shanghai" ✓
```

**3) 判断 url_mode：** 卡片内有 `<a>` 标签带 href → 用 `"href"`

**4) 写配置文件 `config/careers_acme_com.json`：**

```json
{
  "domain": "careers.acme.com",
  "name": "Acme Corp 招聘",

  "card_selector": ".job-item",

  "fields": {
    "title": ".job-title",
    "department": ".department",
    "location": ".location"
  },

  "url_mode": "href",
  "url_selector": "a",

  "pre_actions": [
    {"action": "wait_for_content", "timeout_ms": 15000}
  ]
}
```

**5) 运行验证：**

```bash
python run.py "https://careers.acme.com/jobs"
```

---

## 常见问题

**Q: 选择器选不到元素？**
- 页面可能需要先滚动/等待加载，加 `pre_actions`
- 内容可能在 iframe 里（暂不支持）
- 用 `headless: false` 打开有头模式调试

**Q: 混淆 class 名下次部署会变吗？**
- 可能会。用 `[class*='稳定片段']` 而不是完整 class 名
- 如果经常变，考虑用结构选择器如 `.parent > div:nth-child(2)`

**Q: click_newtab 模式太慢？**
- 每个卡片需要 3-4 秒（点击+等待+切换+关闭）
- 50 个职位约 3 分钟，这是此模式的固有限制
- 如果站点有 API，直接调 API 更快

**Q: 如何保存结果？**
```bash
python run.py "https://..." --output jobs.json
```

**Q: 详情页内容为空？**
- 页面内容可能通过 JS 异步加载，尝试增大 `detail_wait_ms`（如 `5000`）
- 用 `detail_selector` 指定正确的内容区域选择器
- 检查 `detail_error` 字段是否有错误信息

**Q: 详情抓取速度太慢？**
- 适当减小 `detail_wait_ms`（如改为 `1000`）
- 用 `--limit` 控制抓取数量，不要一次抓太多
