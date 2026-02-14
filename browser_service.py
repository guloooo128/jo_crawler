"""Agent-Browser CLI bridge service."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


class BrowserService:
    """Wraps agent-browser CLI for browser automation.

    Each instance manages a named session. All browser operations are
    executed by spawning `npx agent-browser <command>` subprocesses.
    """

    def __init__(
        self,
        session: str = "default",
        headless: bool = True,
        cdp_url: Optional[str] = None,
        timeout: int = 60000,
    ):
        self.session = session
        self.headless = headless
        self.cdp_url = cdp_url
        self.timeout = timeout

    # ── Core execution ──────────────────────────────────────────────

    async def _run(self, *args: str, timeout: Optional[int] = None) -> str:
        """Execute an agent-browser CLI command and return stdout."""
        cmd = ["npx", "agent-browser"]

        # Global options
        cmd.extend(["--session", self.session])
        if not self.headless:
            cmd.append("--headed")
        if self.cdp_url:
            cmd.extend(["--cdp", self.cdp_url])

        # Command-specific args
        cmd.extend(args)

        effective_timeout = (timeout or self.timeout) / 1000  # ms → seconds

        logger.debug(f"Running: {' '.join(cmd)}")

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(),
                timeout=effective_timeout,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise TimeoutError(f"Browser command timed out after {effective_timeout}s: {' '.join(args)}")

        stdout_str = stdout.decode("utf-8", errors="replace").strip()
        stderr_str = stderr.decode("utf-8", errors="replace").strip()

        if proc.returncode != 0:
            logger.warning(f"Browser command failed (rc={proc.returncode}): {stderr_str}")
            raise RuntimeError(f"agent-browser error: {stderr_str or stdout_str}")

        return stdout_str

    # ── Navigation ──────────────────────────────────────────────────

    async def navigate(self, url: str) -> None:
        """Navigate to a URL."""
        await self._run("open", url)

    async def navigate_with_retry(self, url: str, max_retries: int = 2) -> None:
        """Navigate with retry on failure."""
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                await self.navigate(url)
                return
            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    logger.warning(f"Navigation attempt {attempt + 1} failed, retrying: {e}")
                    await asyncio.sleep(2)
        raise last_error  # type: ignore

    async def go_back(self) -> None:
        await self._run("back")

    async def reload(self) -> None:
        await self._run("reload")

    # ── Snapshot & Info ─────────────────────────────────────────────

    async def get_snapshot(
        self,
        interactive: bool = True,
        max_depth: Optional[int] = 5,
        compact: bool = False,
    ) -> dict[str, Any]:
        """Get accessibility tree snapshot as JSON.

        Returns:
            {"tree": str, "refs": dict} where refs maps ref IDs to element info.
        """
        args = ["snapshot", "--json"]
        if interactive:
            args.append("-i")
        if compact:
            args.append("-c")
        if max_depth is not None:
            args.extend(["-d", str(max_depth)])

        raw = await self._run(*args)
        result = json.loads(raw)

        # agent-browser wraps output: {"success": bool, "data": {"snapshot": ..., "refs": ...}, "error": ...}
        # Normalize to {"tree": str, "refs": dict} for internal use.
        if "data" in result and isinstance(result["data"], dict):
            data = result["data"]
            return {
                "tree": data.get("snapshot", ""),
                "refs": data.get("refs", {}),
            }

        # Fallback: already in expected format or unknown structure
        return result

    async def get_snapshot_with_retry(
        self,
        interactive: bool = True,
        max_depth: int = 5,
        max_retries: int = 8,
        interval_ms: int = 2000,
        stable_threshold: int = 2,
    ) -> dict[str, Any]:
        """Get snapshot with stability-check retries.

        Polls snapshots until ref count stabilizes for `stable_threshold`
        consecutive attempts. This matches the original TypeScript behavior.
        """
        last_snapshot = None
        last_ref_count = 0
        stable_count = 0
        best_snapshot = None
        best_ref_count = 0

        logger.info(f"Getting snapshot with retry (max={max_retries}, interval={interval_ms}ms)...")

        for attempt in range(max_retries):
            try:
                snapshot = await self.get_snapshot(interactive=interactive, max_depth=max_depth)
                ref_count = len(snapshot.get("refs", {}))
                tree_len = len(snapshot.get("tree", ""))

                logger.info(f"  snapshot #{attempt + 1}: {ref_count} refs, tree={tree_len} chars")

                # Track best snapshot
                if ref_count > best_ref_count:
                    best_snapshot = snapshot
                    best_ref_count = ref_count

                # Check stability
                if ref_count > 0 and ref_count <= last_ref_count:
                    stable_count += 1
                else:
                    stable_count = 0

                if stable_count >= stable_threshold and ref_count > 0:
                    logger.info(f"  snapshot stable: {ref_count} refs (stable for {stable_count} polls)")
                    return snapshot

                last_ref_count = ref_count
                last_snapshot = snapshot

            except Exception as e:
                logger.warning(f"  snapshot #{attempt + 1} error: {e}")

            if attempt < max_retries - 1:
                await asyncio.sleep(interval_ms / 1000)

        logger.warning(f"Snapshot retries exhausted, returning best ({best_ref_count} refs)")
        return best_snapshot or last_snapshot or {}

    async def get_url(self) -> str:
        """Get current page URL."""
        return await self._run("get", "url")

    async def get_title(self) -> str:
        """Get current page title."""
        return await self._run("get", "title")

    async def get_text(self, selector: str = "") -> str:
        """Get text content of an element or the whole page."""
        if selector:
            return await self._run("get", "text", selector)
        return await self._run("get", "text")

    async def get_html(self, selector: str = "") -> str:
        """Get HTML content of an element."""
        if selector:
            return await self._run("get", "html", selector)
        return await self._run("get", "html")

    async def get_attribute(self, selector: str, attr_name: str) -> str:
        """Get an element's attribute value."""
        return await self._run("get", "attr", attr_name, selector)

    # ── Interaction ─────────────────────────────────────────────────

    async def click(self, selector: str) -> None:
        """Click an element (supports @ref notation)."""
        await self._run("click", selector)

    async def fill(self, selector: str, text: str) -> None:
        """Clear and fill an input field."""
        await self._run("fill", selector, text)

    async def type_text(self, selector: str, text: str) -> None:
        """Type into an element."""
        await self._run("type", selector, text)

    async def press(self, key: str) -> None:
        """Press a keyboard key."""
        await self._run("press", key)

    async def hover(self, selector: str) -> None:
        """Hover over an element."""
        await self._run("hover", selector)

    async def select(self, selector: str, value: str) -> None:
        """Select a dropdown option."""
        await self._run("select", selector, value)

    # ── Scrolling & Waiting ─────────────────────────────────────────

    async def scroll(self, direction: str = "down", px: Optional[int] = None) -> None:
        """Scroll the page."""
        args = ["scroll", direction]
        if px is not None:
            args.append(str(px))
        await self._run(*args)

    async def scroll_into_view(self, selector: str) -> None:
        """Scroll element into view."""
        await self._run("scrollintoview", selector)

    async def scroll_page(self, times: int = 3, delay_ms: int = 800) -> None:
        """Scroll page multiple times to trigger lazy loading.

        Matches the original TypeScript scrollPage() behavior.
        """
        logger.info(f"Scrolling page {times} times (delay={delay_ms}ms)...")
        for i in range(times):
            await self.scroll("down", 600)
            await asyncio.sleep(delay_ms / 1000)
            logger.debug(f"  scroll {i + 1}/{times} done")
        # Scroll back to top
        await self.scroll("up", times * 600)
        logger.info("Scroll complete, returned to top")

    async def wait(self, target: str) -> None:
        """Wait for an element selector or milliseconds."""
        await self._run("wait", target)

    async def wait_ms(self, ms: int) -> None:
        """Wait for specified milliseconds."""
        await self._run("wait", str(ms))

    async def wait_for_content(
        self,
        timeout_ms: int = 20000,
        min_elements: int = 5,
        poll_interval_ms: int = 1500,
        stable_threshold: int = 2,
    ) -> bool:
        """Wait until page has enough interactive elements and DOM is stable.

        Uses stability detection: requires `stable_threshold` consecutive polls
        with the same element count before returning. This matches the original
        TypeScript BrowserService.waitForContent() behavior.
        """
        elapsed = 0
        last_count = 0
        stable_count = 0

        logger.info(f"Waiting for content (min={min_elements} elements, timeout={timeout_ms}ms)...")

        while elapsed < timeout_ms:
            try:
                snapshot = await self.get_snapshot(interactive=True)
                ref_count = len(snapshot.get("refs", {}))
                logger.debug(f"  poll: {ref_count} refs (elapsed={elapsed}ms)")

                if ref_count >= min_elements:
                    if ref_count <= last_count:
                        stable_count += 1
                    else:
                        stable_count = 0

                    if stable_count >= stable_threshold:
                        logger.info(f"Content ready: {ref_count} refs (stable for {stable_count} polls)")
                        return True

                last_count = ref_count
            except Exception as e:
                logger.debug(f"  poll error: {e}")

            await asyncio.sleep(poll_interval_ms / 1000)
            elapsed += poll_interval_ms

        logger.warning(f"Content wait timed out after {timeout_ms}ms (last count: {last_count})")
        return last_count >= min_elements

    # ── Screenshots & Media ─────────────────────────────────────────

    async def screenshot(self, path: str, full_page: bool = False) -> None:
        """Take a screenshot."""
        args = ["screenshot", path]
        if full_page:
            args.append("--full")
        await self._run(*args)

    # ── JavaScript ──────────────────────────────────────────────────

    async def eval_js(self, code: str) -> str:
        """Execute JavaScript and return result."""
        return await self._run("eval", code)

    # ── Cookie & Storage ────────────────────────────────────────────

    async def dismiss_cookie_banner(self) -> bool:
        """Try to dismiss common cookie/privacy banners.

        Returns True if a banner was found and dismissed.
        Uses a 10-second timeout to prevent blocking on mismatched clicks.
        """
        try:
            return await asyncio.wait_for(
                self._dismiss_cookie_banner_inner(), timeout=10
            )
        except asyncio.TimeoutError:
            logger.warning("Cookie banner dismissal timed out (10s)")
            return False
        except Exception as e:
            logger.debug(f"Cookie banner dismissal failed: {e}")
            return False

    async def _dismiss_cookie_banner_inner(self) -> bool:
        """Inner implementation for cookie banner dismissal."""
        snapshot = await self.get_snapshot(interactive=True)
        refs = snapshot.get("refs", {})

        import re
        # Precise cookie/privacy patterns — avoid generic words like "close", "ok", "continue"
        # that could match navigation buttons and trigger page reloads.
        cookie_patterns = [
            r"accept.*cookie", r"accept all", r"agree.*cookie",
            r"allow.*cookie", r"cookie.*accept", r"cookie.*agree",
            r"got it", r"i understand", r"dismiss",
        ]

        for ref_id, ref_info in refs.items():
            role = ref_info.get("role", "")
            name = (ref_info.get("name", "") or "").lower()
            if role == "button" and name:
                for pattern in cookie_patterns:
                    if re.search(pattern, name, re.IGNORECASE):
                        logger.info(f"Cookie banner: clicking '{name}' (@{ref_id})")
                        await self.click(f"@{ref_id}")
                        await asyncio.sleep(1)
                        return True

        logger.debug(f"No cookie banner found in {len(refs)} refs")
        return False

    # ── Tab management ──────────────────────────────────────────────

    async def get_tabs(self) -> list[str]:
        """获取所有标签页列表"""
        try:
            tabs_raw = await self._run("tab")
            tab_lines = [l.strip() for l in tabs_raw.strip().splitlines() if l.strip()]
            return tab_lines
        except Exception as e:
            logger.warning(f"Failed to get tabs: {e}")
            return []

    async def switch_tab(self, index: int) -> None:
        """切换到指定索引的标签页"""
        await self._run("tab", str(index))

    async def close_tab(self) -> None:
        """关闭当前标签页"""
        await self._run("tab", "close")

    async def click_with_mouseevents(self, selector: str, index: int = 0) -> str:
        """使用完整鼠标事件序列点击元素（mousedown → mouseup → click）

        Args:
            selector: CSS选择器
            index: 如果有多个匹配元素，使用第几个（从0开始）

        Returns:
            'dispatched' 或 'not_found'
        """
        click_js = f"""
        (() => {{
            const el = document.querySelectorAll("{selector}")[{index}];
            if (!el) return 'not_found';
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const opts = {{bubbles: true, cancelable: true, view: window, clientX: x, clientY: y}};
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            return 'dispatched';
        }})()
        """
        result = await self.eval_js(click_js)
        return result

    # ── Session management ──────────────────────────────────────────

    async def close(self) -> None:
        """Close the browser session."""
        try:
            await self._run("close")
        except Exception:
            pass  # Best effort
