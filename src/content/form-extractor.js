// ============================================
// 表单提取器
// 核心方案：提取简化 HTML + 为每个可交互元素分配 data-fh-id
// AI 分析 HTML 理解表单结构，通过 data-fh-id 定位元素（不再依赖 CSS selector）
// ============================================

/** 可交互元素的 selector */
const INTERACTIVE_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"])',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="spinbutton"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="searchbox"]',
  '[role="radio"]',
  '[role="checkbox"]',
].join(',');

/**
 * 递归穿透 Shadow DOM 查找所有匹配 selector 的元素
 * @param {Element|ShadowRoot|Document} root
 * @param {string} selector
 * @returns {Element[]}
 */
function deepQuerySelectorAll(root, selector) {
  const results = [];
  // 在当前层级查找
  try {
    const found = root.querySelectorAll(selector);
    results.push(...found);
  } catch (e) {}
  // 穿透 Shadow DOM
  const allElements = root.querySelectorAll('*');
  for (const el of allElements) {
    if (el.shadowRoot) {
      results.push(...deepQuerySelectorAll(el.shadowRoot, selector));
    }
  }
  return results;
}

/**
 * 提取简化 HTML + 元素映射表（主方案）
 * 在简化 HTML 的同时，为每个可交互元素打上 data-fh-id="N" 标记
 * 返回 HTML 字符串 + id→DOM Element 映射，AI 通过 data-fh-id 定位元素
 * 
 * @param {number} maxLen - 最大 HTML 字符长度
 * @returns {{ html: string, elementMap: Map<number, HTMLElement>, elementCount: number }}
 */
