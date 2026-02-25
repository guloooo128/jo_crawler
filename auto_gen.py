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
from dom_extractor import find_job_container
from gen_config import call_doubao, fix_url_mode, domain_to_filename, CONFIG_DIR


async def auto_generate_config(url: str, headed: bool = False, output: str | None = None):
    """主流程：URL → 自动检测 DOM → LLM 生成配置 → 保存"""

    domain = urlparse(url).netloc.lower()
    session_name = domain.replace(".", "_")
    browser = BrowserService(session=session_name, headless=not headed)

    try:
        # Step 1: 打开页面
        print(f"[1/5] 打开页面: {url}")
        await browser.navigate(url)

        # Step 2: 处理弹窗 + 等待加载
        print(f"[2/5] 等待页面加载...")
        await browser.dismiss_cookie_banner()
        content_ready = await browser.wait_for_content(timeout_ms=20000)
        if not content_ready:
            print("  警告: 页面内容加载可能不完整")

        # Step 3: 滚动触发懒加载
        print(f"[3/5] 滚动触发懒加载...")
        await browser.scroll_page(times=3)
        await asyncio.sleep(1)

        # Step 4: JS 启发式检测职位容器
        print(f"[4/5] 分析页面结构...")
        container = await find_job_container(browser)

        if not container:
            print("\n错误: 未能检测到职位列表容器")
            print("可能原因:")
            print("  - 页面需要登录（尝试 --headed 模式手动登录）")
            print("  - 页面结构不符合常见模式")
            print("  - 职位列表尚未加载完成")
            print("\n可以使用手动模式:")
            print(f'  python gen_config.py --url "{url}" --file dom.html')
            sys.exit(1)

        print(f"  检测到容器: {container['selector']}")
        print(f"  子元素: {container['child_count']} 个 <{container['child_tag']}>")
        print(f"  评分: {container['score']}")
        print(f"  DOM 片段: {len(container['sample_html'])} 字符")

        # Step 5: 调用 LLM 生成配置
        print(f"[5/5] 调用 LLM 生成配置...")
        raw_config = call_doubao(container["sample_html"], url)

        try:
            config = json.loads(raw_config)
        except json.JSONDecodeError as e:
            print(f"\nLLM 返回内容无法解析为 JSON: {e}")
            print(f"原始返回:\n{raw_config}")
            sys.exit(1)

        # 校验和修正
        config = fix_url_mode(config, container["sample_html"])
        config["domain"] = domain

        required = ["card_selector", "fields", "url_mode"]
        missing = [k for k in required if k not in config]
        if missing:
            print(f"  警告: 配置缺少字段: {missing}")

        # 保存配置
        if output:
            output_path = Path(output)
        else:
            CONFIG_DIR.mkdir(exist_ok=True)
            filename = domain_to_filename(domain)
            output_path = CONFIG_DIR / filename

        output_path.write_text(
            json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        print(f"\n配置文件已生成: {output_path}\n")
        print(json.dumps(config, ensure_ascii=False, indent=2))
        print(f'\n验证: python run.py "{url}"')

    finally:
        await browser.close()


def main():
    parser = argparse.ArgumentParser(description="自动化配置生成：输入 URL 自动生成爬虫配置")
    parser.add_argument("url", help="招聘页面 URL")
    parser.add_argument("--headed", action="store_true", help="使用有头浏览器（可视化调试）")
    parser.add_argument("--output", "-o", help="输出文件路径（默认自动命名到 config/ 目录）")
    args = parser.parse_args()

    asyncio.run(auto_generate_config(args.url, headed=args.headed, output=args.output))


if __name__ == "__main__":
    main()
