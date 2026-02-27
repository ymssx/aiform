// ============================================
// 表单 DOM 简化器
// 检测表单区域，输出简化的 HTML 给 AI 分析
// ============================================

/**
 * 从当前页面中提取简化的表单 DOM HTML
 * @param {number} maxLen - 最大 HTML 字符长度（防止 token 过多）
 * @returns {string} 简化后的 HTML 字符串
 */
export function extractSimplifiedFormDOM(maxLen = 15000) {
  const regions = detectFormRegions();

  let html = '';
  if (regions.length > 0) {
    for (const region of regions) {
      html += simplifyDOM(region);
    }
  }

  // 如果表单区域检测不到，尝试 iframe
  if (!html) {
    html = extractFromIframes();
  }

  // 如果还是空，兜底扫描 body
  if (!html) {
    html = simplifyDOM(document.body);
  }

  // 截断过长的 HTML
  if (html.length > maxLen) {
    html = html.substring(0, maxLen) + '\n<!-- ... 内容过长已截断 -->';
  }

  return html;
}

/**
 * 带重试的表单 DOM 提取（支持 SPA 动态渲染场景）
 * @param {number} maxWaitMs - 最长等待毫秒数
 * @returns {Promise<string>}
 */
export function extractSimplifiedFormDOMWithRetry(maxWaitMs = 2000) {
  return new Promise((resolve) => {
    const html = extractSimplifiedFormDOM();
    if (html && html.trim().length > 100) {
      resolve(html);
      return;
    }

    let resolved = false;
    const observer = new MutationObserver(() => {
      if (resolved) return;
      const retryHtml = extractSimplifiedFormDOM();
      if (retryHtml && retryHtml.trim().length > 100) {
        resolved = true;
        observer.disconnect();
        resolve(retryHtml);
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
      resolve(extractSimplifiedFormDOM());
    }, maxWaitMs);
  });
}

// ============================================
// DOM 简化器核心逻辑
// ============================================

/** 要保留的属性白名单 */
const KEEP_ATTRS = new Set([
  'name', 'id', 'type', 'value', 'placeholder', 'for',
  'role', 'aria-label', 'aria-labelledby', 'aria-describedby',
  'data-id', 'data-name', 'data-field', 'data-key',
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
  const childrenHtml = _simplifyChildren(node, depth + 1);

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
    // 但如果内部有表单元素，仍然保留
    if (!node.querySelector('input, select, textarea, [role="textbox"], [role="combobox"]')) {
      return false;
    }
  }

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
    // visibility:hidden 和 opacity:0 的元素跳过
    if (style.visibility === 'hidden' || style.opacity === '0') {
      return false;
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
 * @returns {HTMLElement[]}
 */
export function detectFormRegions() {
  const regions = new Set();
  const inputSelector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea, [role="textbox"], [role="combobox"], [contenteditable="true"]';

  function countInputs(el) {
    return el.querySelectorAll(inputSelector).length;
  }

  // 策略1：原生 <form> 标签
  document.querySelectorAll('form').forEach(f => {
    if (countInputs(f) > 0) regions.add(f);
  });

  // 策略2：ARIA role="form"
  document.querySelectorAll('[role="form"]').forEach(f => {
    if (countInputs(f) > 0) regions.add(f);
  });

  // 策略3：常见 form 容器标记
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

  if (regions.size > 0) return deduplicateRegions(Array.from(regions));

  // 策略4：class/id 包含 form 的容器
  const classPatterns = [
    '[class*="form" i]:not(button):not(input):not(select):not(textarea):not(label):not(span)',
    '[id*="form" i]:not(button):not(input):not(select):not(textarea):not(label):not(span)',
    // 弹窗/抽屉容器（表单经常在弹窗里）
    '[class*="modal" i]', '[class*="dialog" i]', '[class*="drawer" i]',
    '[role="dialog"]', '[role="alertdialog"]',
  ];

  for (const selector of classPatterns) {
    try {
      document.querySelectorAll(selector).forEach(el => {
        const inputCount = countInputs(el);
        if (inputCount >= 1) {
          const bodyInputs = countInputs(document.body);
          if (inputCount < bodyInputs * 0.9 || bodyInputs <= 5) {
            regions.add(el);
          }
        }
      });
    } catch (e) { /* invalid selector */ }
  }

  if (regions.size > 0) return deduplicateRegions(Array.from(regions));

  // 策略5：密度聚类
  const allInputs = Array.from(document.querySelectorAll(inputSelector)).filter(el => {
    try { return getComputedStyle(el).display !== 'none'; } catch { return true; }
  });

  if (allInputs.length === 0) return [];

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

    if (selected.length > 0) {
      return selected.map(s => s.el);
    }
  }

  // 策略6：公共祖先
  if (allInputs.length >= 2) {
    let ancestor = allInputs[0].parentElement;
    while (ancestor) {
      if (allInputs.every(el => ancestor.contains(el))) {
        if (ancestor !== document.body && ancestor !== document.documentElement) {
          return [ancestor];
        }
        break;
      }
      ancestor = ancestor.parentElement;
    }
  }

  // 策略7：body 兜底
  if (allInputs.length >= 1 && allInputs.length <= 50) {
    return [document.body];
  }

  return [];
}

/**
 * 去重：保留最精确的容器
 */
function deduplicateRegions(regions) {
  if (regions.length <= 1) return regions;
  regions.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);

  const result = [];
  for (const region of regions) {
    const isContained = result.some(r => r.contains(region));
    const contains = result.some(r => region.contains(r));
    if (!isContained && !contains) {
      result.push(region);
    }
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
  const inputSelector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), select, textarea, [role="textbox"], [role="combobox"], [contenteditable="true"]';
  const inputs = document.querySelectorAll(inputSelector);
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
