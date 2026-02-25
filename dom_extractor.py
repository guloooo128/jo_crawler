"""从浏览器页面中自动检测职位列表容器并提取精简 DOM

通过 JS 启发式评分找到页面中最可能是职位列表的重复结构容器，
返回 top N 候选，由调用方（LLM）做最终判断。
"""

import json

from browser_service import BrowserService

# 返回的最大候选容器数量
MAX_CANDIDATES = 5

# 在浏览器中执行的 JS 启发式检测脚本
# 返回评分最高的 top N 个候选容器
_HEURISTIC_JS = """
(() => {
    const MAX_CANDIDATES = """ + str(MAX_CANDIDATES) + """;
    const MAX_SAMPLE_CHILDREN = 3;
    const candidates = [];
    const allElements = document.querySelectorAll('body *');

    for (const el of allElements) {
        // 排除导航、页头页脚区域
        if (el.closest('nav, footer, header, [role="navigation"], [role="banner"], [role="contentinfo"]')) continue;
        // 排除不可见元素
        if (el.offsetHeight === 0 || el.offsetWidth === 0) continue;
        // 排除脚本/样式
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;

        const children = Array.from(el.children);
        if (children.length < 1) continue;

        // 按标签名分组子元素
        const signatures = {};
        for (const child of children) {
            const sig = child.tagName;
            signatures[sig] = (signatures[sig] || 0) + 1;
        }

        // 找到最多的同类子元素
        const [dominantTag, count] = Object.entries(signatures)
            .sort((a, b) => b[1] - a[1])[0];

        // ── 评分 ──
        let score = 0;

        // 重复子元素数量（log 缩放，最高 50 分）
        // 1 个: 0 分, 2 个: 10 分, 3 个: 15.8 分, 10 个: 33.2 分
        if (count >= 2) {
            score += Math.min(Math.log2(count) * 10, 50);
        }

        // 子元素含 <a> 链接的比例（最高 20 分）
        const dominantChildren = children.filter(c => c.tagName === dominantTag);
        const childrenWithLinks = dominantChildren.filter(c =>
            c.querySelector('a[href]') || (c.tagName === 'A' && c.href)
        ).length;
        score += (childrenWithLinks / dominantChildren.length) * 20;

        // 子元素文字丰富度（最高 25 分）
        const avgTextLen = dominantChildren.reduce((sum, c) =>
            sum + c.textContent.trim().length, 0) / dominantChildren.length;
        if (avgTextLen > 20) score += 15;
        if (avgTextLen > 50) score += 10;

        // 文字太短 → 可能是导航菜单（扣分）
        if (avgTextLen < 15) score -= 20;

        // 容器或子元素的 class/id 含 job 相关关键词（+15 分）
        const attrText = (
            (typeof el.className === 'string' ? el.className : '') + ' ' +
            (el.id || '') + ' ' +
            dominantChildren.map(c =>
                (typeof c.className === 'string' ? c.className : '') + ' ' + (c.id || '')
            ).join(' ')
        ).toLowerCase();
        const jobPatterns = ['job', 'position', 'career', 'vacancy', 'opening', 'posting', 'role', 'listing', 'result'];
        for (const pattern of jobPatterns) {
            if (attrText.includes(pattern)) { score += 15; break; }
        }

        // DOM 深度惩罚
        let depth = 0;
        let p = el;
        while (p.parentElement) { depth++; p = p.parentElement; }
        if (depth > 15) score -= 10;

        // 只收集有一定分数的候选
        if (score > 0) {
            candidates.push({
                element: el,
                score: score,
                childCount: count,
                dominantTag: dominantTag,
                avgTextLen: Math.round(avgTextLen),
            });
        }
    }

    if (candidates.length === 0) return JSON.stringify(null);

    // 按评分排序，取 top N
    candidates.sort((a, b) => b.score - a.score);
    const topN = candidates.slice(0, MAX_CANDIDATES);

    // ── 生成 CSS 选择器 ──
    function buildSelector(node) {
        if (node.id) return '#' + CSS.escape(node.id);
        let path = '';
        let current = node;
        while (current && current !== document.body) {
            let segment = current.tagName.toLowerCase();
            if (current.id) {
                segment = '#' + CSS.escape(current.id);
                path = segment + (path ? ' > ' + path : '');
                break;
            }
            if (current.className && typeof current.className === 'string') {
                const classes = current.className.trim().split(/\\s+/)
                    .filter(c => c.length > 0 && c.length < 30 && !/^[a-f0-9]{8}/i.test(c));
                if (classes.length > 0) {
                    segment += '.' + classes.slice(0, 2).map(c => CSS.escape(c)).join('.');
                }
            }
            const parent = current.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(current) + 1;
                    segment += ':nth-of-type(' + index + ')';
                }
            }
            path = segment + (path ? ' > ' + path : '');
            current = current.parentElement;
        }
        return path;
    }

    // ── 提取每个候选的精简 HTML ──
    const results = topN.map((cand, idx) => {
        const el = cand.element;
        const clone = el.cloneNode(false);
        const dominantChildren = Array.from(el.children)
            .filter(c => c.tagName === cand.dominantTag);
        for (let i = 0; i < Math.min(MAX_SAMPLE_CHILDREN, dominantChildren.length); i++) {
            clone.appendChild(dominantChildren[i].cloneNode(true));
        }
        return {
            index: idx,
            selector: buildSelector(el),
            child_count: cand.childCount,
            child_tag: cand.dominantTag.toLowerCase(),
            score: Math.round(cand.score * 10) / 10,
            avg_text_len: cand.avgTextLen,
            sample_html: clone.outerHTML,
        };
    });

    return JSON.stringify(results);
})()
"""


async def find_job_containers(browser: BrowserService) -> list[dict]:
    """在当前页面中检测候选职位列表容器

    Returns:
        候选列表（按评分降序），每个元素包含:
            index: 候选编号
            selector: CSS 选择器
            child_count: 同类子元素数量
            child_tag: 子元素标签名
            score: 启发式评分
            avg_text_len: 子元素平均文字长度
            sample_html: 容器 + 前 3 个子元素的 HTML
        未检测到返回空列表
    """
    raw = await browser.eval_js(_HEURISTIC_JS)

    try:
        result = json.loads(raw)
        if isinstance(result, str):
            result = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        return []

    if not result:
        return []

    if isinstance(result, dict):
        return [result]

    return result
