// ============================================
// 表单数据采集器（增强版 v3）
// 多策略智能检测表单区域，大幅提升检测准确率
// 支持 SPA/Shadow DOM/iframe/动态渲染/现代UI框架
// 组件库选择器通过 component-adapters.js 统一管理
// ============================================

import {
  buildInputSelector,
  buildContainerSelectors,
  buildLabelSelectors,
  inferTypeByAdapters,
  extractOptionsByAdapters,
  isAdapterSearchInput,
} from './component-adapters.js';

/**
 * 提取表单区域内的所有字段数据（提交后用，含 value）
 * @param {HTMLFormElement|HTMLElement} formElement - 表单元素或包含输入元素的容器
 * @returns {Array} 精简后的字段数据列表
 */
export function extractFormFields(formElement) {
  const inputs = getAllInputElements(formElement);
  const fields = [];

  inputs.forEach(input => {
    const field = extractSingleField(input);
    if (field) fields.push(field);
  });

  return fields;
}

/**
 * 提取当前页面中所有表单区域的结构（自动填写时采集，不含 value）
 * @returns {Array} 表单结构数据
 */
export function extractFormSchema() {
  const schema = _extractFormSchemaInternal();
  if (schema.length > 0) return schema;

  // 如果主文档没找到，尝试扫描同源 iframe
  const iframeSchema = extractFromIframes();
  if (iframeSchema.length > 0) return iframeSchema;

  return [];
}

/**
 * 带重试的表单提取（支持 SPA 动态渲染场景）
 * 如果首次提取为空，会等待 DOM 变化后重试
 * @param {number} maxWaitMs - 最长等待毫秒数
 * @returns {Promise<Array>} 表单结构数据
 */
export function extractFormSchemaWithRetry(maxWaitMs = 2000) {
  return new Promise((resolve) => {
    // 第一次尝试
    const schema = extractFormSchema();
    if (schema.length > 0) {
      resolve(schema);
      return;
    }

    // 等待 DOM 变化后重试
    let resolved = false;
    const observer = new MutationObserver(() => {
      if (resolved) return;
      const retrySchema = extractFormSchema();
      if (retrySchema.length > 0) {
        resolved = true;
        observer.disconnect();
        resolve(retrySchema);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
    });

    // 超时兜底：即使没有 DOM 变化也再试一次
    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      observer.disconnect();
      resolve(extractFormSchema());
    }, maxWaitMs);
  });
}

/**
 * 内部核心提取逻辑
 */
function _extractFormSchemaInternal() {
  const forms = detectFormRegions();

  // 如果检测到表单区域，提取所有表单区域的字段（支持页面多表单场景）
  if (forms.length > 0) {
    const schema = [];
    const seenNames = new Set();
    const seenElements = new Set();

    for (const form of forms) {
      const inputs = getAllInputElements(form);
      inputs.forEach(input => {
        if (seenElements.has(input)) return;
        seenElements.add(input);

        // 排除下拉搜索框等辅助 input
        if (isSearchInputInsideDropdown(input)) return;
        // 过滤不可见的元素（原生 input 必须可见，自定义组件 div 跳过此检查）
        if (input.tagName === 'INPUT' && !isElementVisible(input)) return;

        const field = extractFieldSchema(input);
        if (!field) return;
        const inputType = input.type?.toLowerCase();
        if ((inputType === 'radio' || inputType === 'checkbox') && field.name) {
          if (seenNames.has(field.name)) return;
          seenNames.add(field.name);
        }
        schema.push(field);
      });
    }

    if (schema.length > 0) return schema;
  }

  // 回退策略：扫描页面上所有可见的输入元素（包括 Shadow DOM）
  const schema = [];
  const allInputs = getAllInputElements(document);
  const seenNames = new Set();

  allInputs.forEach(input => {
    if (!isElementVisible(input)) return;
    if (isSearchInputInsideDropdown(input)) return;
    const field = extractFieldSchema(input);
    if (!field) return;
    const inputType = input.type?.toLowerCase();
    if ((inputType === 'radio' || inputType === 'checkbox') && field.name) {
      if (seenNames.has(field.name)) return;
      seenNames.add(field.name);
    }
    schema.push(field);
  });

  return schema;
}