export function extractFormDOMWithMapping(maxLen = 15000) {
  // 先清除旧的 data-fh-id 标记
  document.querySelectorAll('[data-fh-id]').forEach(el => el.removeAttribute('data-fh-id'));

  // 为所有可交互元素打上 data-fh-id 标记，同时建立映射
  const elementMap = new Map();
  let nextId = 1;

  // 使用多种方式查找可交互元素，确保不遗漏
  // 策略1: 标准 querySelectorAll
  const standardElements = document.querySelectorAll(INTERACTIVE_SELECTOR);
  console.log(`[FormHelper] Strategy 1 - querySelectorAll: ${standardElements.length} elements`);
  
  // 策略2: 穿透 Shadow DOM 查找
  const shadowElements = deepQuerySelectorAll(document, INTERACTIVE_SELECTOR);
  console.log(`[FormHelper] Strategy 2 - deepQuerySelectorAll (Shadow DOM): ${shadowElements.length} elements`);

  // 合并去重
  const allInteractiveSet = new Set([...standardElements, ...shadowElements]);
  
  // 策略3: 检查 iframe（同源）
  const iframes = document.querySelectorAll('iframe');
  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) continue;
      const iframeInteractive = deepQuerySelectorAll(iframeDoc, INTERACTIVE_SELECTOR);
      console.log(`[FormHelper] Strategy 3 - iframe(${iframe.src || 'inline'}): ${iframeInteractive.length} elements`);
      iframeInteractive.forEach(el => allInteractiveSet.add(el));
    } catch (e) { /* 跨域 iframe */ }
  }

  console.log(`[FormHelper] Total unique interactive elements found: ${allInteractiveSet.size}`);

  // 去除存在祖先-后代关系的重复元素：
  // 如果一个外层元素（如 div[role="combobox"]）内部包含了一个真实的 input，
  // 两者都匹配 INTERACTIVE_SELECTOR，但实际是同一个表单字段。
  // 优先保留内层（真实 input），跳过外层容器，避免多个 id 指向同一个 input。
  const filteredElements = new Set(allInteractiveSet);
  for (const el of allInteractiveSet) {
    // 如果这个元素内部还包含其他匹配的可交互元素，说明它是外层容器
    const innerInteractives = el.querySelectorAll('input:not([type="hidden"]), textarea, select');
    if (innerInteractives.length > 0) {
      // 检查内部的 input 是否也在集合中
      for (const inner of innerInteractives) {
        if (allInteractiveSet.has(inner)) {
          // 外层容器移除，保留内层真实 input
          filteredElements.delete(el);
          console.log(`[FormHelper] 去重: 跳过外层容器 <${el.tagName.toLowerCase()} role="${el.getAttribute('role') || ''}"> (内含 <${inner.tagName.toLowerCase()}>)`);
          break;
        }
      }
    }
    // 同样检查 Shadow DOM 内部
    if (filteredElements.has(el) && el.shadowRoot) {
      const shadowInners = el.shadowRoot.querySelectorAll('input:not([type="hidden"]), textarea, select');
      for (const inner of shadowInners) {
        if (allInteractiveSet.has(inner)) {
          filteredElements.delete(el);
          console.log(`[FormHelper] 去重: 跳过外层容器 <${el.tagName.toLowerCase()}> (Shadow DOM 内含 <${inner.tagName.toLowerCase()}>)`);
          break;
        }
      }
    }
  }
  console.log(`[FormHelper] After ancestor-descendant dedup: ${filteredElements.size} elements (removed ${allInteractiveSet.size - filteredElements.size})`);
  
  for (const el of filteredElements) {
    // 跳过真正隐藏的（display:none 且无尺寸的）
    try {
      const ownerDoc = el.ownerDocument;
      const win = ownerDoc.defaultView || window;
      const style = win.getComputedStyle(el);
      if (style.display === 'none' && el.offsetWidth === 0 && el.offsetHeight === 0) continue;
    } catch (e) {}
    const id = nextId++;
    el.setAttribute('data-fh-id', String(id));
    elementMap.set(id, el);
  }

  console.log(`[FormHelper] Tagged ${elementMap.size} interactive elements with data-fh-id`);
  if (elementMap.size > 0) {
    console.log(`[FormHelper] First 5 elements:`, Array.from(elementMap.entries()).slice(0, 5).map(([id, el]) => {
      const tag = el.tagName.toLowerCase();
      const name = el.getAttribute('name') || '';
      const type = el.getAttribute('type') || '';
      const role = el.getAttribute('role') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      return `[${id}] <${tag} name="${name}" type="${type}" role="${role}" placeholder="${placeholder.substring(0, 20)}">`;
    }));
  } else {
    // 详细排查：打印页面上所有可能的表单相关元素
    const allInputs = document.querySelectorAll('input, select, textarea');
    const allRoles = document.querySelectorAll('[role]');
    const allContentEditable = document.querySelectorAll('[contenteditable]');
    const allShadowHosts = Array.from(document.querySelectorAll('*')).filter(el => el.shadowRoot);
    
    console.warn(`[FormHelper] ⚠️ No interactive elements matched INTERACTIVE_SELECTOR!`);
    console.warn(`[FormHelper] 📊 Page stats:`);
    console.warn(`  - input/select/textarea: ${allInputs.length}`);
    console.warn(`  - [role] elements: ${allRoles.length}`);
    console.warn(`  - [contenteditable]: ${allContentEditable.length}`);
    console.warn(`  - Shadow DOM hosts: ${allShadowHosts.length}`);
    
    if (allInputs.length > 0) {
      console.log(`[FormHelper] Raw input elements:`);
      Array.from(allInputs).slice(0, 15).forEach((el, i) => {
        const style = getComputedStyle(el);
        console.log(`  [${i}] <${el.tagName.toLowerCase()} type="${el.getAttribute('type')||''}" name="${el.getAttribute('name')||''}" hidden=${el.type==='hidden'} display=${style.display} visible=${style.visibility}>`);
      });
    }
    if (allRoles.length > 0) {
      console.log(`[FormHelper] Role elements:`, Array.from(allRoles).slice(0, 10).map(el => `<${el.tagName.toLowerCase()} role="${el.getAttribute('role')}">`));
    }
    if (allShadowHosts.length > 0) {
      console.log(`[FormHelper] Shadow DOM hosts:`, allShadowHosts.slice(0, 5).map(el => `<${el.tagName.toLowerCase()} class="${(el.className||'').toString().substring(0,40)}">`));
    }
  }

  // 用已有的简化 DOM 逻辑提取 HTML（data-fh-id 会被自动保留，因为它在白名单中）
  let html = _extractSimplifiedHTML(maxLen);
  
  // 验证：检查简化 HTML 中是否包含 data-fh-id
  const fhIdCount = (html.match(/data-fh-id/g) || []).length;
  console.log(`[FormHelper] Simplified HTML contains ${fhIdCount} data-fh-id markers (${html.length} chars)`);
  
  // 如果标记了元素但 HTML 中没有 data-fh-id，说明 simplifyDOM 把它们过滤掉了
  // 这时直接用 document.body 重新提取
  if (elementMap.size > 0 && fhIdCount === 0) {
    console.warn(`[FormHelper] simplifyDOM filtered out all tagged elements! Retrying with document.body...`);
    html = simplifyDOM(document.body);
    if (html.length > maxLen) {
      html = html.substring(0, maxLen) + '\n<!-- ... 内容过长已截断 -->';
    }
    const retryCount = (html.match(/data-fh-id/g) || []).length;
    console.log(`[FormHelper] Retry with body: ${retryCount} data-fh-id markers (${html.length} chars)`);
  }

  // 提取完成后清除 DOM 上的标记（不留痕迹）
  // 清理主文档 + Shadow DOM + iframe 中的标记
  const cleanFhId = (root) => {
    try {
      root.querySelectorAll('[data-fh-id]').forEach(el => el.removeAttribute('data-fh-id'));
      root.querySelectorAll('*').forEach(el => {
        if (el.shadowRoot) cleanFhId(el.shadowRoot);
      });
    } catch (e) {}
  };
  cleanFhId(document);
  document.querySelectorAll('iframe').forEach(iframe => {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) cleanFhId(iframeDoc);
    } catch (e) {}
  });

  return { html, elementMap, elementCount: elementMap.size };
}

