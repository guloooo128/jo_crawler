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
  "url_selector": "从卡片内哪个子元素取 URL 或点击（可选，适用于所有模式）",
  "wait_after_click_ms": 2000,
  "pre_actions": [
    {"action": "wait_for_content", "timeout_ms": 15000}
  ]
}
```

分析规则：
1. **card_selector**: 找到包裹每个职位的重复元素。如果提供了"推荐的 card_selector"，请优先使用。否则自行分析时注意：选择器必须足够精确以避免匹配到页面其他区域的同名标签（如表头行、导航等），必要时加上父容器路径前缀（如 `#jobList > .card` 而不是裸 `.card`）。优先用稳定的 class 名或结构选择器，避免用动态/混淆的完整 class 名。如果 class 名看起来是混淆的（如包含随机字符串），用 `[class*='稳定片段']` 的方式。
2. **fields**: 在卡片内部找到职位标题、地点、部门、日期等字段的子选择器。title 是必填的。只提取 DOM 中实际存在的字段，不要猜测。
3. **url_mode** — 判断优先级如下：
   - 如果卡片或子元素有 `<a>` 标签且 **href 属性存在且非空** → 用 "href"
   - 如果 `<a>` 标签存在但 **没有 href 属性、或 href 为空** → 这不是真正的链接，应该用 "click_newtab"
   - 如果卡片是 div/li，有 onclick 等 JS 事件 → 用 "click_newtab"
   - 如果 URL 在 data-url、data-href 等自定义属性中 → 用 "attr:属性名"
   - 注意：很多 SPA 站点会用 `<a>` 标签但不给 href，而是靠 JS 路由跳转，这种情况必须用 "click_newtab"
4. **url_selector**: 从卡片内哪个子元素取 URL 或触发点击（可选，适用于所有 url_mode）：
   - href/attr 模式：指定从卡片内哪个子元素提取 URL（如 `<a>` 不是卡片本身而是子元素时）
   - click_newtab/click_navigate 模式：指定点击卡片内的哪个子元素（如"查看详情"按钮）。如果该元素初始不可见（如折叠面板），爬虫会自动先点击卡片展开再点击按钮
   - 如果卡片内有明确的"查看详情"、"了解更多"等按钮，设置 url_selector 指向它
5. **name**: 给站点起一个简短中文描述名。
6. **pre_actions**: 默认加上 wait_for_content。

重要：
- 只输出 JSON，不要输出任何其他内容（不要 markdown 代码块标记）
- 确保 JSON 格式正确
- 选择器要尽可能稳定和准确
- fields 中只包含 DOM 中确实能找到的字段"""


DETAIL_SYSTEM_PROMPT = """你是一个专业的网页爬虫配置生成器。用户会给你一段职位详情页的 HTML DOM 和页面 URL，你需要分析 DOM 结构并生成一个详情页配置 JSON。

注意：HTML 中的文本内容已被截断（以 ... 结尾），这是为了节省空间。你只需要关注 DOM 结构（标签、class、id 等），用它们来生成准确的 CSS 选择器。

配置文件格式如下：
```json
{
  "container_selector": "详情页主内容区域的 CSS 选择器",
  "fields": {
    "description": "职位描述的子选择器（必填）",
    "其他字段": "其他字段的子选择器（可选，如 requirements, qualifications, salary, benefits, department, location, employment_type 等）"
  },
  "wait_ms": 2000
}
```

分析规则：
1. **container_selector**: 找到包裹职位详情主要内容的容器元素。如果提供了"推荐的 container_selector"，请优先使用。选择器要稳定，避免用动态/混淆的 class 名。
2. **fields**: 在容器内找到各个内容区域的子选择器。description 是必填的。只提取 DOM 中实际存在的字段区域，不要猜测。常见字段包括：
   - description: 职位描述/概述
   - responsibilities: 工作职责
   - requirements / qualifications: 任职要求/资格
   - salary / compensation: 薪资待遇
   - benefits: 福利
   - location: 工作地点
   - department: 部门
   - employment_type: 工作类型（全职/兼职等）