/**
 * 从同源 iframe 中提取表单结构
 * @returns {Array}
 */
function extractFromIframes() {
  const iframes = document.querySelectorAll('iframe');
  const schema = [];

  for (const iframe of iframes) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) continue;

      const inputs = getAllInputElements(iframeDoc);
      const seenNames = new Set();

      inputs.forEach(input => {
        if (!isElementVisible(input)) return;
        const field = extractFieldSchema(input);
        if (!field) return;
        // 标记来自 iframe
        field._fromIframe = true;
        field._iframeSrc = iframe.src || 'inline';
        const inputType = input.type?.toLowerCase();
        if ((inputType === 'radio' || inputType === 'checkbox') && field.name) {
          if (seenNames.has(field.name)) return;
          seenNames.add(field.name);
        }
        schema.push(field);
      });
    } catch (e) {
      // 跨域 iframe 无法访问，忽略
    }
  }

  return schema;
}

// ============================================
// 输入元素选择器（由适配器动态构建）
// ============================================

/** 输入元素选择器（从适配器注册表动态构建，包含原生 + 各组件库的选择器） */
const INPUT_SELECTOR = buildInputSelector();

/** 统计区域内的可交互输入元素数量 */
function countInputs(el) {
  return el.querySelectorAll(INPUT_SELECTOR).length;
}

/**
 * 递归获取所有输入元素（包括 Shadow DOM 内部的）
 * @param {Document|ShadowRoot|Element} root
 * @returns {HTMLElement[]}
 */
function getAllInputElements(root) {
  const results = Array.from(root.querySelectorAll(INPUT_SELECTOR));
  
  // 遍历 Shadow DOM
  const allElements = root.querySelectorAll('*');
  for (const el of allElements) {
    if (el.shadowRoot) {
      results.push(...getAllInputElements(el.shadowRoot));
    }
  }
  
  return results;
}

// ============================================
// 核心：多策略表单区域检测
// ============================================

/**
 * 检测页面中的表单区域（10级策略，逐级回退）
 * @returns {HTMLElement[]} 检测到的表单区域元素数组
 */