/**
 * 带重试的表单 DOM + 映射提取（支持 SPA 动态渲染）
 * @param {number} maxWaitMs
 * @returns {Promise<{ html: string, elementMap: Map<number, HTMLElement>, elementCount: number }>}
 */
export function extractFormDOMWithMappingRetry(maxWaitMs = 2000) {
  return new Promise((resolve) => {
    const result = extractFormDOMWithMapping();
    if (result.elementCount > 0) {
      resolve(result);
      return;
    }

    let resolved = false;
    const observer = new MutationObserver(() => {
      if (resolved) return;
      const retryResult = extractFormDOMWithMapping();
      if (retryResult.elementCount > 0) {
        resolved = true;
        observer.disconnect();
        resolve(retryResult);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
    });

    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      resolve(extractFormDOMWithMapping());
    }, maxWaitMs);
  });
}

/**
 * 内部方法：提取简化 HTML（被 extractFormDOMWithMapping 调用）
 * 
 * 核心策略：
 * 1. 用 detectFormRegions 找到所有表单区域（form标签 + 补充策略）
 * 2. 对每个区域做 simplifyDOM
 * 3. 全部拼在一起输出给 AI
 */
function _extractSimplifiedHTML(maxLen = 15000) {
  const taggedElements = document.querySelectorAll('[data-fh-id]');

  // 没有标记元素时的兜底处理
  if (taggedElements.length === 0) {
    const iframeHtml = extractFromIframes();
    if (iframeHtml) return iframeHtml.substring(0, maxLen);
    const bodyHtml = simplifyDOM(document.body);
    if (bodyHtml.length > maxLen) {
      return bodyHtml.substring(0, maxLen) + '\n<!-- ... 内容过长已截断 -->';
    }
    return bodyHtml;
  }

  // ========== 核心：找到所有表单区域，simplifyDOM 后拼接 ==========
  const regions = detectFormRegions();
  console.log(`[FormHelper] _extractSimplifiedHTML: detectFormRegions 返回了 ${regions.length} 个区域, tagged元素共 ${taggedElements.length} 个`);

  const formHtmlParts = [];
  const coveredElements = new Set();

  for (const region of regions) {
    // body 作为区域时特殊处理（降级场景）
    if (region === document.body) {
      const bodyHtml = simplifyDOM(document.body);
      if (bodyHtml.length > maxLen) {
        return bodyHtml.substring(0, maxLen) + '\n<!-- ... 内容过长已截断 -->';
      }
      return bodyHtml;
    }

    const regionHtml = simplifyDOM(region);
    const fhIdCount = (regionHtml.match(/data-fh-id/g) || []).length;

    // 跳过不包含 tagged 元素的区域
    if (fhIdCount === 0) {
      console.log(`[FormHelper] Skipping region <${region.tagName.toLowerCase()} id="${region.id || ''}"> (no tagged elements)`);
      continue;
    }

    console.log(`[FormHelper] Region <${region.tagName.toLowerCase()} id="${region.id || ''}"> -> ${fhIdCount} fh-ids, ${regionHtml.length} chars`);
    formHtmlParts.push(regionHtml);

    // 记录这个区域覆盖了哪些 tagged 元素
    region.querySelectorAll('[data-fh-id]').forEach(el => coveredElements.add(el));
  }

  // 检查是否有 tagged 元素不在任何检测到的区域内
  // 注意：Shadow DOM 内的元素用 contains() 可能检测不到，需要特殊处理
  const uncoveredElements = Array.from(taggedElements).filter(el => {
    if (coveredElements.has(el)) return false;
    // 检查元素是否在某个 region 的 Shadow DOM 内
    for (const region of regions) {
      if (region.contains(el)) return false;
      // 穿透 Shadow DOM 检查：元素的 getRootNode() 链上是否有 region
      let root = el.getRootNode();
      while (root && root !== document) {
        if (root.host && region.contains(root.host)) return false;
        root = root.host ? root.host.getRootNode() : document;
      }
    }
    return true;
  });

  if (uncoveredElements.length > 0) {
    console.log(`[FormHelper] ${uncoveredElements.length} tagged elements are NOT inside any detected region, extracting their context...`);

    // 对不在已检测区域内的元素，找它们各自最近的合理容器
    const containers = _findFormItemContainers(uncoveredElements);
    const uniqueContainers = _deduplicateContainers(containers);

    for (const { container } of uniqueContainers) {
      const containerHtml = simplifyDOM(container);
      if (containerHtml) {
        formHtmlParts.push(containerHtml);
      }
    }
  }

  // 如果没有找到任何有效区域，降级用 body
  if (formHtmlParts.length === 0) {
    console.log(`[FormHelper] No regions with tagged elements, falling back to body`);
    const bodyHtml = simplifyDOM(document.body);
    if (bodyHtml.length > maxLen) {
      return bodyHtml.substring(0, maxLen) + '\n<!-- ... 内容过长已截断 -->';
    }
    return bodyHtml;
  }

  // ========== 拼接输出 ==========
  if (formHtmlParts.length === 1) {
    const html = formHtmlParts[0];
    console.log(`[FormHelper] Single region output: ${html.length} chars`);
    if (html.length > maxLen) {
      return html.substring(0, maxLen) + '\n<!-- ... 内容过长已截断 -->';
    }
    return html;
  }

  // 多个区域拼接
  let result = '<form-fields>\n';
  let truncated = false;

  for (let i = 0; i < formHtmlParts.length; i++) {
    const part = `<!-- 表单区域 ${i + 1} -->\n${formHtmlParts[i]}\n`;
    if (result.length + part.length + 20 > maxLen) {
      truncated = true;
      const remaining = maxLen - result.length - 50;
      if (remaining > 100) {
        result += part.substring(0, remaining);
      }
      break;
    }
    result += part;
  }

  result += '</form-fields>';

  if (truncated) {
    const includedCount = (result.match(/data-fh-id/g) || []).length;
    console.warn(`[FormHelper] Output truncated: ${includedCount}/${taggedElements.length} fields included`);
  }

  const totalFhIds = (result.match(/data-fh-id/g) || []).length;
  console.log(`[FormHelper] 最终输出: ${formHtmlParts.length} 个区域, ${totalFhIds}/${taggedElements.length} 个表单字段, ${result.length} chars`);
  return result;
}

