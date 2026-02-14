"""用 LLM 分析职位页面 DOM 并自动生成爬虫配置文件

用法:
    # 从文件读取 DOM
    python gen_config.py --file dom.html --url "https://careers.example.com/jobs"

    # 从剪贴板读取 DOM (macOS)
    pbpaste | python gen_config.py --url "https://careers.example.com/jobs"

    # 从 stdin 读取 DOM
    python gen_config.py --url "https://careers.example.com/jobs" < dom.html
"""

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests

# ── Doubao API 配置 ──────────────────────────────────────────────
DOUBAO_API_KEY = "1168bdb2-8680-45d6-b41f-38a081a670c1"
DOUBAO_API_URL = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"
DOUBAO_MODEL = "glm-4-7-251222"

CONFIG_DIR = Path(__file__).parent / "config"

SYSTEM_PROMPT = """你是一个专业的网页爬虫配置生成器。用户会给你一段招聘页面的 HTML DOM 和页面 URL，你需要分析 DOM 结构并生成一个 JSON 配置文件。

配置文件格式如下：
```json
{
  "domain": "站点域名（从 URL 提取）",
  "name": "站点描述（中文，简短）",
  "card_selector": "职位卡片的 CSS 选择器",
  "fields": {
    "title": "职位名称的子选择器（必填）",
    "其他字段": "其他字段的子选择器（可选，如 location, department, date, category 等）"
  },
  "url_mode": "href 或 click_newtab 或 click_navigate 或 attr:属性名",
  "url_selector": "从卡片内哪个子元素取 URL（仅 href/attr 模式需要，可选）",
  "wait_after_click_ms": 2000,
  "pre_actions": [
    {"action": "wait_for_content", "timeout_ms": 15000}
  ]
}
```

分析规则：
1. **card_selector**: 找到包裹每个职位的重复元素。优先用稳定的 class 名或结构选择器，避免用动态/混淆的完整 class 名。如果 class 名看起来是混淆的（如包含随机字符串），用 `[class*='稳定片段']` 的方式。
2. **fields**: 在卡片内部找到职位标题、地点、部门、日期等字段的子选择器。title 是必填的。只提取 DOM 中实际存在的字段，不要猜测。
3. **url_mode** — 判断优先级如下：
   - 如果卡片或子元素有 `<a>` 标签且 **href 属性存在且非空** → 用 "href"
   - 如果 `<a>` 标签存在但 **没有 href 属性、或 href 为空** → 这不是真正的链接，应该用 "click_newtab"
   - 如果卡片是 div/li，有 onclick 等 JS 事件 → 用 "click_newtab"
   - 如果 URL 在 data-url、data-href 等自定义属性中 → 用 "attr:属性名"
   - 注意：很多 SPA 站点会用 `<a>` 标签但不给 href，而是靠 JS 路由跳转，这种情况必须用 "click_newtab"
4. **url_selector**: 如果 url_mode 是 "href" 且 `<a>` 不是卡片本身而是子元素，需要指定 url_selector。
5. **name**: 给站点起一个简短中文描述名。
6. **pre_actions**: 默认加上 wait_for_content。

重要：
- 只输出 JSON，不要输出任何其他内容（不要 markdown 代码块标记）
- 确保 JSON 格式正确
- 选择器要尽可能稳定和准确
- fields 中只包含 DOM 中确实能找到的字段"""


def call_doubao(dom: str, url: str) -> str:
    """调用 Doubao API 分析 DOM 并生成配置"""
    user_message = f"""请分析以下招聘页面的 DOM 结构，生成爬虫配置文件。

页面 URL: {url}

HTML DOM:
```html
{dom}
```

请直接输出 JSON 配置（不要包含 markdown 代码块标记）。"""

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DOUBAO_API_KEY}",
    }

    payload = {
        "model": DOUBAO_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.1,
    }

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            print(f"正在调用 LLM 分析 DOM...（第 {attempt} 次）")
            resp = requests.post(DOUBAO_API_URL, headers=headers, json=payload, timeout=300)
            resp.raise_for_status()
            break
        except requests.exceptions.ReadTimeout:
            if attempt < max_retries:
                print(f"请求超时，{5 * attempt}秒后重试...")
                import time
                time.sleep(5 * attempt)
            else:
                raise

    data = resp.json()
    content = data["choices"][0]["message"]["content"].strip()

    # 清理可能的 markdown 代码块标记
    if content.startswith("```"):
        lines = content.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        content = "\n".join(lines)

    return content