export function detectFormRegions() {
  const regions = new Set();

  // 策略1：原生 <form> 标签（最准确）
  const nativeForms = document.querySelectorAll('form');
  nativeForms.forEach(f => {
    if (countInputs(f) > 0 && isElementVisible(f)) regions.add(f);
  });

  // 策略2：ARIA role="form"
  const ariaForms = document.querySelectorAll('[role="form"]');
  ariaForms.forEach(f => {
    if (countInputs(f) > 0) regions.add(f);
  });

  // 策略3：含有 data-form / data-testid 等明确标记的容器 + 适配器声明的容器
  const markedSelectors = [
    '[data-form]', '[data-id="form"]',
    '[data-testid*="form" i]', '[data-cy*="form" i]',
    '[class*="form-container" i]', '[class*="formContainer" i]', '[class*="form_container" i]',
    ...buildContainerSelectors(),
  ];
  for (const sel of markedSelectors) {
    try {
      document.querySelectorAll(sel).forEach(f => {
        if (countInputs(f) > 0) regions.add(f);
      });
    } catch (e) { /* invalid selector */ }
  }

  // 如果已经找到了带标记的表单区域，去重后返回
  if (regions.size > 0) return deduplicateRegions(Array.from(regions));

  // 策略4：Class/ID 匹配常见表单容器命名（降低门槛到1个输入元素）
  const classPatterns = [
    '[class*="form" i]:not(button):not(input):not(select):not(textarea):not(label):not(span)',
    '[id*="form" i]:not(button):not(input):not(select):not(textarea):not(label):not(span)',
    '[class*="register" i]', '[class*="login" i]', '[class*="signup" i]', '[class*="sign-up" i]',
    '[class*="checkout" i]', '[class*="booking" i]', '[class*="apply" i]',
    '[class*="editor" i]', '[class*="profile" i]', '[class*="setting" i]',
    // 弹窗/抽屉/面板类容器（很多表单在弹窗里）
    '[class*="modal" i]', '[class*="dialog" i]', '[class*="drawer" i]',
    '[class*="panel" i]', '[class*="popover" i]', '[class*="overlay" i]',
    '[role="dialog"]', '[role="alertdialog"]',
    // 更多业务场景关键词
    '[class*="search" i]', '[class*="filter" i]', '[class*="contact" i]',
    '[class*="order" i]', '[class*="payment" i]', '[class*="address" i]',
    '[class*="account" i]', '[class*="input-group" i]', '[class*="field" i]',
    '[class*="survey" i]', '[class*="questionnaire" i]', '[class*="feedback" i]',
    '[class*="subscribe" i]', '[class*="newsletter" i]', '[class*="comment" i]',
    '[class*="review" i]', '[class*="inquiry" i]', '[class*="wizard" i]',
    '[class*="step" i]', '[class*="onboarding" i]',
    // Ant Design / Element UI / 各框架的 form
    // 适配器声明的容器选择器
    ...buildContainerSelectors(),
    // 微前端/Web Components 容器
    '[class*="micro-app" i]', '[class*="qiankun" i]',
  ];
  
  for (const selector of classPatterns) {
    try {
      const candidates = document.querySelectorAll(selector);
      candidates.forEach(el => {
        const inputCount = countInputs(el);
        if (inputCount >= 1) {
          const bodyInputs = countInputs(document.body);
          if (inputCount < bodyInputs * 0.9 || bodyInputs <= 5) {
            regions.add(el);
          }
        }
      });
    } catch (e) { /* selector可能无效 */ }
  }

  if (regions.size > 0) return deduplicateRegions(Array.from(regions));

  // 策略5：通过可见输入元素的密度聚类（改进版，支持多个聚类）
  const allVisibleInputs = Array.from(getAllInputElements(document)).filter(isElementVisible);
  if (allVisibleInputs.length === 0) return [];

  const candidateContainers = new Map(); // element -> inputCount
  
  for (const input of allVisibleInputs) {
    let parent = input.parentElement;
    let depth = 0;
    
    while (parent && parent !== document.body && parent !== document.documentElement && depth < 12) {
      const count = countInputs(parent);
      if (count >= 1) {
        const existing = candidateContainers.get(parent) || 0;
        candidateContainers.set(parent, Math.max(existing, count));
      }
      parent = parent.parentElement;
      depth++;
    }
  }

  if (candidateContainers.size > 0) {
    // 收集所有「得分较高」的容器，而非只选一个最佳
    const scored = [];
    for (const [el, inputCount] of candidateContainers) {
      const totalChildren = el.querySelectorAll('*').length;
      if (totalChildren > 1000) continue; // 太大了，跳过
      
      const density = inputCount / Math.max(totalChildren, 1);
      const score = inputCount * density;
      scored.push({ el, score, inputCount });
    }
    
    // 按得分排序
    scored.sort((a, b) => b.score - a.score);
    
    // 选出得分最高的，以及不被它包含的其他高分容器
    const selected = [];
    for (const item of scored) {
      if (item.score < 0.01) break; // 得分太低
      // 检查是否被已选中的容器包含（避免重复）
      const isContained = selected.some(s => s.el.contains(item.el) || item.el.contains(s.el));
      if (!isContained) {
        selected.push(item);
      }
      if (selected.length >= 5) break; // 最多5个
    }
    
    if (selected.length > 0) {
      selected.forEach(s => regions.add(s.el));
      return Array.from(regions);
    }
  }

  // 策略6：所有可见输入元素的最近公共祖先
  if (allVisibleInputs.length >= 2) {
    const ancestor = findCommonAncestor(allVisibleInputs);
    if (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      regions.add(ancestor);
      return Array.from(regions);
    }
  }

  // 策略7：检测 Shadow DOM 内部的表单
  const shadowForms = detectShadowDOMForms(document);
  if (shadowForms.length > 0) {
    shadowForms.forEach(f => regions.add(f));
    return Array.from(regions);
  }

  // 策略8：退化 - 以 main/article/section 内的区域为范围
  const contentSelectors = [
    'main', 'article', '[role="main"]',
    '.main-content', '#main-content',
    '.content', '#content',
    '.page-content', '#page-content',
    '.container', '.wrapper',
    'section',
  ];
  for (const sel of contentSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && countInputs(el) >= 1) {
        regions.add(el);
        return Array.from(regions);
      }
    } catch (e) { /* ignore */ }
  }

  // 策略9：检查页面是否有「看起来像表单项」的结构（label + input 对）
  const labelInputPairs = document.querySelectorAll('label');
  if (labelInputPairs.length >= 1) {
    // 找包含这些 label 的最小共同容器
    const labelsWithInputs = Array.from(labelInputPairs).filter(label => {
      const forId = label.getAttribute('for');
      if (forId && document.getElementById(forId)) return true;
      if (label.querySelector('input, select, textarea')) return true;
      // label 后面紧跟输入元素
      const next = label.nextElementSibling;
      if (next && next.matches(INPUT_SELECTOR)) return true;
      return false;
    });
    
    if (labelsWithInputs.length >= 1) {
      const ancestor = findCommonAncestor(labelsWithInputs);
      if (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
        regions.add(ancestor);
        return Array.from(regions);
      }
    }
  }

  // 策略10：最终回退 - 直接从 body 中搜索所有输入元素
  // 放宽限制：最多50个输入元素都允许
  if (allVisibleInputs.length >= 1 && allVisibleInputs.length <= 50) {
    regions.add(document.body);
  }

  return Array.from(regions);
}