/**
 * 为不在 <form> 内的表单元素查找最近的合理容器
 * 向上遍历 DOM 树，找到一个包含 label 或有表单语义的容器
 */
function _findFormItemContainers(taggedElements) {
  const results = [];

  for (const el of taggedElements) {
    let container = null;
    let current = el.parentElement;
    let depth = 0;

    while (current && current !== document.body && current !== document.documentElement && depth < 10) {
      const tagName = current.tagName;

      // 遇到 form / fieldset / section / article 这些语义容器就停
      if (tagName === 'FORM' || tagName === 'FIELDSET' || tagName === 'SECTION' || tagName === 'ARTICLE') {
        container = current;
        break;
      }

      // 如果当前层包含 label 且只有 1 个 tagged 元素，是理想的表单项容器
      const hasLabel = current.querySelector('label');
      const taggedCount = current.querySelectorAll('[data-fh-id]').length;
      if (hasLabel && taggedCount <= 1) {
        container = current;
        break;
      }

      // 如果当前层有多个 tagged 元素，说明已经是更大的容器了，用它
      if (taggedCount > 1) {
        container = current;
        break;
      }

      container = current;
      current = current.parentElement;
      depth++;
    }

    if (!container) {
      container = el.parentElement || el;
    }

    results.push({ element: el, container });
  }

  return results;
}

/**
 * 去重容器：如果一个容器包含另一个容器，保留外层的
 */
function _deduplicateContainers(containerResults) {
  const unique = [];
  const seen = new Set();

  for (const item of containerResults) {
    // 跳过已被其他容器包含的
    if (seen.has(item.container)) continue;

    // 检查是否被已有容器包含
    let isContained = false;
    for (const existing of unique) {
      if (existing.container.contains(item.container)) {
        isContained = true;
        break;
      }
      // 如果当前容器包含已有容器，替换
      if (item.container.contains(existing.container)) {
        const idx = unique.indexOf(existing);
        unique[idx] = item;
        seen.add(item.container);
        isContained = true;
        break;
      }
    }

    if (!isContained) {
      unique.push(item);
      seen.add(item.container);
    }
  }

  return unique;
}



/**
 * 带重试的表单 DOM 提取（支持 SPA 动态渲染场景）
 * @param {number} maxWaitMs - 最长等待毫秒数
 * @returns {Promise<string>}
 */
// extractSimplifiedFormDOMWithRetry 已被 extractFormDOMWithMappingRetry 取代

// ============================================
// DOM 简化器核心逻辑
// ============================================

/** 要保留的属性白名单 */
const KEEP_ATTRS = new Set([
  'name', 'id', 'type', 'value', 'placeholder', 'for',
  'role', 'aria-label', 'aria-labelledby', 'aria-describedby',
  'data-id', 'data-name', 'data-field', 'data-key',
  'data-fh-id', // 表单元素唯一标识，供 AI 返回填充指令时引用
  'checked', 'selected', 'disabled', 'readonly', 'required',
  'maxlength', 'minlength', 'min', 'max', 'step', 'pattern',
  'multiple', 'contenteditable',
  'href', // 保留 a 标签的 href 供 AI 理解上下文
]);

/** 这些属性只保留值中有意义的部分 */
const SIMPLIFY_ATTRS = new Set(['class']);

