"""自动化配置生成：输入 URL，自动打开页面、检测职位列表、生成配置文件

用法:
    python auto_gen.py "https://careers.example.com/jobs"
    python auto_gen.py "https://careers.example.com/jobs" --headed
    python auto_gen.py "https://careers.example.com/jobs" --output config/custom.json
"""

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from urllib.parse import urlparse

from browser_service import BrowserService
from dom_extractor import find_job_containers, find_detail_containers
from gen_config import call_doubao, call_doubao_detail, call_doubao_raw, fix_url_mode, domain_to_filename, CONFIG_DIR

logger = logging.getLogger(__name__)


# LLM 逐个判断候选是否为职位列表的 system prompt
_VERIFY_SYSTEM_PROMPT = """你是一个网页结构分析专家。用户会给你一段从招聘页面中检测到的 HTML 容器。
你需要判断这个容器是否是职位列表。

判断依据：
- 职位列表包含职位卡片，每个卡片通常有：职位名称、地点、部门等信息
- 不是导航菜单、页脚链接、侧边栏筛选器、面包屑、FAQ 列表等

只返回 yes 或 no，不要返回任何其他内容。"""


def _llm_verify(candidate: dict, url: str) -> bool:
    """用 LLM 判断单个候选是否为职位列表"""
    user_message = (
        f"页面 URL: {url}\n\n"
        f"子元素数量: {candidate['child_count']} 个 <{candidate['child_tag']}>\n"
        f"平均文字长度: {candidate['avg_text_len']} 字符\n\n"
        f"HTML 片段:\n```html\n{candidate['sample_html'][:3000]}\n```\n\n"
        f"这是职位列表容器吗？只返回 yes 或 no。"
    )

    raw = call_doubao_raw(_VERIFY_SYSTEM_PROMPT, user_message)
    answer = raw.strip().lower()
    return answer.startswith("yes")


import re

# 用正则匹配，避免子串误命中（如 tab- 匹配 results__tab-content）
# 要求关键词出现在：开头、.class、#id、[attr] 边界处
_NAV_KEYWORDS = [
    'navigation', 'navbar', 'nav-bar', 'nav-menu',
    'submenu', 'sub-menu',
    'foldout', 'dropdown', 'drop-down',
    'sidebar', 'side-bar',
    'breadcrumb',
]

# 这些只在选择器段的开头或 class/id 名起始处匹配
_NAV_PREFIX_RE = re.compile(
    r'(?:^|[.#\s>+~])(?:nav|menu|footer|header|toolbar|tabs?)(?:[.\-_#\s>+~\[]|$)',
    re.IGNORECASE,
)


def _is_nav_candidate(cand: dict) -> bool:
    """检查候选的选择器是否明显是导航/菜单元素"""
    selector_lower = cand["selector"].lower()
    # 长关键词直接子串匹配
    if any(kw in selector_lower for kw in _NAV_KEYWORDS):
        return True
    # 短关键词用正则边界匹配
    if _NAV_PREFIX_RE.search(cand["selector"]):
        return True
    return False


def _quick_reject_all(candidates: list[dict]) -> bool:
    """快速判断候选列表是否明显不是职位页面，避免浪费 LLM 调用。

    拒绝条件（全部候选都不达标）：
    - 最高评分 < 65（正常职位页面最高分通常 80+）
    - 所有候选子元素数量 < 6（职位列表通常有 6+ 个卡片）
    """
    best_score = max(c["score"] for c in candidates)
    best_child_count = max(c["child_count"] for c in candidates)

    if best_score < 65 and best_child_count < 6:
        logger.info(f"快速跳过: 最高评分 {best_score}, 最多子元素 {best_child_count} (阈值: 评分≥65 或 子元素≥6)")
        return True
    return False


