"""自动化配置生成：输入 URL，自动打开页面、检测职位列表、生成配置文件

用法:
    python auto_gen.py "https://careers.example.com/jobs"
    python auto_gen.py "https://careers.example.com/jobs" --headed
    python auto_gen.py "https://careers.example.com/jobs" --output config/custom.json
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

from browser_service import BrowserService
from dom_extractor import find_job_containers
from gen_config import call_doubao, call_doubao_raw, fix_url_mode, domain_to_filename, CONFIG_DIR


# LLM 从多个候选中选择职位列表的 system prompt
_PICK_SYSTEM_PROMPT = """你是一个网页结构分析专家。用户会给你多个从招聘页面中检测到的候选 HTML 容器。
你需要判断哪一个是真正的职位列表容器。

判断依据：
- 职位列表包含多个职位卡片，每个卡片通常有：职位名称、地点、部门等信息
- 不是导航菜单、页脚链接、侧边栏筛选器、面包屑等

只返回你选择的候选编号（数字），不要返回任何其他内容。
例如: 0"""


def _needs_llm_pick(candidates: list[dict]) -> bool:
    """判断是否需要 LLM 介入选择"""
    if len(candidates) > 1:
        return True
    if candidates[0]["child_count"] < 3:
        return True
    return False


def _llm_pick(candidates: list[dict], url: str) -> dict:
    """用 LLM 从多个候选中选择真正的职位列表容器"""
    parts = [f"页面 URL: {url}\n"]
    for cand in candidates:
        parts.append(
            f"候选 {cand['index']}:\n"
            f"  子元素数量: {cand['child_count']} 个 <{cand['child_tag']}>\n"
            f"  平均文字长度: {cand['avg_text_len']} 字符\n"
            f"  HTML 片段:\n```html\n{cand['sample_html'][:3000]}\n```\n"
        )

    user_message = "\n".join(parts) + "\n请选择哪个候选是职位列表容器，只返回编号数字。"

    print(f"  LLM 从 {len(candidates)} 个候选中判断...")
    raw = call_doubao_raw(_PICK_SYSTEM_PROMPT, user_message)

    try:
        chosen = int(raw.strip())
        if 0 <= chosen < len(candidates):
            return candidates[chosen]
    except ValueError:
        pass

    print(f"  LLM 返回无法解析 ({raw.strip()})，使用评分最高的候选")
    return candidates[0]


def _pick_best_candidate(candidates: list[dict], url: str) -> dict:
    """选择最佳候选容器

    快速路径：只有 1 个候选且子元素 >= 3 → 直接用，不调 LLM
    慢速路径：多个候选 或 子元素 < 3 → 调 LLM 判断
    """
    if not _needs_llm_pick(candidates):
        print(f"  唯一候选且子元素充足，直接使用")
        return candidates[0]

    return _llm_pick(candidates, url)


async def generate_config(url: str, headed: bool = False) -> dict | None:
    """自动生成配置并保存到 config/ 目录

    Args:
        url: 招聘页面 URL
        headed: 是否使用有头浏览器

    Returns:
        生成的配置 dict，失败返回 None
    """
    domain = urlparse(url).netloc.lower()
    session_name = domain.replace(".", "_")
    browser = BrowserService(session=session_name, headless=not headed)

    try:
        # Step 1: 打开页面
        print(f"  [自动生成] 打开页面: {url}")
        await browser.navigate(url)

        # Step 2: 处理弹窗 + 等待加载
        print(f"  [自动生成] 等待页面加载...")
        await browser.dismiss_cookie_banner()
        content_ready = await browser.wait_for_content(timeout_ms=20000)
        if not content_ready:
            print("  [自动生成] 警告: 页面内容加载可能不完整")

        # Step 3: 滚动触发懒加载
        print(f"  [自动生成] 滚动触发懒加载...")
        await browser.scroll_page(times=3)
        await asyncio.sleep(1)

        # Step 4: 检测职位容器
        print(f"  [自动生成] 分析页面结构...")
        candidates = await find_job_containers(browser)

        if not candidates:
            print("  [自动生成] 错误: 未能检测到职位列表容器")
            return None

        print(f"  [自动生成] 检测到 {len(candidates)} 个候选容器:")
        for c in candidates:
            print(f"    [{c['index']}] {c['selector'][:60]}  "
                  f"({c['child_count']} 个 <{c['child_tag']}>, "
                  f"评分 {c['score']})")

        chosen = _pick_best_candidate(candidates, url)
        print(f"  [自动生成] 选中候选 {chosen['index']}: {chosen['selector'][:60]}")

        # Step 5: 调用 LLM 生成配置
        print(f"  [自动生成] 调用 LLM 生成配置...")
        raw_config = call_doubao(chosen["sample_html"], url)

        try:
            config = json.loads(raw_config)
        except json.JSONDecodeError as e:
            print(f"  [自动生成] LLM 返回无法解析为 JSON: {e}")
            return None

        # 校验和修正
        config = fix_url_mode(config, chosen["sample_html"])
        config["domain"] = domain

        # 保存配置
        CONFIG_DIR.mkdir(exist_ok=True)
        filename = domain_to_filename(domain)
        output_path = CONFIG_DIR / filename
        output_path.write_text(
            json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"  [自动生成] 配置已保存: {output_path}")

        return config

    finally:
        await browser.close()


async def auto_generate_config(url: str, headed: bool = False, output: str | None = None):
    """CLI 入口：生成配置并打印结果"""
    config = await generate_config(url, headed=headed)

    if not config:
        print("\n配置生成失败")
        print("可以使用手动模式:")
        print(f'  python gen_config.py --url "{url}" --file dom.html')
        sys.exit(1)

    # 如果指定了自定义输出路径，额外保存一份
    if output:
        Path(output).write_text(
            json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"配置已另存: {output}")

    print(f"\n{json.dumps(config, ensure_ascii=False, indent=2)}")
    print(f'\n验证: python run.py "{url}"')


def main():
    parser = argparse.ArgumentParser(description="自动化配置生成：输入 URL 自动生成爬虫配置")
    parser.add_argument("url", help="招聘页面 URL")
    parser.add_argument("--headed", action="store_true", help="使用有头浏览器（可视化调试）")
    parser.add_argument("--output", "-o", help="输出文件路径（默认自动命名到 config/ 目录）")
    args = parser.parse_args()

    asyncio.run(auto_generate_config(args.url, headed=args.headed, output=args.output))


if __name__ == "__main__":
    main()
