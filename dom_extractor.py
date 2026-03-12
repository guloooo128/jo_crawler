"""从浏览器页面中自动检测职位列表/详情页容器并提取精简 DOM

列表页：通过 JS 启发式评分找到页面中最可能是职位列表的重复结构容器。
详情页：找到内容最丰富的主区域，精简文本后返回 DOM 结构。
"""

import json

from browser_service import BrowserService

# 返回的最大候选容器数量
MAX_CANDIDATES = 5
# 详情页叶子节点文本截断长度
DETAIL_TEXT_TRUNCATE = 30

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

        // 重复子元素数量（最高 60 分）
        // 职位列表最显著的特征就是有大量重复卡片
        // 1 个: 0, 2 个: 5, 3 个: 10, 5 个: 25, 10 个: 40, 20+: 60
        if (count >= 2) {
            if (count <= 3) score += count * 5;         // 2-3: 低分，可能是布局容器
            else if (count <= 5) score += 15 + (count - 3) * 5;  // 4-5: 中等
            else score += Math.min(25 + count * 2, 60); // 6+: 高分，很可能是列表
        }

        // 子元素含 <a> 链接的比例（最高 15 分）
        const dominantChildren = children.filter(c => c.tagName === dominantTag);
        const childrenWithLinks = dominantChildren.filter(c =>
            c.querySelector('a[href]') || (c.tagName === 'A' && c.href)
        ).length;
        score += (childrenWithLinks / dominantChildren.length) * 15;

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
        const jobPatterns = ['job', 'position', 'career', 'vacancy', 'opening', 'posting', 'role', 'listing', 'result', 'item', 'list'];
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

    // ── 精简单个元素：移除 script/style/svg/img，去掉冗余属性 ──
    function trimNode(node) {
        // 移除无关标签
        node.querySelectorAll('script,style,svg,img,iframe,noscript,link,meta').forEach(s => s.remove());
        // 只保留有用的属性，去掉 style、data-*、事件等
        const keepAttrs = ['class', 'id', 'href', 'role', 'aria-label', 'rel', 'data-url'];
        node.querySelectorAll('*').forEach(el => {
            const toRemove = [];
            for (const attr of el.attributes) {
                if (!keepAttrs.includes(attr.name)) toRemove.push(attr.name);
            }
            toRemove.forEach(a => el.removeAttribute(a));
        });
        return node;
    }

    // ── 提取每个候选的精简 HTML ──
    const results = topN.map((cand, idx) => {
        const el = cand.element;
        const clone = el.cloneNode(false);
        const dominantChildren = Array.from(el.children)
            .filter(c => c.tagName === cand.dominantTag);
        for (let i = 0; i < Math.min(MAX_SAMPLE_CHILDREN, dominantChildren.length); i++) {
            clone.appendChild(trimNode(dominantChildren[i].cloneNode(true)));
        }
        // 推荐的 card_selector = 容器选择器 + ' > ' + 子元素标签
        const containerSel = buildSelector(el);
        const childTag = cand.dominantTag.toLowerCase();
        const cardSelector = containerSel + ' > ' + childTag;

        return {
            index: idx,
            selector: containerSel,
            card_selector: cardSelector,
            child_count: cand.childCount,
            child_tag: childTag,
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


# ── 详情页容器检测 ─────────────────────────────────────────────

_DETAIL_HEURISTIC_JS = """
(() => {
    const MAX_CANDIDATES = """ + str(MAX_CANDIDATES) + """;
    const TEXT_TRUNCATE = """ + str(DETAIL_TEXT_TRUNCATE) + """;
    const candidates = [];

    // 排除的标签
    const EXCLUDE_TAGS = new Set(['SCRIPT','STYLE','NAV','FOOTER','HEADER','IFRAME','NOSCRIPT','SVG']);

    // 职位详情关键词
    const detailPatterns = [
        'description', 'responsibility', 'responsibilities', 'requirement', 'requirements',
        'qualification', 'qualifications', 'about', 'overview', 'summary',
        'benefit', 'benefits', 'compensation', 'salary', 'experience',
        'job-detail', 'jobdetail', 'job_detail', 'jd-', 'posting',
        '职位描述', '岗位职责', '任职要求', '工作内容', '福利'
    ];

    const allElements = document.querySelectorAll('body *');

    for (const el of allElements) {
        if (EXCLUDE_TAGS.has(el.tagName)) continue;
        if (el.closest('nav, footer, header, [role="navigation"], [role="banner"], [role="contentinfo"], aside')) continue;
        if (el.offsetHeight === 0 || el.offsetWidth === 0) continue;

        // 取文本长度（排除嵌套的 script/style）
        const clone = el.cloneNode(true);
        clone.querySelectorAll('script,style,svg,iframe,noscript').forEach(s => s.remove());
        const text = clone.innerText || '';
        const textLen = text.trim().length;

        // 详情页主内容区域通常有较长文本
        if (textLen < 200) continue;

        let score = 0;

        // 文本长度评分（最高 40 分）
        if (textLen > 500) score += 20;
        if (textLen > 1000) score += 10;
        if (textLen > 2000) score += 10;

        // class/id 含详情关键词（+20 分）
        const attrText = (
            (typeof el.className === 'string' ? el.className : '') + ' ' +
            (el.id || '')
        ).toLowerCase();
        for (const pattern of detailPatterns) {
            if (attrText.includes(pattern)) { score += 20; break; }
        }

        // 包含结构化子标签 h1-h4, ul/ol, p（+15 分）
        const hasHeading = el.querySelector('h1, h2, h3, h4') !== null;
        const hasList = el.querySelector('ul, ol') !== null;
        const hasParagraph = el.querySelector('p') !== null;
        if (hasHeading) score += 5;
        if (hasList) score += 5;
        if (hasParagraph) score += 5;

        // 子元素丰富度（+10 分）
        if (el.children.length >= 3) score += 5;
        if (el.children.length >= 6) score += 5;

        // 占页面宽度比例（主内容通常较宽）
        const rect = el.getBoundingClientRect();
        const widthRatio = rect.width / window.innerWidth;
        if (widthRatio > 0.5) score += 10;
        if (widthRatio < 0.3) score -= 10;

        // DOM 深度惩罚（太深可能是子组件）
        let depth = 0;
        let p = el;
        while (p.parentElement) { depth++; p = p.parentElement; }
        if (depth > 15) score -= 10;

        // 包含过多卡片式子元素 → 可能是列表页而非详情页（扣分）
        const childTags = {};
        for (const child of el.children) {
            childTags[child.tagName] = (childTags[child.tagName] || 0) + 1;
        }
        const maxRepeat = Math.max(...Object.values(childTags), 0);
        if (maxRepeat > 10) score -= 15;

        if (score > 0) {
            candidates.push({ element: el, score, textLen });
        }
    }

    if (candidates.length === 0) return JSON.stringify(null);

    // 去重：如果父子关系的候选，优先取更精确的子元素（除非父元素评分高很多）
    candidates.sort((a, b) => b.score - a.score);

    const filtered = [];
    for (const cand of candidates) {
        let dominated = false;
        for (const existing of filtered) {
            if (existing.element.contains(cand.element) && existing.score >= cand.score) {
                dominated = true; break;
            }
            if (cand.element.contains(existing.element) && cand.score <= existing.score + 10) {
                dominated = true; break;
            }
        }
        if (!dominated) filtered.push(cand);
        if (filtered.length >= MAX_CANDIDATES) break;
    }

    // 生成 CSS 选择器
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

    // 精简 DOM：保留结构，截断文本
    function trimDetailNode(node) {
        node.querySelectorAll('script,style,svg,img,iframe,noscript,link,meta').forEach(s => s.remove());
        const keepAttrs = ['class', 'id', 'href', 'role', 'aria-label', 'rel'];
        node.querySelectorAll('*').forEach(el => {
            const toRemove = [];
            for (const attr of el.attributes) {
                if (!keepAttrs.includes(attr.name)) toRemove.push(attr.name);
            }
            toRemove.forEach(a => el.removeAttribute(a));
        });
        // 截断叶子节点的文本
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        for (const tn of textNodes) {
            const trimmed = tn.textContent.trim();
            if (trimmed.length > TEXT_TRUNCATE) {
                tn.textContent = trimmed.substring(0, TEXT_TRUNCATE) + '...';
            }
        }
        return node;
    }

    const results = filtered.map((cand, idx) => {
        const el = cand.element;
        const clone = el.cloneNode(true);
        const trimmed = trimDetailNode(clone);
        // 限制输出大小
        let html = trimmed.outerHTML;
        if (html.length > 8000) {
            html = html.substring(0, 8000) + '<!-- truncated -->';
        }
        return {
            index: idx,
            selector: buildSelector(el),
            score: Math.round(cand.score * 10) / 10,
            text_len: cand.textLen,
            sample_html: html,
        };
    });

    return JSON.stringify(results);
})()
"""


async def find_detail_containers(browser: BrowserService) -> list[dict]:
    """在当前详情页中检测候选内容容器

    与 find_job_containers 不同，这里找的是内容最丰富的主区域，
    而非重复卡片结构。返回的 sample_html 中文本已被截断以节省 token。

    Returns:
        候选列表（按评分降序），每个元素包含:
            index: 候选编号
            selector: CSS 选择器
            score: 启发式评分
            text_len: 原始文本长度
            sample_html: 精简后的 HTML（文本已截断）
        未检测到返回空列表
    """
    raw = await browser.eval_js(_DETAIL_HEURISTIC_JS)

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