3. **wait_ms**: 页面加载等待时间，默认 2000。
4. 如果页面结构简单，整个内容在一个区块内无法细分，fields 中只需要放 description 即可。

重要：
- 只输出 JSON，不要输出任何其他内容（不要 markdown 代码块标记）
- 确保 JSON 格式正确
- 选择器要尽可能稳定和准确
- fields 中只包含 DOM 中确实能找到的字段"""


def call_doubao_raw(system_prompt: str, user_message: str, temperature: float = 0.1) -> str:
    """通用 Doubao API 调用，返回 LLM 响应文本"""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DOUBAO_API_KEY}",
    }

    payload = {
        "model": DOUBAO_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        "temperature": temperature,
    }

    max_retries = 3
    for attempt in range(1, max_retries + 1):
        try:
            print(f"正在调用 LLM...（第 {attempt} 次）")
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


def call_doubao(dom: str, url: str, card_selector: str = "") -> str:
    """调用 Doubao API 分析 DOM 并生成配置"""
    card_hint = ""
    if card_selector:
        card_hint = f"\n推荐的 card_selector: `{card_selector}`（已通过页面结构分析自动生成，请优先使用）\n"

    user_message = f"""请分析以下招聘页面的 DOM 结构，生成爬虫配置文件。

页面 URL: {url}
{card_hint}
HTML DOM:
```html
{dom}
```

请直接输出 JSON 配置（不要包含 markdown 代码块标记）。"""

    return call_doubao_raw(SYSTEM_PROMPT, user_message)


def call_doubao_detail(dom: str, url: str, container_selector: str = "") -> str:
    """调用 Doubao API 分析详情页 DOM 并生成 detail 配置"""
    container_hint = ""
    if container_selector:
        container_hint = f"\n推荐的 container_selector: `{container_selector}`（已通过页面结构分析自动生成，请优先使用）\n"

    user_message = f"""请分析以下职位详情页的 DOM 结构，生成详情页爬虫配置。

页面 URL: {url}
{container_hint}
HTML DOM:
```html
{dom}
```

