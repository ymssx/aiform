// ============================================
// 表单数据采集器（增强版）
// 多策略智能检测表单区域，大幅提升检测准确率
// ============================================

/**
 * 提取表单区域内的所有字段数据（提交后用，含 value）
 * @param {HTMLFormElement|HTMLElement} formElement - 表单元素或包含输入元素的容器
 * @returns {Array} 精简后的字段数据列表
 */
export function extractFormFields(formElement) {
  const inputs = formElement.querySelectorAll(INPUT_SELECTOR);
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
  const forms = detectFormRegions();

  // 如果检测到表单区域，提取所有表单区域的字段（支持页面多表单场景）
  if (forms.length > 0) {
    const schema = [];
    const seenNames = new Set(); // 去重：同名 radio/checkbox 只保留一个
    const seenElements = new Set(); // 去重：避免嵌套区域导致同一个input被提取多次

    for (const form of forms) {
      const inputs = form.querySelectorAll(INPUT_SELECTOR);
      inputs.forEach(input => {
        // 避免同一个 input 元素被多个表单区域重复提取
        if (seenElements.has(input)) return;
        seenElements.add(input);

        const field = extractFieldSchema(input);
        if (!field) return;
        // 同名 radio 和 checkbox 组只保留第一个（它已包含所有 options）
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

  // 回退策略1：扫描页面上所有可见的输入元素（包括 Shadow DOM）
  const schema = [];
  const allInputs = getAllInputElements(document);
  const seenNames = new Set(); // 去重：同名 radio/checkbox 只保留一个

  allInputs.forEach(input => {
    // 使用增强版可见性检测
    if (!isElementVisible(input)) return;
    const field = extractFieldSchema(input);
    if (!field) return;
    // 同名 radio 和 checkbox 组只保留第一个
    const inputType = input.type?.toLowerCase();
    if ((inputType === 'radio' || inputType === 'checkbox') && field.name) {
      if (seenNames.has(field.name)) return;
      seenNames.add(field.name);
    }
    schema.push(field);
  });

  return schema;
}

// ============================================
// 输入元素选择器（扩展版）
// ============================================

/** 基础输入元素选择器 */
const INPUT_SELECTOR = [
  'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
  'select',
  'textarea',
  '[contenteditable="true"]',
  // 扩展：常见 UI 框架的自定义输入组件
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="spinbutton"]',
  '[role="searchbox"]',
  '[role="switch"]',
  '[role="slider"]',
  // 新增：更多现代框架自定义组件
  '[data-testid*="input" i]',
  '[data-testid*="select" i]',
  '.ant-input', '.ant-select', '.ant-picker',
  '.el-input__inner', '.el-select', '.el-date-editor',
  '.arco-input', '.arco-select',
].join(', ');

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
 * 检测页面中的表单区域（8级策略，逐级回退）
 * @returns {HTMLElement[]} 检测到的表单区域元素数组
 */
export function detectFormRegions() {
  const regions = new Set();

  // 策略1：原生 <form> 标签（最准确）
  const nativeForms = document.querySelectorAll('form');
  nativeForms.forEach(f => {
    if (countInputs(f) > 0) regions.add(f);
  });

  // 策略2：ARIA role="form"
  const ariaForms = document.querySelectorAll('[role="form"]');
  ariaForms.forEach(f => {
    if (countInputs(f) > 0) regions.add(f);
  });

  // 策略3：含有 data-form / data-testid 等明确标记的容器
  const markedContainers = document.querySelectorAll(
    '[data-form], [data-testid*="form" i], [data-cy*="form" i], [class*="form-container" i], [class*="formContainer" i]'
  );
  markedContainers.forEach(f => {
    if (countInputs(f) > 0) regions.add(f);
  });

  // 如果已经找到了带标记的表单区域，直接返回
  if (regions.size > 0) return Array.from(regions);

  // 策略4：Class/ID 匹配常见表单容器命名（降低门槛到1个输入元素）
  const classPatterns = [
    '[class*="form" i]:not(button):not(input):not(select):not(textarea)',
    '[id*="form" i]:not(button):not(input):not(select):not(textarea)',
    '[class*="register" i]', '[class*="login" i]', '[class*="signup" i]',
    '[class*="checkout" i]', '[class*="booking" i]', '[class*="apply" i]',
    '[class*="editor" i]', '[class*="profile" i]', '[class*="setting" i]',
    // 新增：弹窗/抽屉/面板类容器
    '[class*="modal" i]', '[class*="dialog" i]', '[class*="drawer" i]',
    '[class*="panel" i]', '[class*="popover" i]', '[class*="overlay" i]',
    '[role="dialog"]', '[role="alertdialog"]',
    // 新增：更多业务场景
    '[class*="search" i]', '[class*="filter" i]', '[class*="contact" i]',
    '[class*="order" i]', '[class*="payment" i]', '[class*="address" i]',
    '[class*="account" i]', '[class*="input-group" i]', '[class*="field" i]',
    // Ant Design / Element UI 等框架
    '[class*="ant-form" i]', '[class*="el-form" i]', '[class*="arco-form" i]',
    '[class*="ivu-form" i]', '[class*="n-form" i]',
  ];
  
  for (const selector of classPatterns) {
    try {
      const candidates = document.querySelectorAll(selector);
      candidates.forEach(el => {
        const inputCount = countInputs(el);
        // 降低门槛到1个输入元素即可
        if (inputCount >= 1) {
          // 排除太大的容器（如整个页面布局容器）
          const bodyInputs = countInputs(document.body);
          if (inputCount < bodyInputs * 0.9 || bodyInputs <= 5) {
            regions.add(el);
          }
        }
      });
    } catch (e) { /* selector可能无效 */ }
  }

  if (regions.size > 0) return Array.from(regions);

  // 策略5：输入元素密度聚类（为每个 input 找最近的合理容器）
  const allInputs = Array.from(document.querySelectorAll(INPUT_SELECTOR));
  if (allInputs.length === 0) return [];

  // 对每个输入元素，向上寻找"刚好"包含多个输入元素的容器
  const candidateContainers = new Map(); // element -> inputCount
  
  for (const input of allInputs) {
    let parent = input.parentElement;
    let depth = 0;
    
    while (parent && parent !== document.body && parent !== document.documentElement && depth < 10) {
      const count = countInputs(parent);
      if (count >= 2) {
        candidateContainers.set(parent, count);
        // 继续往上找，看有没有更合适的（但不要太大）
      }
      parent = parent.parentElement;
      depth++;
    }
  }

  if (candidateContainers.size > 0) {
    // 找到"最紧凑"的容器：输入元素数量 / 子元素总数 比例最高的
    let bestContainer = null;
    let bestScore = 0;
    
    for (const [el, inputCount] of candidateContainers) {
      // 不要选 body 或过大的容器
      const totalChildren = el.querySelectorAll('*').length;
      if (totalChildren > 500) continue; // 太大了
      
      const density = inputCount / Math.max(totalChildren, 1);
      const score = inputCount * density; // 同时考虑数量和密度
      
      if (score > bestScore) {
        bestScore = score;
        bestContainer = el;
      }
    }
    
    if (bestContainer) {
      regions.add(bestContainer);
      return Array.from(regions);
    }
  }

  // 策略6：所有输入元素的最近公共祖先
  if (allInputs.length >= 2) {
    const ancestor = findCommonAncestor(allInputs);
    if (ancestor && ancestor !== document.body && ancestor !== document.documentElement) {
      regions.add(ancestor);
      return Array.from(regions);
    }
  }

  // 策略7：退化 - 以 main/article 内的区域为范围
  const mainContent = document.querySelector('main, article, [role="main"], .main-content, #main-content, .content, #content');
  if (mainContent && countInputs(mainContent) >= 1) {
    regions.add(mainContent);
    return Array.from(regions);
  }

  // 策略8：最终回退 - 直接从 body 中搜索所有输入元素
  // 但只在输入元素较少时这样做（避免误将整个复杂页面当表单）
  if (allInputs.length >= 1 && allInputs.length <= 30) {
    regions.add(document.body);
  }

  return Array.from(regions);
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
  const name = input.name || input.id || '';

  // 跳过不需要的字段
  if (SKIP_TYPES.includes(type)) return null;
  if (type === 'password') return null;
  if (!name && !input.id && !input.getAttribute('aria-label')) return null;
  if (name && IGNORE_NAME_PATTERNS.some(p => p.test(name))) return null;

  // radio/checkbox 未选中的跳过
  if (type === 'radio' && !input.checked) return null;
  if (type === 'checkbox' && !input.checked) return null;

  const value = getFieldValue(input);
  if (!value) return null;

  return {
    name: name || input.getAttribute('aria-label') || '',
    label: findLabel(input),
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
  const name = input.name || input.id || '';

  if (SKIP_TYPES.includes(type)) return null;
  if (!name && !input.id && !input.getAttribute('aria-label')) return null;
  if (name && IGNORE_NAME_PATTERNS.some(p => p.test(name))) return null;

  // 如果字段是 disabled 或 readonly 且隐藏的，跳过
  if (input.disabled && input.offsetParent === null) return null;

  const schema = {
    name: name || input.getAttribute('aria-label') || '',
    label: findLabel(input),
    type: type,
    placeholder: input.placeholder || '',
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

  // 6. 父元素内的 label 类元素
  const parent = input.parentElement;
  if (parent) {
    const labelEl = parent.querySelector('.label, .form-label, [class*="label" i], [class*="title" i]:not(h1):not(h2):not(h3)');
    if (labelEl && labelEl !== input && !labelEl.contains(input)) {
      const text = cleanLabelText(labelEl.textContent);
      if (text && text.length < 40) return text;
    }
  }

  // 7. 父级的父级查找（表单通常是 row > label + input 结构）
  const grandParent = parent?.parentElement;
  if (grandParent) {
    const labelEl = grandParent.querySelector('label, .label, .form-label, [class*="label" i]');
    if (labelEl && labelEl !== input && !labelEl.contains(input)) {
      const text = cleanLabelText(labelEl.textContent);
      if (text && text.length < 40) return text;
    }
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
 * 判断元素是否可见（增强版）
 */
function isElementVisible(el) {
  if (!el) return false;
  
  try {
    const style = getComputedStyle(el);
    
    // 明确隐藏的
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;
    
    // offsetParent 为 null 的元素通常是隐藏的
    // 但 position:fixed/sticky 和 Shadow DOM 内的元素除外
    if (el.offsetParent === null) {
      const pos = style.position;
      if (pos !== 'fixed' && pos !== 'sticky') {
        // 再检查一次是否在 Shadow DOM 中（Shadow DOM 内 offsetParent 可能为 null）
        if (!el.getRootNode || el.getRootNode() === document) {
          return false;
        }
      }
    }
    
    const rect = el.getBoundingClientRect();
    // 元素尺寸为 0 也视为不可见（但允许极小的元素，如某些自定义组件）
    if (rect.width === 0 && rect.height === 0) return false;
    
    return true;
  } catch (e) {
    // 如果获取样式失败（跨域 iframe 等），默认视为可见
    return true;
  }
}