/** 完全跳过的标签（不输出自身和子节点） */
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE',
  'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME', 'OBJECT', 'EMBED',
  'IMG', 'PICTURE', 'SOURCE', 'MAP', 'AREA',
  'BR', 'HR', 'WBR',
]);

/** 这些标签直接展开子节点，不输出自身标签 */
const UNWRAP_TAGS = new Set([
  'SPAN', 'EM', 'STRONG', 'B', 'I', 'U', 'SMALL', 'SUB', 'SUP',
  'FONT', 'MARK', 'ABBR', 'CITE', 'CODE', 'KBD', 'SAMP', 'VAR',
]);

/**
 * 将一个 DOM 子树简化为干净的 HTML 字符串
 * 规则：
 * 1. 去掉 style 属性和内联样式
 * 2. 不可见元素输出为空的占位标签（保持 DOM 结构，确保选择器位置准确）
 * 3. 只保留白名单属性
 * 4. class 只保留有语义的部分（去掉样式类）
 * 5. 去掉纯装饰性标签（SVG, IMG 等）
 * 6. 简单标签（span, em 等）展开为纯文本
 * 7. 折叠多余空白
 * 
 * @param {HTMLElement} root
 * @returns {string}
 */
function simplifyDOM(root) {
  if (!root) return '';
  return _simplifyNode(root, 0);
}

function _simplifyNode(node, depth) {
  // 文本节点：返回清理后的文本
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim();
    return text ? text : '';
  }

  // 非元素节点跳过
  if (node.nodeType !== Node.ELEMENT_NODE) return '';

  const tag = node.tagName;

  // 完全跳过的标签（纯装饰性/功能性标签，不影响 DOM 位置结构）
  if (SKIP_TAGS.has(tag)) return '';

  // 不可见元素：输出空的占位标签，保持 DOM 结构的位置关系
  // 这样 AI 生成的 CSS 选择器（如 :nth-of-type）能在真实 DOM 中正确匹配
  if (!_isRelevantVisible(node)) {
    const tagLower = tag.toLowerCase();
    // 输出一个带 hidden 标记的空标签作为占位符
    if (['INPUT'].includes(tag)) {
      return `<${tagLower} hidden>`;
    }
    return `<${tagLower} hidden></${tagLower}>`;
  }

  // 展开标签：直接输出子内容
  if (UNWRAP_TAGS.has(tag)) {
    return _simplifyChildren(node, depth);
  }

  // 限制递归深度（防止极深嵌套）
  if (depth > 20) return '';

  // 构建简化后的标签
  const tagLower = tag.toLowerCase();
  const attrs = _simplifyAttrs(node);
  let childrenHtml = _simplifyChildren(node, depth + 1);

  // ===== Shadow DOM 穿透：如果元素有 shadowRoot，也遍历其内部内容 =====
  if (node.shadowRoot) {
    let shadowHtml = '';
    for (const child of node.shadowRoot.childNodes) {
      shadowHtml += _simplifyNode(child, depth + 1);
    }
    if (shadowHtml) {
      childrenHtml += shadowHtml;
    }
  }

  // 如果子节点为空且不是表单元素，跳过
  const isFormEl = _isFormElement(node);
  if (!childrenHtml && !isFormEl && !node.textContent.trim()) return '';

  // 自闭合标签
  if (['INPUT'].includes(tag)) {
    return `<${tagLower}${attrs}>`;
  }

  // 对于 DIV 这类容器，如果只有纯文本且很短，直接内联
  if (!isFormEl && tag === 'DIV' && childrenHtml.length < 50 && !childrenHtml.includes('<')) {
    if (!childrenHtml.trim()) return '';
    return `<${tagLower}${attrs}>${childrenHtml.trim()}</${tagLower}>`;
  }

  return `<${tagLower}${attrs}>${childrenHtml}</${tagLower}>`;
}

function _simplifyChildren(node, depth) {
  let html = '';
  for (const child of node.childNodes) {
    html += _simplifyNode(child, depth);
  }
  return html;
}

/**
 * 简化元素的属性，只保留白名单中有值的属性
 */
function _simplifyAttrs(node) {
  let result = '';

  // 保留白名单属性
  for (const attr of node.attributes) {
    const name = attr.name.toLowerCase();

    if (name === 'style') continue; // 完全去掉 style

    if (name === 'class') {
      // class 只保留有语义的部分
      const simplified = _simplifyClass(attr.value, node.tagName);
      if (simplified) result += ` class="${simplified}"`;
      continue;
    }

    if (KEEP_ATTRS.has(name)) {
      const val = attr.value;
      if (val !== undefined && val !== '') {
        result += ` ${name}="${_escapeAttr(val)}"`;
      } else {
        result += ` ${name}`; // 布尔属性如 checked, disabled
      }
    }
  }

  return result;
}

/**
 * 简化 class：只保留有语义意义的类名，去掉纯样式类
 * 保留规则：包含组件/语义关键词的类名
 */