def _has_href_in_dom(dom: str) -> bool:
    """检查 DOM 中的 <a> 标签是否带有实际的 href 值"""
    import re
    # 找所有 <a ...> 标签
    a_tags = re.findall(r'<a\s[^>]*>', dom, re.IGNORECASE)
    if not a_tags:
        return False
    # 检查是否有带非空 href 的
    for tag in a_tags:
        href_match = re.search(r'href\s*=\s*["\']([^"\']+)["\']', tag, re.IGNORECASE)
        if href_match and href_match.group(1).strip():
            return True
    return False


def fix_url_mode(config: dict, dom: str) -> dict:
    """校验并修正 url_mode：如果 DOM 中 <a> 没有 href 但配置写了 href 模式，自动改为 click_newtab"""
    if config.get("url_mode") == "href" and not _has_href_in_dom(dom):
        print("校正: DOM 中 <a> 无 href，url_mode 从 'href' 改为 'click_newtab'")
        config["url_mode"] = "click_newtab"
        config.pop("url_selector", None)
        config.setdefault("wait_after_click_ms", 2000)
    return config


def domain_to_filename(domain: str) -> str:
    """将域名转换为配置文件名: careers.example.com → careers_example_com.json"""
    return domain.replace(".", "_").replace("-", "-") + ".json"


def main():
    parser = argparse.ArgumentParser(description="用 LLM 分析 DOM 生成爬虫配置")
    parser.add_argument("--url", "-u", required=True, help="招聘页面的 URL")
    parser.add_argument("--file", "-f", help="DOM HTML 文件路径（不指定则从 stdin 读取）")
    parser.add_argument("--output", "-o", help="输出文件路径（默认自动命名到 config/ 目录）")
    args = parser.parse_args()

    # 读取 DOM
    if args.file:
        with open(args.file, "r", encoding="utf-8") as f:
            dom = f.read()
    else:
        if sys.stdin.isatty():
            print("请粘贴 HTML DOM（输入完毕后按 Ctrl+D 结束）：")
        dom = sys.stdin.read()

    if not dom.strip():
        print("错误: DOM 内容为空")
        sys.exit(1)

    print(f"DOM 长度: {len(dom)} 字符")

    # 调用 LLM
    raw_config = call_doubao(dom, args.url)

    # 解析并验证 JSON
    try:
        config = json.loads(raw_config)
    except json.JSONDecodeError as e:
        print(f"LLM 返回的内容无法解析为 JSON: {e}")
        print(f"原始返回:\n{raw_config}")
        sys.exit(1)

    # 验证必填字段
    required = ["domain", "card_selector", "fields", "url_mode"]
    missing = [k for k in required if k not in config]
    if missing:
        print(f"警告: 配置缺少必填字段: {missing}")

    if "fields" in config and "title" not in config["fields"]:
        print("警告: fields 中缺少 title 字段")

    # 校验 url_mode
    config = fix_url_mode(config, dom)

    # 确保 domain 正确（以 URL 为准）
    parsed = urlparse(args.url)
    config["domain"] = parsed.netloc.lower()

    # 输出路径
    if args.output:
        output_path = Path(args.output)
    else:
        CONFIG_DIR.mkdir(exist_ok=True)
        filename = domain_to_filename(config["domain"])
        output_path = CONFIG_DIR / filename

    # 写入文件
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

    print(f"\n配置文件已生成: {output_path}")
    print(f"\n{'='*60}")
    print(json.dumps(config, ensure_ascii=False, indent=2))
    print(f"{'='*60}")
    print(f"\n验证命令:")
    print(f"  python run.py \"{args.url}\"")


if __name__ == "__main__":
    main()