def _pick_best_candidate(candidates: list[dict], url: str, max_llm_calls: int = 2) -> dict | None:
    """按评分从高到低选出最佳候选

    快速路径 1：评分和子元素数均不达标 → 直接跳过
    快速路径 2：选择器含导航关键词 → 跳过该候选
    快速路径 3：评分 ≥ 80 且子元素 ≥ 6 → 高置信度直接采用，不调 LLM
    慢速路径：最多调 max_llm_calls 次 LLM 验证
    """
    if _quick_reject_all(candidates):
        return None

    # 过滤掉导航元素
    valid = []
    for cand in candidates:
        if _is_nav_candidate(cand):
            logger.info(f"跳过候选 {cand['index']}: 导航元素 ({cand['selector'][:50]})")
        else:
            valid.append(cand)

    if not valid:
        logger.warning(f"所有候选均为导航元素")
        return None

    # 高置信度：评分 ≥ 80 且子元素 ≥ 6 → 直接采用
    top = valid[0]
    if top["score"] >= 80 and top["child_count"] >= 6:
        logger.info(f"高置信度直接采用候选 {top['index']}: "
                    f"评分 {top['score']}, {top['child_count']} 个子元素")
        return top

    # 低置信度：最多验证 max_llm_calls 个候选
    llm_calls = 0
    for cand in valid:
        if llm_calls >= max_llm_calls:
            logger.info(f"已达 LLM 验证上限 ({max_llm_calls} 次)，停止验证")
            break

        logger.info(f"验证候选 {cand['index']}: {cand['selector'][:50]}...")
        llm_calls += 1
        if _llm_verify(cand, url):
            logger.info(f"✓ 确认为职位列表")
            return cand
        else:
            logger.info(f"✗ 不是职位列表，跳过")

    # 全部验证失败
    logger.warning(f"所有候选均未通过验证")
    return None