function _simplifyClass(classStr, tagName) {
  if (!classStr) return '';

  const classes = classStr.split(/\s+/).filter(Boolean);

  // 有语义的关键词模式
  const semanticPatterns = [
    /form/i, /input/i, /select/i, /checkbox/i, /radio/i,
    /textarea/i, /label/i, /field/i, /control/i, /group/i,
    /picker/i, /date/i, /time/i, /switch/i, /toggle/i,
    /upload/i, /editor/i, /search/i, /filter/i,
    /button/i, /btn/i, /submit/i,
    /modal/i, /dialog/i, /drawer/i, /panel/i, /popup/i,
    /header/i, /footer/i, /title/i, /content/i,
    /item/i, /list/i, /option/i, /menu/i, /tab/i,
    /error/i, /valid/i, /required/i, /disabled/i,
    /wrapper/i, /wraper/i, /container/i, /main/i,
    // 组件库前缀（保留有完整语义的类名）
    /^ant-/, /^el-/, /^arco-/, /^t-/, /^n-/, /^ivu-/,
    /^wg-/, /^mod-/, /^mui/i, /^chakra/i,
  ];

  const kept = classes.filter(cls => {
    // 太短的类名（<=2字符）通常无意义
    if (cls.length <= 2) return false;
    // undefined/null 等无意义值
    if (/^(undefined|null|NaN)$/i.test(cls)) return false;
    return semanticPatterns.some(p => p.test(cls));
  });

  // 限制保留的类名数量（最多5个），避免 HTML 过长
  return kept.slice(0, 5).join(' ');
}

/**
 * 判断节点是否相关且"可见"
 * 对于表单字段相关的元素，即使父容器 display:none 也可能需要保留（如 select 的选项列表）
 */
function _isRelevantVisible(node) {
  // aria-hidden 的元素通常不需要
  if (node.getAttribute('aria-hidden') === 'true') {
    // 但如果内部有表单元素或已标记元素，仍然保留
    if (!node.querySelector('input, select, textarea, [role="textbox"], [role="combobox"], [data-fh-id]')) {
      return false;
    }
  }

  // 如果节点本身有 data-fh-id，始终保留（它是被标记的可交互元素）
  if (node.hasAttribute('data-fh-id')) return true;

  // 如果节点内部包含有 data-fh-id 的元素，必须保留容器
  if (node.querySelector('[data-fh-id]')) return true;

  try {
    const style = getComputedStyle(node);
    if (style.display === 'none') {
      // 隐藏的元素特殊处理：如果是下拉列表容器（含 option），保留
      const hasOptions = node.querySelector('[role="option"], option, [class*="option" i], [class*="list_item" i]');
      if (hasOptions) return true;
      // 如果包含表单输入元素（可能是后续动态显示的），也保留
      if (node.querySelector('input, select, textarea')) return true;
      return false;
    }
    // visibility:hidden 和 opacity:0：对容器节点不再跳过
    // 因为很多组件库会给外层容器设置这些属性，但内部的 input 仍然是可交互的
    // 只对叶子元素（无子元素）进行严格检查
    if (style.visibility === 'hidden' || style.opacity === '0') {
      if (node.children.length === 0) return false;
      // 容器节点：不跳过，继续遍历子节点
    }
  } catch (e) {
    // getComputedStyle 可能对 detached 节点失败，默认保留
  }

  return true;
}

/**
 * 判断是否是表单相关元素
 */
function _isFormElement(node) {
  const tag = node.tagName;
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'FORM', 'LABEL', 'OPTION', 'OPTGROUP', 'FIELDSET', 'LEGEND', 'DATALIST'].includes(tag)) {
    return true;
  }
  const role = node.getAttribute('role');
  if (['textbox', 'combobox', 'listbox', 'searchbox', 'spinbutton', 'switch', 'slider', 'option', 'radio', 'checkbox'].includes(role)) {
    return true;
  }
  return false;
}

function _escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================
// 表单区域检测（简化版，只保留核心策略）
// ============================================

/**
 * 检测页面中的表单区域
 * 多策略递进：先找 <form>，再用补充策略找不在 form 内的表单区域
 * 目标是找到尽可能多的表单区域
 * @returns {HTMLElement[]}
 */