请直接输出 JSON 配置（不要包含 markdown 代码块标记）。"""

    return call_doubao_raw(DETAIL_SYSTEM_PROMPT, user_message)


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


def _find_clickable_button_selector(dom: str) -> str | None:
    """从 DOM 中检测卡片内可点击的按钮元素，返回 CSS 选择器或 None

    匹配规则：
    - class 含 btn/button/detail 的 div/span/button 元素
    - 文本为"查看详情"、"了解更多"、"View Detail"等的元素
    """
    import re

    # 方法1：检测文本含"查看详情"/"了解更多"/"View"等的按钮元素
    # 寻找 class 中含有 detail/btn/button 的元素
    btn_patterns = [
        (r'class\s*=\s*["\'][^"\']*\b(detail[_-]?btn|btn[_-]?detail)\b[^"\']*["\']', None),
        (r'class\s*=\s*["\'][^"\']*\b(DetailBtn|detailBtn)\b[^"\']*["\']', None),
        # 模糊匹配 class 含 Detail + Btn 的
        (r"class\s*=\s*[\"'][^\"']*?([\w]*Detail[\w]*Btn[\w]*)[^\"']*?[\"']", None),
        (r"class\s*=\s*[\"'][^\"']*?([\w]*Btn[\w]*Detail[\w]*)[^\"']*?[\"']", None),
    ]

    for pattern, _ in btn_patterns:
        match = re.search(pattern, dom, re.IGNORECASE)
        if match:
            class_fragment = match.group(1)
            selector = f"[class*='{class_fragment}']"
            return selector

    return None


def fix_url_mode(config: dict, dom: str) -> dict:
    """校验并修正 url_mode 和 url_selector"""
    # 1. 如果 DOM 中 <a> 没有 href 但配置写了 href 模式，改为 click_newtab
    if config.get("url_mode") == "href" and not _has_href_in_dom(dom):
        print("校正: DOM 中 <a> 无 href，url_mode 从 'href' 改为 'click_newtab'")
        config["url_mode"] = "click_newtab"
        config.pop("url_selector", None)
        config.setdefault("wait_after_click_ms", 2000)

    # 2. click_newtab/click_navigate 模式下，如果没有 url_selector，
    #    尝试自动检测卡片内的可点击按钮
    if config.get("url_mode") in ("click_newtab", "click_navigate"):
        if not config.get("url_selector"):
            btn_selector = _find_clickable_button_selector(dom)
            if btn_selector:
                print(f"校正: 检测到可点击按钮，自动设置 url_selector = '{btn_selector}'")
                config["url_selector"] = btn_selector

    return config


def domain_to_filename(domain: str) -> str:
    """将域名转换为配置文件名: careers.example.com → careers_example_com.json"""
    return domain.replace(".", "_").replace("-", "-") + ".json"


def _resolve_output_path(url: str, output: str | None) -> Path:
    """根据 URL 和 --output 参数确定配置文件输出路径"""
    if output:
        return Path(output)
    CONFIG_DIR.mkdir(exist_ok=True)
    domain = urlparse(url).netloc.lower()
    return CONFIG_DIR / domain_to_filename(domain)


def _save_config(config: dict, output_path: Path, merge_key: str | None = None):
    """保存配置到文件。

    Args:
        config: 要保存的配置
        output_path: 输出路径
        merge_key: 如果指定（如 "detail"），且文件已存在，则只更新该字段而非全量覆盖
    """
    if merge_key and output_path.exists():
        existing = json.loads(output_path.read_text(encoding="utf-8"))
        existing[merge_key] = config
        final = existing
        print(f"\n已合并 '{merge_key}' 到现有配置: {output_path}")
    else:
        final = config

    output_path.write_text(
        json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return final


def _gen_list_config(dom: str, url: str):
    """生成列表页配置"""
    raw_config = call_doubao(dom, url)

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

    config = fix_url_mode(config, dom)
    config["domain"] = urlparse(url).netloc.lower()
    return config


def _gen_detail_config(dom: str, url: str):
    """生成详情页配置"""
    raw_config = call_doubao_detail(dom, url)

    try:
        config = json.loads(raw_config)
    except json.JSONDecodeError as e:
        print(f"LLM 返回的内容无法解析为 JSON: {e}")
        print(f"原始返回:\n{raw_config}")
        sys.exit(1)

    # 验证必填字段
    if "fields" not in config or "description" not in config.get("fields", {}):
        print("警告: 配置缺少 fields.description")

    return config


def main():
    parser = argparse.ArgumentParser(description="用 LLM 分析 DOM 生成爬虫配置")
    parser.add_argument("--url", "-u", required=True, help="页面 URL")
    parser.add_argument("--file", "-f", help="DOM HTML 文件路径（不指定则从 stdin 读取）")
    parser.add_argument("--output", "-o", help="输出文件路径（默认自动命名到 config/ 目录）")
    parser.add_argument("--detail", action="store_true",
                        help="生成详情页配置（而非列表页配置）。如果对应配置文件已存在，会合并 detail 字段")
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

    output_path = _resolve_output_path(args.url, args.output)

    if args.detail:
        # 详情页配置
        config = _gen_detail_config(dom, args.url)
        final = _save_config(config, output_path, merge_key="detail")
    else:
        # 列表页配置
        config = _gen_list_config(dom, args.url)
        final = _save_config(config, output_path)

    print(f"\n配置文件已保存: {output_path}")
    print(f"\n{'='*60}")
    print(json.dumps(final, ensure_ascii=False, indent=2))
    print(f"{'='*60}")
    print(f"\n验证命令:")
    if args.detail:
        print(f'  python run.py "{args.url}" --detail -l 5')
    else:
        print(f'  python run.py "{args.url}"')


if __name__ == "__main__":
    main()