async def generate_config(url: str, headed: bool = False, with_detail: bool = False) -> dict | None:
    """自动生成配置并保存到 config/ 目录

    Args:
        url: 招聘页面 URL
        headed: 是否使用有头浏览器
        with_detail: 是否同时生成详情页配置

    Returns:
        生成的配置 dict，失败返回 None
    """
    domain = urlparse(url).netloc.lower()
    session_name = domain.replace(".", "_")
    browser = BrowserService(session=session_name, headless=not headed)

    try:
        # Step 1: 打开页面
        logger.info(f"[自动生成] 打开页面: {url}")
        await browser.navigate(url)

        # Step 2: 等待加载 + 处理弹窗
        logger.info(f"[自动生成] 等待页面加载...")
        content_ready = await browser.wait_for_content(timeout_ms=20000)
        if not content_ready:
            logger.warning("[自动生成] 页面内容加载可能不完整")
        await browser.dismiss_popup()

        # Step 3: 滚动触发懒加载
        logger.info(f"[自动生成] 滚动触发懒加载...")
        await browser.scroll_page(times=3)
        await asyncio.sleep(1)

        # Step 4: 检测职位容器
        logger.info(f"[自动生成] 分析页面结构...")
        candidates = await find_job_containers(browser)

        if not candidates:
            logger.error("[自动生成] 未能检测到职位列表容器")
            return None

        logger.info(f"[自动生成] 检测到 {len(candidates)} 个候选容器:")
        for c in candidates:
            logger.info(f"  [{c['index']}] {c['selector'][:60]}  "
                        f"({c['child_count']} 个 <{c['child_tag']}>, "
                        f"评分 {c['score']})")

        chosen = _pick_best_candidate(candidates, url)
        if not chosen:
            logger.error("[自动生成] 未找到有效的职位列表容器")
            return None
        logger.info(f"[自动生成] 选中候选 {chosen['index']}: {chosen['selector'][:60]}")

        # Step 5: 调用 LLM 生成配置
        logger.info(f"[自动生成] 调用 LLM 生成配置...")
        raw_config = call_doubao(chosen["sample_html"], url, card_selector=chosen.get("card_selector", ""))

        try:
            config = json.loads(raw_config)
        except json.JSONDecodeError as e:
            logger.error(f"[自动生成] LLM 返回无法解析为 JSON: {e}")
            return None

        # 校验和修正
        config = fix_url_mode(config, chosen["sample_html"])
        config["domain"] = domain

        # Step 6: 如果需要，生成详情页配置
        if with_detail:
            detail_config = await _generate_detail_config(browser, config, url)
            if detail_config:
                config["detail"] = detail_config

        # 保存配置
        CONFIG_DIR.mkdir(exist_ok=True)
        filename = domain_to_filename(domain)
        output_path = CONFIG_DIR / filename
        output_path.write_text(
            json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        logger.info(f"[自动生成] 配置已保存: {output_path}")

        return config

    finally:
        await browser.close()


async def generate_detail_config_standalone(detail_url: str, headed: bool = False) -> dict | None:
    """独立生成详情页配置：给定一个详情页 URL，返回 detail 配置块

    Args:
        detail_url: 职位详情页 URL
        headed: 是否使用有头浏览器

    Returns:
        detail 配置 dict，失败返回 None
    """
    domain = urlparse(detail_url).netloc.lower()
    session_name = domain.replace(".", "_")
    browser = BrowserService(session=session_name, headless=not headed)

    try:
        logger.info(f"[详情配置] 打开详情页: {detail_url}")
        await browser.navigate(detail_url)
        await browser.wait_for_content(timeout_ms=15000)

        detail_config = await _generate_detail_config_from_page(browser, detail_url)
        return detail_config
    finally:
        await browser.close()


async def _generate_detail_config(browser: BrowserService, config: dict, list_url: str) -> dict | None:
    """从列表页出发，取第一个 job URL 导航到详情页，生成 detail 配置"""
    from crawler import JobCrawler

    logger.info(f"[详情配置] 从列表提取一个详情页 URL...")
    crawler = JobCrawler(browser)

    # 提取第一页的卡片和 URL
    card_selector = config["card_selector"]
    fields = config["fields"]
    jobs = await crawler._extract_fields(card_selector, fields)
    if not jobs:
        logger.warning(f"[详情配置] 未找到卡片，跳过详情配置生成")
        return None

    jobs = jobs[:1]  # 只取第一个
    jobs = await crawler._extract_urls(config, jobs)
    first_url = jobs[0].get("url", "").strip() if jobs else ""

    if not first_url or first_url.startswith(("javascript:", "#")):
        logger.warning(f"[详情配置] 未获取到有效的详情页 URL，跳过")
        return None

    # 处理相对 URL
    if not first_url.startswith(("http://", "https://")):
        from urllib.parse import urljoin
        first_url = urljoin(list_url, first_url)

    logger.info(f"[详情配置] 导航到详情页: {first_url}")
    await browser.navigate(first_url)
    await browser.wait_for_content(timeout_ms=15000)

    return await _generate_detail_config_from_page(browser, first_url)


async def _generate_detail_config_from_page(browser: BrowserService, page_url: str) -> dict | None:
    """在当前已打开的详情页上，检测容器并调用 LLM 生成配置"""
    logger.info(f"[详情配置] 分析详情页结构...")
    candidates = await find_detail_containers(browser)

    if not candidates:
        logger.warning(f"[详情配置] 未检测到详情页内容容器")
        return None

    logger.info(f"[详情配置] 检测到 {len(candidates)} 个候选:")
    for c in candidates:
        logger.info(f"  [{c['index']}] {c['selector'][:60]}  "
                    f"(文本 {c['text_len']} 字符, 评分 {c['score']})")

    # 详情页选最高分的即可
    chosen = candidates[0]
    logger.info(f"[详情配置] 选中候选 {chosen['index']}: {chosen['selector'][:60]}")

    logger.info(f"[详情配置] 调用 LLM 生成详情页配置...")
    raw_config = call_doubao_detail(
        chosen["sample_html"], page_url,
        container_selector=chosen.get("selector", "")
    )

    try:
        detail_config = json.loads(raw_config)
    except json.JSONDecodeError as e:
        logger.error(f"[详情配置] LLM 返回无法解析为 JSON: {e}")
        return None

    # 确保必填字段
    if "fields" not in detail_config or "description" not in detail_config.get("fields", {}):
        logger.warning(f"[详情配置] 配置缺少 fields.description")

    logger.info(f"[详情配置] 生成成功: {list(detail_config.get('fields', {}).keys())}")
    return detail_config


async def auto_generate_config(url: str, headed: bool = False, output: str | None = None, with_detail: bool = False):
    """CLI 入口：生成配置并打印结果"""
    config = await generate_config(url, headed=headed, with_detail=with_detail)

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


async def batch_generate_configs(urls: list[str], headed: bool = False):
    """批量生成配置文件，跳过已有配置的 URL"""
    from gen_config import CONFIG_DIR

    # 统计已有配置
    existing = set()
    if CONFIG_DIR.exists():
        existing = {f.stem for f in CONFIG_DIR.glob("*.json")}

    total = len(urls)
    success = 0
    fail = 0
    skip = 0

    for i, url in enumerate(urls, 1):
        domain = urlparse(url).netloc.lower()
        filename_stem = domain_to_filename(domain).replace(".json", "")

        if filename_stem in existing:
            logger.info(f"[{i}/{total}] 跳过 (已有配置): {domain}")
            skip += 1
            continue

        logger.info(f"[{i}/{total}] 生成配置: {url}")
        try:
            config = await generate_config(url, headed=headed)
            if config:
                success += 1
                existing.add(filename_stem)
            else:
                fail += 1
                logger.error(f"  生成失败")
        except Exception as e:
            fail += 1
            logger.error(f"  异常: {e}")

    logger.info(f"{'=' * 40}")
    logger.info(f"批量生成完成: 成功 {success}, 失败 {fail}, 跳过 {skip}, 共 {total}")


def main():
    parser = argparse.ArgumentParser(description="自动化配置生成：输入 URL 自动生成爬虫配置")
    parser.add_argument("url", nargs="?", help="招聘页面 URL")
    parser.add_argument("--batch", "-b", help="批量 URL 文件路径（每行一个 URL）")
    parser.add_argument("--headed", action="store_true", help="使用有头浏览器（可视化调试）")
    parser.add_argument("--output", "-o", help="输出文件路径（默认自动命名到 config/ 目录）")
    parser.add_argument("--detail", action="store_true", help="同时生成详情页配置")
    parser.add_argument("--detail-url", help="单独为指定详情页 URL 生成 detail 配置")
    parser.add_argument("--verbose", "-v", action="store_true", help="显示详细日志（DEBUG 级别）")
    args = parser.parse_args()

    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="  %(message)s",
    )

    if args.detail_url:
        # 独立生成详情页配置
        async def _run_detail():
            detail_config = await generate_detail_config_standalone(args.detail_url, headed=args.headed)
            if detail_config:
                print(f"\n{json.dumps(detail_config, ensure_ascii=False, indent=2)}")
                if args.output:
                    Path(args.output).write_text(
                        json.dumps(detail_config, ensure_ascii=False, indent=2), encoding="utf-8"
                    )
                    print(f"配置已保存: {args.output}")
                else:
                    print("\n提示: 将此配置添加到对应站点配置文件的 \"detail\" 字段中")
            else:
                print("\n详情页配置生成失败")
                sys.exit(1)
        asyncio.run(_run_detail())
    elif args.batch:
        with open(args.batch, "r") as f:
            urls = [line.strip() for line in f if line.strip() and not line.startswith("#")]
        if not urls:
            print("文件中没有有效的 URL")
            sys.exit(1)
        print(f"读取到 {len(urls)} 个 URL")
        asyncio.run(batch_generate_configs(urls, headed=args.headed))
    elif args.url:
        asyncio.run(auto_generate_config(args.url, headed=args.headed, output=args.output, with_detail=args.detail))
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
