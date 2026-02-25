"""配置驱动的职位爬虫核心模块"""

import json
from browser_service import BrowserService


def _parse_json(raw: str):
    """解析 eval_js 返回的可能多层编码的 JSON"""
    result = raw
    for _ in range(3):
        if isinstance(result, (dict, list)):
            return result
        result = json.loads(result)
    return result


def _build_fields_js(fields: dict) -> str:
    """根据 field_map 生成 JS 字段提取代码片段"""
    parts = []
    for name, selector in fields.items():
        escaped = selector.replace("'", "\\'")
        parts.append(
            f"    {name}: card.querySelector('{escaped}')?.textContent?.trim() || ''"
        )
    return ",\n".join(parts)


class JobCrawler:
    """配置驱动的职位爬虫

    通过 JSON 配置文件定义：
    - card_selector: 定位职位卡片
    - fields: 从卡片提取字段
    - url_mode: 如何获取详情 URL
    """

    def __init__(self, browser: BrowserService):
        self.browser = browser

    async def crawl(self, url: str, config: dict, limit: int = 0) -> list[dict]:
        """根据配置爬取职位列表

        Args:
            url: 目标页面 URL
            config: 站点配置字典
            limit: 最大爬取数量，0 表示不限制

        Returns:
            职位列表 [{title, url, date?, category?, location?, ...}]
        """
        browser = self.browser

        # 1. 打开页面
        print(f"  打开: {url}")
        await browser.navigate(url)

        # 2. 执行 pre_actions
        for action in config.get("pre_actions", []):
            await self._run_action(action)

        # 2.5 自动尝试关闭弹窗
        try:
            dismissed = await browser.dismiss_popup()
            if dismissed:
                print("  关闭了弹窗")
                await browser.wait_ms(500)
        except Exception:
            pass

        # 3. 提取卡片字段数据
        card_selector = config["card_selector"]
        fields = config["fields"]
        print(f"  提取卡片: {card_selector}")

        jobs = await self._extract_fields(card_selector, fields)
        if not jobs:
            print("  未找到卡片")
            return []
        print(f"  找到 {len(jobs)} 个卡片")

        # 截断到 limit
        if limit > 0 and len(jobs) > limit:
            print(f"  限制爬取前 {limit} 个")
            jobs = jobs[:limit]

        # 4. 获取 detail URL
        url_mode = config.get("url_mode", "href")
        wait_ms = config.get("wait_after_click_ms", 2000)

        url_selector = config.get("url_selector")

        if url_mode == "href":
            jobs = await self._get_urls_href(card_selector, url_selector, jobs)
        elif url_mode == "click_newtab":
            jobs = await self._get_urls_click_newtab(card_selector, jobs, wait_ms, url_selector)
        elif url_mode == "click_navigate":
            jobs = await self._get_urls_click_navigate(card_selector, jobs, wait_ms, url_selector)
        elif url_mode.startswith("attr:"):
            attr_name = url_mode[5:]
            jobs = await self._get_urls_attr(card_selector, attr_name, config.get("url_selector"), jobs)
        elif url_mode == "js":
            url_js = config.get("url_js", "")
            jobs = await self._get_urls_js(card_selector, url_js, jobs)
        elif url_mode == "none":
            pass  # 不需要提取 URL
        else:
            print(f"  未知 url_mode: {url_mode}")

        return jobs

    # ── Pre-actions ──────────────────────────────────────────────

    async def _run_action(self, action: dict):
        """执行单个预操作"""
        act = action["action"]
        if act == "wait_for_content":
            timeout = action.get("timeout_ms", 20000)
            print(f"  等待内容加载 (timeout={timeout}ms)...")
            await self.browser.wait_for_content(timeout_ms=timeout)
        elif act == "wait":
            ms = action.get("ms", 1000)
            await self.browser.wait_ms(ms)
        elif act == "scroll":
            times = action.get("times", 3)
            print(f"  滚动页面 {times} 次...")
            await self.browser.scroll_page(times=times)
        elif act == "click":
            selector = action["selector"]
            print(f"  点击: {selector}")
            await self.browser.click(selector)
            await self.browser.wait_ms(action.get("wait_ms", 1000))
        elif act == "dismiss_popup":
            print("  尝试关闭弹窗...")
            result = await self.browser.dismiss_popup()
            if result:
                print("  弹窗已关闭")
        else:
            print(f"  未知操作: {act}")

    # ── Field extraction ─────────────────────────────────────────

    async def _extract_fields(self, card_selector: str, fields: dict) -> list[dict]:
        """用一次 JS 调用提取所有卡片的字段数据"""
        fields_js = _build_fields_js(fields)
        escaped_selector = card_selector.replace("'", "\\'")

        js = f"""
        (() => {{
            const cards = document.querySelectorAll('{escaped_selector}');
            return JSON.stringify(Array.from(cards).map((card, i) => ({{
                _index: i,
{fields_js}
            }})));
        }})()
        """
        raw = await self.browser.eval_js(js)
        return _parse_json(raw)

    # ── URL extraction strategies ────────────────────────────────

    async def _get_urls_href(self, card_selector: str, url_selector: str | None, jobs: list[dict]) -> list[dict]:
        """从 href 属性提取 URL"""
        escaped_card = card_selector.replace("'", "\\'")
        if url_selector:
            escaped_url = url_selector.replace("'", "\\'")
            sub_query = f"card.querySelector('{escaped_url}')"
        else:
            sub_query = "card.querySelector('a') || card"

        js = f"""
        (() => {{
            const cards = document.querySelectorAll('{escaped_card}');
            return JSON.stringify(Array.from(cards).map(card => {{
                const el = {sub_query};
                return el ? (el.href || el.getAttribute('href') || '') : '';
            }}));
        }})()
        """
        raw = await self.browser.eval_js(js)
        urls = _parse_json(raw)

        for i, job in enumerate(jobs):
            job["url"] = urls[i] if i < len(urls) else ""
        return jobs

    async def _get_urls_attr(self, card_selector: str, attr_name: str, url_selector: str | None, jobs: list[dict]) -> list[dict]:
        """从指定属性提取 URL"""
        escaped_card = card_selector.replace("'", "\\'")
        escaped_attr = attr_name.replace("'", "\\'")
        if url_selector:
            escaped_url = url_selector.replace("'", "\\'")
            sub_query = f"card.querySelector('{escaped_url}')"
        else:
            sub_query = "card"

        js = f"""
        (() => {{
            const cards = document.querySelectorAll('{escaped_card}');
            return JSON.stringify(Array.from(cards).map(card => {{
                const el = {sub_query};
                return el ? (el.getAttribute('{escaped_attr}') || '') : '';
            }}));
        }})()
        """
        raw = await self.browser.eval_js(js)
        urls = _parse_json(raw)

        for i, job in enumerate(jobs):
            job["url"] = urls[i] if i < len(urls) else ""
        return jobs

    async def _get_urls_js(self, card_selector: str, url_js: str, jobs: list[dict]) -> list[dict]:
        """用自定义 JS 表达式从每个卡片提取 URL

        url_js 中可用变量: card (当前卡片元素), index (卡片索引)
        表达式应返回一个 URL 字符串。
        """
        escaped_card = card_selector.replace("'", "\\'")
        js = f"""
        (() => {{
            const cards = document.querySelectorAll('{escaped_card}');
            return JSON.stringify(Array.from(cards).map((card, index) => {{
                try {{
                    return {url_js};
                }} catch(e) {{
                    return '';
                }}
            }}));
        }})()
        """
        raw = await self.browser.eval_js(js)
        urls = _parse_json(raw)

        for i, job in enumerate(jobs):
            job["url"] = urls[i] if i < len(urls) else ""
        return jobs

    def _parse_click_result(self, raw: str) -> dict:
        """解析 JS 返回的 JSON 结果"""
        try:
            result = _parse_json(raw)
            if isinstance(result, dict):
                return result
        except Exception:
            pass
        return {"status": "unknown"}

    async def _click_card_target(self, card_selector: str, index: int, url_selector: str | None = None) -> dict:
        """标记第 index 个卡片，用 Playwright 点击。

        如果有 url_selector 且初始不可见，先点击卡片展开，再点击 url_selector。
        返回 {status, matched, tag, text} 或 {status: 'not_found'}。
        """
        import asyncio
        escaped = card_selector.replace('"', '\\"')

        # Step 1: 标记卡片并滚动到可见
        mark_js = f"""
        (() => {{
            const old = document.querySelector('[data-crawler-click-target]');
            if (old) old.removeAttribute('data-crawler-click-target');
            const cards = document.querySelectorAll("{escaped}");
            if (cards.length <= {index}) return JSON.stringify({{status: 'not_found'}});
            const card = cards[{index}];
            card.setAttribute('data-crawler-click-target', 'true');
            card.scrollIntoView({{block: 'center'}});
            return JSON.stringify({{status: 'ok'}});
        }})()
        """
        raw = await self.browser.eval_js(mark_js)
        info = self._parse_click_result(raw)
        if info.get("status") != "ok":
            return info

        # Step 2: 如果有 url_selector，检查是否可见
        if url_selector:
            escaped_url = url_selector.replace('"', '\\"')
            vis_js = f"""
            (() => {{
                const card = document.querySelector('[data-crawler-click-target]');
                const btn = card.querySelector("{escaped_url}");
                if (!btn) return JSON.stringify({{visible: false, found: false}});
                const s = window.getComputedStyle(btn);
                const visible = s.visibility !== 'hidden' && s.display !== 'none'
                    && s.opacity !== '0' && btn.getBoundingClientRect().height > 0;
                return JSON.stringify({{visible, found: true}});
            }})()
            """
            vis_raw = await self.browser.eval_js(vis_js)
            vis_info = self._parse_click_result(vis_raw)

            if vis_info.get("found") and not vis_info.get("visible"):
                # 按钮存在但不可见 → 先点击卡片展开
                try:
                    await asyncio.wait_for(
                        self.browser.click("[data-crawler-click-target]"),
                        timeout=10
                    )
                except (asyncio.TimeoutError, Exception):
                    pass
                await self.browser.wait_ms(1000)

                # 标记 url_selector 按钮
                mark_btn_js = f"""
                (() => {{
                    const card = document.querySelector('[data-crawler-click-target]');
                    card.removeAttribute('data-crawler-click-target');
                    const btn = card.querySelector("{escaped_url}");
                    if (!btn) return JSON.stringify({{status: 'not_found'}});
                    btn.setAttribute('data-crawler-click-target', 'true');
                    const s = window.getComputedStyle(btn);
                    return JSON.stringify({{
                        status: 'ok', matched: 'url_selector_after_expand',
                        tag: btn.tagName,
                        text: btn.textContent?.trim()?.substring(0, 30) || '',
                        visible: s.visibility !== 'hidden'
                    }});
                }})()
                """
                raw2 = await self.browser.eval_js(mark_btn_js)
                btn_info = self._parse_click_result(raw2)

                if btn_info.get("visible"):
                    # 按钮现在可见了，点击它
                    try:
                        await asyncio.wait_for(
                            self.browser.click("[data-crawler-click-target]"),
                            timeout=10
                        )
                    except (asyncio.TimeoutError, Exception) as e:
                        print(f"      按钮点击超时: {e}")
                    return btn_info

                # 按钮展开后还是不可见，卡片已经被点击过了，返回卡片点击结果
                return {"status": "ok", "matched": "card", "tag": "DIV", "text": ""}

            elif vis_info.get("found") and vis_info.get("visible"):
                # 按钮直接可见，标记按钮并点击
                mark_btn_js = f"""
                (() => {{
                    const card = document.querySelector('[data-crawler-click-target]');
                    card.removeAttribute('data-crawler-click-target');
                    const btn = card.querySelector("{escaped_url}");
                    btn.setAttribute('data-crawler-click-target', 'true');
                    return JSON.stringify({{
                        status: 'ok', matched: 'url_selector',
                        tag: btn.tagName,
                        text: btn.textContent?.trim()?.substring(0, 30) || ''
                    }});
                }})()
                """
                raw2 = await self.browser.eval_js(mark_btn_js)
                btn_info = self._parse_click_result(raw2)
                try:
                    await asyncio.wait_for(
                        self.browser.click("[data-crawler-click-target]"),
                        timeout=10
                    )
                except (asyncio.TimeoutError, Exception) as e:
                    print(f"      按钮点击超时: {e}")
                return btn_info

        # 没有 url_selector 或 url_selector 不存在 → 智能查找点击目标
        # 优先级：带 href 的 <a> → 卡片本身（直接点击中心）
        # 不点击无 href 的 <a>，因为在 SPA 中可能触发展开而非跳转
        find_js = f"""
        (() => {{
            const card = document.querySelector('[data-crawler-click-target]');
            // 找带 href 的 <a>（真正的链接）
            const links = card.querySelectorAll('a[href]');
            for (const a of links) {{
                const href = a.getAttribute('href') || '';
                if (href && href !== '#' && href !== 'javascript:void(0)') {{
                    card.removeAttribute('data-crawler-click-target');
                    a.setAttribute('data-crawler-click-target', 'true');
                    return JSON.stringify({{status: 'ok', matched: 'a_href', tag: 'A', text: a.textContent?.trim()?.substring(0, 30) || ''}});
                }}
            }}
            // 没有有效链接，直接点击卡片本身
            return JSON.stringify({{status: 'ok', matched: 'card', tag: card.tagName, text: ''}});
        }})()
        """
        raw3 = await self.browser.eval_js(find_js)
        click_info = self._parse_click_result(raw3)

        try:
            await asyncio.wait_for(
                self.browser.click("[data-crawler-click-target]"),
                timeout=10
            )
        except (asyncio.TimeoutError, Exception) as e:
            print(f"      点击超时: {e}")

        return click_info

    async def _get_urls_click_newtab(self, card_selector: str, jobs: list[dict], wait_ms: int, url_selector: str | None = None) -> list[dict]:
        """逐个点击卡片，从新 tab 获取 URL。

        回退链：url_selector 点击 → 卡片本身点击 → href 属性提取
        """
        list_url = await self.browser.get_url()
        fallback_to_href = False
        # 如果 url_selector 点击无效，降级为直接点击卡片
        effective_url_selector = url_selector

        for i, job in enumerate(jobs):
            if fallback_to_href:
                break

            print(f"    [{i+1}/{len(jobs)}] 点击: {job.get('title', '?')[:40]}...")

            tabs_before = await self.browser.get_tabs()

            click_info = await self._click_card_target(card_selector, i, effective_url_selector)
            if click_info.get("status") == "not_found":
                print(f"      卡片不存在，跳过")
                job["url"] = ""
                continue
            if click_info.get("matched"):
                print(f"      点击目标: {click_info['matched']} <{click_info.get('tag', '?')}> {click_info.get('text', '')[:20]}")

            await self.browser.wait_ms(wait_ms)

            detail_url = await self._detect_navigation(list_url, tabs_before)
            if detail_url:
                job["url"] = detail_url
            elif i == 0:
                # 第一个卡片未跳转
                if effective_url_selector:
                    # url_selector 无效，降级为直接点击卡片本身
                    # 先 reload 恢复 DOM 状态（url_selector 点击可能展开/修改了卡片）
                    print(f"      (未跳转) url_selector 无效，reload 后尝试直接点击卡片...")
                    effective_url_selector = None
                    await self.browser.reload()
                    await self.browser.wait_for_content(timeout_ms=10000)

                    tabs_before2 = await self.browser.get_tabs()
                    click_info2 = await self._click_card_target(card_selector, i, None)
                    if click_info2.get("matched"):
                        print(f"      点击目标: {click_info2['matched']} <{click_info2.get('tag', '?')}> {click_info2.get('text', '')[:20]}")
                    await self.browser.wait_ms(wait_ms)

                    detail_url2 = await self._detect_navigation(list_url, tabs_before2)
                    if detail_url2:
                        job["url"] = detail_url2
                    else:
                        print(f"      (未跳转) 点击卡片也无效，回退到 href 提取")
                        fallback_to_href = True
                else:
                    print(f"      (未跳转) 点击无效，回退到 href 提取")
                    fallback_to_href = True
            else:
                job["url"] = ""
                print(f"      (未跳转)")

        if fallback_to_href:
            print(f"    回退: 从 href 属性提取 URL")
            jobs = await self._get_urls_href(card_selector, url_selector, jobs)

        return jobs

    async def _detect_navigation(self, list_url: str, tabs_before: list[str]) -> str | None:
        """检测点击后是否发生了导航（新 tab 或 URL 变化）

        Returns:
            detail URL 字符串，或 None 表示未跳转
        """
        tabs_after = await self.browser.get_tabs()
        if len(tabs_after) > len(tabs_before):
            # 新 tab 打开了
            await self.browser.switch_tab(len(tabs_after) - 1)
            await self.browser.wait_ms(1000)
            detail_url = await self.browser.get_url()
            print(f"      -> {detail_url}")
            await self.browser.close_tab()
            await self.browser.switch_tab(0)
            await self.browser.wait_ms(500)
            return detail_url

        # 检测 URL 变化（SPA 路由跳转）
        current_url = await self.browser.get_url()
        if current_url == list_url:
            await self.browser.wait_ms(1000)
            current_url = await self.browser.get_url()

        if current_url != list_url:
            print(f"      (页内跳转) -> {current_url}")
            await self.browser.go_back()
            await self.browser.wait_ms(1500)
            return current_url

        return None

    async def _get_urls_click_navigate(self, card_selector: str, jobs: list[dict], wait_ms: int, url_selector: str | None = None) -> list[dict]:
        """逐个点击卡片，从 URL 变化获取详情链接"""
        for i, job in enumerate(jobs):
            print(f"    [{i+1}/{len(jobs)}] 点击: {job.get('title', '?')[:40]}...")

            click_info = await self._click_card_target(card_selector, i, url_selector)
            if click_info.get("status") == "not_found":
                job["url"] = ""
                continue
            if click_info.get("matched"):
                print(f"      点击目标: {click_info['matched']} <{click_info.get('tag', '?')}> {click_info.get('text', '')[:20]}")

            await self.browser.wait_ms(wait_ms)

            detail_url = await self.browser.get_url()
            job["url"] = detail_url
            print(f"      -> {detail_url}")

            # 返回列表页
            await self.browser.go_back()
            await self.browser.wait_ms(1500)

        return jobs