/**
 * 递归检测 Shadow DOM 中的表单
 * @param {Document|Element} root
 * @returns {HTMLElement[]}
 */
function detectShadowDOMForms(root) {
  const results = [];
  const allElements = root.querySelectorAll('*');
  
  for (const el of allElements) {
    if (el.shadowRoot) {
      // 检查 Shadow DOM 内部是否有 form
      const forms = el.shadowRoot.querySelectorAll('form, [role="form"]');
      forms.forEach(f => {
        if (countInputs(f) > 0) results.push(f);
      });
      // 递归
      results.push(...detectShadowDOMForms(el.shadowRoot));
      // 如果 Shadow DOM 内有输入元素但没有 form 标签，把宿主元素当容器
      if (results.length === 0) {
        const inputs = el.shadowRoot.querySelectorAll(INPUT_SELECTOR);
        if (inputs.length > 0) results.push(el);
      }
    }
  }
  
  return results;
}

/**
 * 去重：移除被其他区域包含的子区域（保留最小的有效容器）
 * @param {HTMLElement[]} regions
 * @returns {HTMLElement[]}
 */
function deduplicateRegions(regions) {
  if (regions.length <= 1) return regions;
  
  // 按包含的输入元素数量排序（少的优先，即更精确的容器优先）
  regions.sort((a, b) => countInputs(a) - countInputs(b));
  
  const result = [];
  for (const region of regions) {
    // 如果这个区域不被已选中的任何区域包含
    const isContainedBySelected = result.some(r => r.contains(region));
    // 也不包含已选中的区域（即不是更大的父容器）
    const containsSelected = result.some(r => region.contains(r));
    
    if (!isContainedBySelected) {
      if (containsSelected) {
        // 当前区域包含已选中的区域，跳过（优先保留更精确的小区域）
        continue;
      }
      result.push(region);
    }
  }
  
  return result;
}

// ============================================
// 内部辅助函数
// ============================================