export function detectFormRegions() {
  const regions = new Set();

  function countInputs(el) {
    // 标准 querySelectorAll
    const standard = el.querySelectorAll(INTERACTIVE_SELECTOR).length;
    // 已经被标记 data-fh-id 的元素（穿透 Shadow DOM 后标记的）
    const tagged = el.querySelectorAll('[data-fh-id]').length;
    // 穿透 Shadow DOM 查找
    const deep = deepQuerySelectorAll(el, INTERACTIVE_SELECTOR).length;
    return Math.max(standard, tagged, deep);
  }

  // ===== 策略1：原生 <form> 标签（最可靠） =====
  const allForms = document.querySelectorAll('form');
  console.log(`[FormHelper] detectFormRegions 策略1: 页面上共有 ${allForms.length} 个 <form> 标签`);
  allForms.forEach((f, i) => {
    const standardCount = f.querySelectorAll(INTERACTIVE_SELECTOR).length;
    const taggedCount = f.querySelectorAll('[data-fh-id]').length;
    const deepCount = deepQuerySelectorAll(f, INTERACTIVE_SELECTOR).length;
    const inputCount = countInputs(f);
    const rect = f.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0;
    console.log(`[FormHelper]   [form ${i+1}] <form id="${f.id || ''}" class="${(f.className || '').toString().substring(0, 60)}"> inputs=${inputCount}(standard=${standardCount}, tagged=${taggedCount}, deep=${deepCount}), visible=${visible}, size=${Math.round(rect.width)}x${Math.round(rect.height)}, childElements=${f.querySelectorAll('*').length}`, f);
    if (inputCount > 0) {
      regions.add(f);
      console.log(`[FormHelper]     ✅ 已加入 regions`);
    } else {
      console.log(`[FormHelper]     ❌ 跳过（无可交互元素）`);
    }
  });

  // ===== 策略2：ARIA role="form" =====
  const roleForms = document.querySelectorAll('[role="form"]');
  if (roleForms.length > 0) {
    console.log(`[FormHelper] detectFormRegions 策略2: 找到 ${roleForms.length} 个 [role="form"]`);
    roleForms.forEach(f => {
      if (countInputs(f) > 0) regions.add(f);
    });
  }

  // ===== 策略3：常见 form 容器标记 =====
  const markedSelectors = [
    '[data-form]', '[data-id="form"]',
    '[data-testid*="form" i]',
    '[class*="form-container" i]', '[class*="formContainer" i]', '[class*="form_container" i]',
  ];
  for (const sel of markedSelectors) {
    try {
      document.querySelectorAll(sel).forEach(f => {
        if (countInputs(f) > 0) regions.add(f);
      });
    } catch (e) { /* invalid selector */ }
  }

  // 策略1-3 找到的先记下，不立即 return，继续找补充
  const earlyCount = regions.size;
  console.log(`[FormHelper] detectFormRegions 策略1-3 合计: ${earlyCount} 个区域`);

  // ===== 策略4：class/id 包含 form 的容器、弹窗/抽屉 =====
  const classPatterns = [
    '[class*="form" i]:not(button):not(input):not(select):not(textarea):not(label):not(span)',
    '[id*="form" i]:not(button):not(input):not(select):not(textarea):not(label):not(span)',
    '[class*="modal" i]', '[class*="dialog" i]', '[class*="drawer" i]',
    '[role="dialog"]', '[role="alertdialog"]',
  ];

  let strategy4Count = 0;
  for (const selector of classPatterns) {
    try {
      document.querySelectorAll(selector).forEach(el => {
        const inputCount = countInputs(el);
        if (inputCount >= 1) {
          const bodyInputs = countInputs(document.body);
          // 排除覆盖面太广的容器（几乎包含所有input的就不要了）
          if (inputCount < bodyInputs * 0.9 || bodyInputs <= 5) {
            if (!regions.has(el)) {
              console.log(`[FormHelper]   策略4 新增: <${el.tagName.toLowerCase()} id="${el.id || ''}" class="${(el.className || '').toString().substring(0, 60)}"> inputs=${inputCount}`);
              strategy4Count++;
            }
            regions.add(el);
          }
        }
      });
    } catch (e) { /* invalid selector */ }
  }
  if (strategy4Count > 0) {
    console.log(`[FormHelper] detectFormRegions 策略4: 新增 ${strategy4Count} 个区域`);
  }

  // ===== 策略5：密度聚类（兜底：没有任何 form 容器时） =====
  if (regions.size === 0) {
    console.log(`[FormHelper] No form containers found, trying density clustering...`);
    const allInputs = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR)).filter(el => {
      try { return getComputedStyle(el).display !== 'none'; } catch { return true; }
    });

    if (allInputs.length > 0) {
      const containers = new Map();
      for (const input of allInputs) {
        let parent = input.parentElement;
        let depth = 0;
        while (parent && parent !== document.body && depth < 12) {
          const count = countInputs(parent);
          if (count >= 1) {
            containers.set(parent, Math.max(containers.get(parent) || 0, count));
          }
          parent = parent.parentElement;
          depth++;
        }
      }

      if (containers.size > 0) {
        const scored = [];
        for (const [el, inputCount] of containers) {
          const totalChildren = el.querySelectorAll('*').length;
          if (totalChildren > 1500) continue;
          const density = inputCount / Math.max(totalChildren, 1);
          scored.push({ el, score: inputCount * density, inputCount });
        }
        scored.sort((a, b) => b.score - a.score);

        const selected = [];
        for (const item of scored) {
          if (item.score < 0.01) break;
          const isContained = selected.some(s => s.el.contains(item.el) || item.el.contains(s.el));
          if (!isContained) selected.push(item);
          if (selected.length >= 5) break;
        }

        for (const item of selected) {
          regions.add(item.el);
        }
      }
    }
  }

  // ===== 去重并返回 =====
  if (regions.size > 0) {
    console.log(`[FormHelper] detectFormRegions 去重前: ${regions.size} 个区域:`);
    Array.from(regions).forEach((r, i) => {
      console.log(`[FormHelper]   [${i+1}] <${r.tagName.toLowerCase()} id="${r.id || ''}" class="${(r.className || '').toString().substring(0, 60)}"> children=${r.querySelectorAll('*').length}`);
    });
    const deduped = _deduplicateRegions(Array.from(regions));
    console.log(`[FormHelper] detectFormRegions 去重后: ${deduped.length} 个区域:`);
    deduped.forEach((r, i) => {
      console.log(`[FormHelper]   [${i+1}] <${r.tagName.toLowerCase()} id="${r.id || ''}" class="${(r.className || '').toString().substring(0, 60)}"> children=${r.querySelectorAll('*').length}`);
    });
    return deduped;
  }

  // 终极兜底：body
  console.log(`[FormHelper] ⚠️ 所有策略都未找到表单区域，降级使用 body`);
  return [document.body];
}