/** 应跳过的字段类型 */
const SKIP_TYPES = ['hidden', 'submit', 'button', 'reset', 'image', 'file'];

/** 可能是 CSRF token 等无关字段的 name 模式 */
const IGNORE_NAME_PATTERNS = [
  /csrf/i, /token/i, /^_/i, /^__/i, /nonce/i, /captcha/i,
];

/**
 * 提取单个字段的完整数据（包含 value，用于提交后提取）
 */
function extractSingleField(input) {
  const type = getInputType(input);
  let name = input.name || input.id || '';

  // 跳过不需要的字段
  if (SKIP_TYPES.includes(type)) return null;
  if (type === 'password') return null;
  if (name && IGNORE_NAME_PATTERNS.some(p => p.test(name))) return null;

  // radio/checkbox 未选中的跳过
  if (type === 'radio' && !input.checked) return null;
  if (type === 'checkbox' && !input.checked) return null;

  const value = getFieldValue(input);
  if (!value) return null;

  const label = findLabel(input);
  // 尝试从祖先获取标识
  if (!name && !input.getAttribute('aria-label')) {
    const dataIdAncestor = input.closest('[data-id]');
    if (dataIdAncestor) name = dataIdAncestor.getAttribute('data-id');
    if (!name && label) name = '_label_' + label.replace(/[\s/\\]+/g, '_').replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '').substring(0, 50);
    if (!name) name = generateCSSPath(input);
    if (!name) return null;
  }

  return {
    name: name || input.getAttribute('aria-label') || '',
    label: label,
    type: type,
    value: value,
    placeholder: input.placeholder || '',
  };
}

/**
 * 提取单个字段的结构（不含 value，用于自动填写时采集表单结构）
 */
function extractFieldSchema(input) {
  const type = getInputType(input);
  let name = input.name || input.id || '';

  if (SKIP_TYPES.includes(type)) return null;
  if (name && IGNORE_NAME_PATTERNS.some(p => p.test(name))) return null;

  // 如果字段是 disabled 或 readonly 且隐藏的，跳过
  if (input.disabled && input.offsetParent === null) return null;

  // 尝试从祖先元素获取标识（应对 input 没有 name/id 的情况）
  const label = findLabel(input);
  if (!name && !input.getAttribute('aria-label')) {
    // 策略1：从最近带 data-id 的祖先获取
    const dataIdAncestor = input.closest('[data-id]');
    if (dataIdAncestor) {
      name = dataIdAncestor.getAttribute('data-id');
    }
    // 策略2：从 label 文本生成 name（去空格、转下划线）
    if (!name && label) {
      name = '_label_' + label.replace(/[\s/\\]+/g, '_').replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, '').substring(0, 50);
    }
    // 策略3：用 CSS 路径生成唯一标识
    if (!name) {
      name = generateCSSPath(input);
    }
    // 如果所有策略都失败了，才跳过
    if (!name) return null;
  }

  const schema = {
    name: name || input.getAttribute('aria-label') || '',
    label: label,
    type: type,
    placeholder: input.placeholder || '',
    // 保存定位辅助信息（用于 fillForm 按多种方式查找元素）
    _locator: buildLocator(input),
  };

  // 对于 select，提供选项列表
  if (input.tagName === 'SELECT') {
    schema.options = Array.from(input.options)
      .filter(o => o.value)
      .map(o => ({ value: o.value, text: o.textContent.trim() }));
  }

  // 对于 role=listbox / role=combobox, 尝试获取选项
  if (input.getAttribute('role') === 'combobox' || input.getAttribute('role') === 'listbox') {
    const listboxId = input.getAttribute('aria-owns') || input.getAttribute('aria-controls');
    if (listboxId) {
      const listbox = document.getElementById(listboxId);
      if (listbox) {
        const options = listbox.querySelectorAll('[role="option"]');
        schema.options = Array.from(options).map(o => ({
          value: o.getAttribute('data-value') || o.textContent.trim(),
          text: o.textContent.trim(),
        }));
      }
    }
  }

  // 对于自定义下拉组件，通过适配器提取选项
  if (type === 'select' && !schema.options) {
    const customOptions = extractOptionsByAdapters(input);
    if (customOptions && customOptions.length > 0) {
      schema.options = customOptions;
    }
  }

  // 对于 radio，提供选项
  if (type === 'radio' && name) {
    const radios = document.querySelectorAll(`input[name="${name}"]`);
    schema.options = Array.from(radios).map(r => ({
      value: r.value,
      text: findLabel(r) || r.value,
    }));
  }

  // 对于 checkbox，提供语义提示（告诉AI期望true/false）
  if (type === 'checkbox') {
    schema.valueType = 'boolean';
    schema.hint = '值为 "true" 表示勾选, "false" 表示不勾选';
    schema.currentChecked = input.checked;
    // 如果是 checkbox 组（同名多个），提供所有选项
    if (name) {
      const checkboxes = document.querySelectorAll(`input[type="checkbox"][name="${name}"]`);
      if (checkboxes.length > 1) {
        schema.valueType = 'multi-select';
        schema.hint = '值为逗号分隔的选中项 value，如 "option1,option2"';
        schema.options = Array.from(checkboxes).map(cb => ({
          value: cb.value,
          text: findLabel(cb) || cb.value,
        }));
      }
    }
  }

  return schema;
}

/**
 * 获取输入元素的类型
 */
function getInputType(input) {
  // 原生 input 元素
  if (input.tagName === 'INPUT') return input.type?.toLowerCase() || 'text';
  if (input.tagName === 'SELECT') return 'select';
  if (input.tagName === 'TEXTAREA') return 'textarea';
  
  // ARIA role 映射
  const role = input.getAttribute('role');
  if (role === 'textbox' || role === 'searchbox') return 'text';
  if (role === 'combobox' || role === 'listbox') return 'select';
  if (role === 'spinbutton') return 'number';
  if (role === 'switch') return 'checkbox';
  if (role === 'slider') return 'range';
  
  // contenteditable
  if (input.getAttribute('contenteditable') === 'true') return 'textarea';

  // 通过适配器注册表推断自定义组件类型
  const adapterType = inferTypeByAdapters(input);
  if (adapterType) return adapterType;
  
  return 'text';
}

/**
 * 获取字段的值
 */
function getFieldValue(input) {
  if (input.tagName === 'SELECT') {
    const selected = input.options[input.selectedIndex];
    return selected ? selected.textContent.trim() || selected.value : '';
  }
  if (input.getAttribute('contenteditable') === 'true') {
    return input.textContent.trim();
  }
  // ARIA role 元素
  if (input.getAttribute('role') === 'textbox' || input.getAttribute('role') === 'searchbox') {
    return input.textContent?.trim() || input.value?.trim() || '';
  }
  if (input.getAttribute('role') === 'combobox') {
    return input.value?.trim() || input.textContent?.trim() || '';
  }
  if (input.getAttribute('role') === 'switch') {
    return input.getAttribute('aria-checked') === 'true' ? 'true' : 'false';
  }
  return input.value?.trim() || '';
}

/**
 * 查找字段关联的 label（9级优先级）
 */