/**
 * 去重表单区域：当存在包含关系时，保留更小（更精确）的容器
 * 平级的多个区域全部保留
 */
function _deduplicateRegions(regions) {
  if (regions.length <= 1) return regions;

  // 按子元素数量从小到大排序
  regions.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);

  const result = [];
  for (const region of regions) {
    // 当前 region 已被已有更小区域的某个覆盖？（不太可能因为从小到大排序）
    const isContained = result.some(r => r.contains(region));
    if (isContained) continue;

    // 当前 region 包含了已有的更小区域？保留小的，跳过大的
    const containsExisting = result.some(r => region.contains(r));
    if (containsExisting) {
      console.log(`[FormHelper] dedup: skipping larger <${region.tagName.toLowerCase()} id="${region.id || ''}"> (contains smaller regions)`);
      continue;
    }

    result.push(region);
  }

  return result;
}



/**
 * 从同源 iframe 中提取简化 DOM
 */
function extractFromIframes() {
  const iframes = document.querySelectorAll('iframe');
  let html = '';

  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) continue;
      const body = iframeDoc.body;
      if (body) {
        html += `<!-- iframe: ${iframe.src || 'inline'} -->\n`;
        html += simplifyDOM(body);
      }
    } catch (e) {
      // 跨域 iframe 无法访问
    }
  }

  return html;
}

/**
 * 检测页面是否有表单区域（快速检查，用于判断是否显示填写按钮）
 */
export function hasFormOnPage() {
  const inputs = document.querySelectorAll(INTERACTIVE_SELECTOR);
  return inputs.length > 0;
}

// ============================================
// 兼容旧版 API（供 form-observer.js 使用）
// ============================================

/** 应跳过的字段类型 */
const SKIP_TYPES = ['hidden', 'submit', 'button', 'reset', 'image', 'file'];

/**
 * 提取表单区域内所有字段的值（用于表单提交后保存数据）
 * 这是一个精简版实现，只提取原生表单元素的 name/value
 * @param {HTMLElement} formElement
 * @returns {Array}
 */
export function extractFormFields(formElement) {
  const inputs = formElement.querySelectorAll('input, select, textarea');
  const fields = [];
  const seen = new Set();

  inputs.forEach(input => {
    const type = (input.type || 'text').toLowerCase();
    if (SKIP_TYPES.includes(type)) return;
    if (type === 'password') return;

    const name = input.name || input.id || '';
    if (!name) return;
    if (/csrf|token|nonce|captcha/i.test(name)) return;

    // radio/checkbox 未选中的跳过
    if (type === 'radio' && !input.checked) return;
    if (type === 'checkbox' && !input.checked) return;

    let value = '';
    if (input.tagName === 'SELECT') {
      const selected = input.options[input.selectedIndex];
      value = selected ? (selected.textContent.trim() || selected.value) : '';
    } else {
      value = input.value?.trim() || '';
    }
    if (!value) return;

    // radio/checkbox 同名去重
    if ((type === 'radio' || type === 'checkbox') && seen.has(name)) return;
    if (name) seen.add(name);

    // 简单 label 查找
    let label = '';
    if (input.id) {
      const labelEl = formElement.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (labelEl) label = labelEl.textContent.trim().replace(/[：:*\s]+$/g, '');
    }
    if (!label) {
      const parentLabel = input.closest('label');
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true);
        clone.querySelectorAll('input, select, textarea').forEach(el => el.remove());
        label = clone.textContent.trim().replace(/[：:*\s]+$/g, '');
      }
    }
    if (!label) label = input.placeholder || name;

    fields.push({ name, label, type, value, placeholder: input.placeholder || '' });
  });

  return fields;
}