function findLabel(input) {
  // 1. 通过 for 属性关联的 label
  if (input.id) {
    const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label) return cleanLabelText(label.textContent);
  }

  // 2. 祖先 label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea, [role]').forEach(el => el.remove());
    const text = cleanLabelText(clone.textContent);
    if (text) return text;
  }

  // 3. aria-label
  const ariaLabel = input.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  // 4. aria-labelledby
  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    const texts = labelledBy.split(/\s+/).map(id => {
      const el = document.getElementById(id);
      return el ? el.textContent.trim() : '';
    }).filter(Boolean);
    if (texts.length > 0) return texts.join(' ');
  }

  // 5. 同级前一个元素中的文本（常见于表单布局）
  const prevSibling = input.previousElementSibling;
  if (prevSibling && ['LABEL', 'SPAN', 'DIV', 'P', 'DT'].includes(prevSibling.tagName)) {
    const text = cleanLabelText(prevSibling.textContent);
    if (text && text.length < 40) return text;
  }

  // 6. 父元素内的 label 类元素（通过适配器注册的 labelSelector）
  const parent = input.parentElement;
  const adapterLabelSelectors = buildLabelSelectors();
  const labelSelectorStr = adapterLabelSelectors.join(', ');
  
  if (parent) {
    try {
      const labelEl = parent.querySelector(labelSelectorStr);
      if (labelEl && labelEl !== input && !labelEl.contains(input)) {
        const text = cleanLabelText(labelEl.textContent);
        if (text && text.length < 40) return text;
      }
    } catch (e) { /* ignore */ }
  }

  // 7. 向上多层查找（最多 6 层祖先）
  // 关键：找到的 label 必须是当前 input "最近的" label，
  // 即 label 和 input 在同一个表单项容器内，而不是其他字段的 label
  let ancestor = parent;
  for (let i = 0; i < 6 && ancestor && ancestor !== document.body; i++) {
    try {
      const labelEl = ancestor.querySelector(labelSelectorStr);
      if (labelEl && labelEl !== input && !labelEl.contains(input)) {
        // 验证：ancestor 内的第一个输入元素应该就是当前 input（或包含当前 input）
        // 这确保我们不会在一个包含多个表单项的大容器中，把第一个字段的 label 错配给后面的字段
        const firstInput = ancestor.querySelector(INPUT_SELECTOR);
        const belongsToThis = !firstInput || firstInput === input || input.contains(firstInput) || firstInput.contains(input);
        if (belongsToThis) {
          const text = cleanLabelText(labelEl.textContent);
          if (text && text.length < 40) return text;
        }
      }
    } catch (e) { /* ignore */ }
    ancestor = ancestor.parentElement;
  }

  // 8. title 属性
  if (input.title) return input.title.trim();

  // 9. placeholder 或 name 兜底
  return input.placeholder || humanizeName(input.name || input.id || '');
}

/**
 * 清理 label 文本（去除冗余字符）
 */
function cleanLabelText(text) {
  if (!text) return '';
  return text
    .trim()
    .replace(/[：:*\s]+$/g, '')  // 去除末尾的冒号、星号、空白
    .replace(/^\s*[*]\s*/, '')   // 去除开头的星号
    .replace(/\n/g, ' ')        // 换行改空格
    .replace(/\s{2,}/g, ' ')    // 多空格合一
    .trim();
}

/**
 * 将 camelCase/snake_case 名称人性化
 */
function humanizeName(name) {
  if (!name) return '';
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .trim();
}



/**
 * 生成元素的 CSS 路径作为唯一标识
 */
function generateCSSPath(input) {
  const parts = [];
  let el = input;
  let depth = 0;
  
  while (el && el !== document.body && depth < 5) {
    let selector = el.tagName.toLowerCase();
    if (el.id) {
      selector += '#' + el.id;
      parts.unshift(selector);
      break;
    }
    if (el.className && typeof el.className === 'string') {
      // 取第一个有意义的 class
      const cls = el.className.split(/\s+/).find(c => c.length > 2 && !/^(undefined|null)$/.test(c));
      if (cls) selector += '.' + cls;
    }
    // 添加 nth-child
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(el) + 1;
        selector += ':nth-of-type(' + index + ')';
      }
    }
    parts.unshift(selector);
    el = el.parentElement;
    depth++;
  }
  
  return parts.length > 0 ? '_css_' + parts.join(' > ') : '';
}

/**
 * 构建元素的定位信息（用于 fillForm 时按多种方式查找元素）
 */
function buildLocator(input) {
  const locator = {};
  
  if (input.name) locator.name = input.name;
  if (input.id) locator.id = input.id;
  
  // data-id（自定义组件常用）
  const dataIdAncestor = input.closest('[data-id]');
  if (dataIdAncestor) locator.dataId = dataIdAncestor.getAttribute('data-id');
  
  // CSS 路径
  locator.cssPath = generateCSSPath(input);
  
  // class 列表（用于最终回退匹配）
  if (input.className && typeof input.className === 'string') {
    locator.className = input.className.trim();
  }
  
  // 标签类型
  locator.tagName = input.tagName.toLowerCase();
  locator.inputType = input.type?.toLowerCase() || '';
  
  return locator;
}

/**
 * 查找多个元素的最近公共祖先
 */
function findCommonAncestor(elements) {
  if (elements.length === 0) return null;
  if (elements.length === 1) return elements[0].parentElement;

  let ancestor = elements[0].parentElement;
  while (ancestor) {
    if (elements.every(el => ancestor.contains(el))) {
      return ancestor;
    }
    ancestor = ancestor.parentElement;
  }
  return document.body;
}

/**
 * 判断 input 是否是下拉组件内的搜索输入框（不应该被当作表单字段）
 * 例如 wg-select 内的 wg-select-list_search-input
 */
function isSearchInputInsideDropdown(input) {
  if (input.tagName !== 'INPUT') return false;
  
  // 通过适配器判断
  if (isAdapterSearchInput(input)) return true;
  
  // 通用规则：检查 class 名
  const cls = input.className || '';
  if (/search[-_]?input|list[-_]?search/i.test(cls)) {
    const dropdownParent = input.closest(
      '[class*="select-list" i], [class*="dropdown" i], [class*="picker-panel" i], [class*="popup" i]'
    );
    if (dropdownParent) return true;
  }
  
  // 检查是否在 display:none 的下拉列表容器内
  const hiddenParent = input.closest('[style*="display: none"], [style*="display:none"]');
  if (hiddenParent) {
    // 只有隐藏容器的祖先是某种下拉/选择组件时才排除
    const isInDropdown = hiddenParent.closest(
      '.ant-select, .el-select, .arco-select, .n-select, .ivu-select, .t-select, ' +
      '[role="combobox"], [role="listbox"]'
    );
    if (isInDropdown) return true;
  }
  
  return false;
}

/**
 * 判断元素是否可见（增强版 v2）
 * 综合多种策略判断，避免误判
 */
function isElementVisible(el) {
  if (!el) return false;
  
  try {
    // 快速排除：aria-hidden="true" 的元素
    if (el.getAttribute('aria-hidden') === 'true') {
      // 但如果它内部有实际的 input，可能是框架包装层，不应跳过
      if (!el.matches(INPUT_SELECTOR)) return false;
    }
    
    // 向上遍历检查祖先元素是否隐藏（最多检查10层）
    let current = el;
    let depth = 0;
    while (current && current !== document.body && depth < 10) {
      const style = getComputedStyle(current);
      if (style.display === 'none') return false;
      if (style.visibility === 'hidden' && current === el) return false; // visibility只检查自身
      if (style.opacity === '0' && current === el) return false; // opacity只检查自身
      current = current.parentElement;
      depth++;
    }
    
    // offsetParent 检查
    if (el.offsetParent === null) {
      const style = getComputedStyle(el);
      const pos = style.position;
      if (pos !== 'fixed' && pos !== 'sticky') {
        // Shadow DOM 内的元素 offsetParent 可能为 null
        if (!el.getRootNode || el.getRootNode() === document) {
          // 再给一次机会：检查是否有实际尺寸（某些框架的隐藏方式不影响布局）
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
        }
      }
    }
    
    // 检查是否在视口外（但不排除，因为可能需要滚动才能看到）
    // 只排除尺寸为 0 的元素
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // 最后机会：某些自定义组件高度为0但通过 overflow 展示
      const style = getComputedStyle(el);
      if (style.overflow !== 'visible') return false;
    }
    
    return true;
  } catch (e) {
    // 如果获取样式失败（跨域 iframe 等），默认视为可见
    return true;
  }
}
