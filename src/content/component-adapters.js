// ============================================
// 组件适配器注册表
// 集中管理各组件库的选择器与行为，便于接入新组件库
// ============================================

/**
 * 适配器注册表
 * 每个适配器描述一个组件库的：
 *   - name: 适配器名称（调试用）
 *   - inputSelector: 该库的可交互输入元素选择器数组
 *   - containerSelector: 该库的表单容器选择器数组（可选）
 *   - typeRules: 类型推断规则（className 正则 -> 类型）
 *   - labelSelector: 该库的 label 选择器数组（可选）
 *   - optionExtractor: 从自定义下拉中提取选项的函数（可选）
 *   - valueSetter: 为自定义组件设置值的函数（可选）
 *   - searchInputSelector: 下拉搜索框选择器（应被排除的，可选）
 */
const adapters = [];

/**
 * 注册一个组件适配器
 * @param {Object} adapter
 */
export function registerAdapter(adapter) {
  adapters.push(adapter);
}

/**
 * 获取所有已注册适配器
 */
export function getAdapters() {
  return adapters;
}

/**
 * 合并所有适配器的 inputSelector，生成最终的 CSS 选择器字符串
 */
export function buildInputSelector() {
  const selectors = new Set();

  // 始终包含的原生 / 标准选择器
  const builtinSelectors = [
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
    'select',
    'textarea',
    '[contenteditable="true"]',
    // ARIA role
    '[role="textbox"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="spinbutton"]',
    '[role="searchbox"]',
    '[role="switch"]',
    '[role="slider"]',
    // 测试属性
    '[data-testid*="input" i]',
    '[data-testid*="select" i]',
    '[data-testid*="textarea" i]',
  ];
  builtinSelectors.forEach(s => selectors.add(s));

  // 从各适配器收集
  for (const adapter of adapters) {
    if (adapter.inputSelector) {
      adapter.inputSelector.forEach(s => selectors.add(s));
    }
  }

  return Array.from(selectors).join(', ');
}

/**
 * 合并所有适配器的 containerSelector
 */
export function buildContainerSelectors() {
  const selectors = [];
  for (const adapter of adapters) {
    if (adapter.containerSelector) {
      selectors.push(...adapter.containerSelector);
    }
  }
  return selectors;
}

/**
 * 合并所有适配器的 labelSelector
 */
export function buildLabelSelectors() {
  const builtins = [
    'label',
    '.label',
    '.form-label',
  ];
  const selectors = [...builtins];
  for (const adapter of adapters) {
    if (adapter.labelSelector) {
      selectors.push(...adapter.labelSelector);
    }
  }
  return [...new Set(selectors)];
}

/**
 * 通过适配器规则推断自定义元素的类型
 * @param {HTMLElement} el
 * @returns {string|null} 推断的类型，null 表示无匹配
 */
export function inferTypeByAdapters(el) {
  const cls = el.className || '';
  if (!cls) return null;

  for (const adapter of adapters) {
    if (adapter.typeRules) {
      for (const rule of adapter.typeRules) {
        if (rule.match.test(cls)) return rule.type;
      }
    }
  }
  return null;
}

/**
 * 通过适配器提取自定义下拉的选项
 * @param {HTMLElement} input
 * @returns {Array|null}
 */
export function extractOptionsByAdapters(input) {
  for (const adapter of adapters) {
    if (adapter.optionExtractor) {
      const options = adapter.optionExtractor(input);
      if (options && options.length > 0) return options;
    }
  }
  return null;
}

/**
 * 通过适配器为自定义组件设置值
 * @param {HTMLElement} input
 * @param {string} value
 * @returns {boolean|null} true=成功, false=失败, null=该适配器不处理此元素
 */
export function setValueByAdapters(input, value) {
  for (const adapter of adapters) {
    if (adapter.valueSetter) {
      const result = adapter.valueSetter(input, value);
      if (result !== null) return result;
    }
  }
  return null;
}

/**
 * 判断 input 是否是某个适配器声明的下拉搜索框（应排除）
 * @param {HTMLElement} input
 * @returns {boolean}
 */
export function isAdapterSearchInput(input) {
  for (const adapter of adapters) {
    if (adapter.searchInputSelector) {
      for (const sel of adapter.searchInputSelector) {
        if (input.matches(sel)) return true;
        // 也检查祖先
        if (input.closest(sel)) return true;
      }
    }
  }
  return false;
}

/**
 * 通过适配器在容器内查找实际的输入元素（用于 fillForm 定位）
 * @param {HTMLElement} container
 * @returns {HTMLElement|null}
 */
export function findInputInContainerByAdapters(container) {
  // 先找原生元素
  const nativeInput = container.querySelector('input:not([type="hidden"]), select, textarea');
  if (nativeInput) return nativeInput;

  // 再通过各适配器的 inputSelector 查找
  for (const adapter of adapters) {
    if (adapter.inputSelector) {
      for (const sel of adapter.inputSelector) {
        try {
          const el = container.querySelector(sel);
          if (el) return el;
        } catch (e) { /* invalid selector */ }
      }
    }
  }
  return null;
}


// ============================================
// 内置适配器：各主流组件库
// ============================================

// --- Ant Design ---
registerAdapter({
  name: 'antd',
  inputSelector: [
    '.ant-input', '.ant-select', '.ant-picker', '.ant-cascader',
    '.ant-radio-group', '.ant-checkbox-group', '.ant-switch',
    '.ant-input-number', '.ant-rate', '.ant-upload',
  ],
  containerSelector: [
    '[class*="ant-form" i]', '[class*="ant-modal" i]', '[class*="ant-drawer" i]',
  ],
  labelSelector: ['.ant-form-item-label'],
  typeRules: [
    { match: /ant-select/i, type: 'select' },
    { match: /ant-picker|ant-date/i, type: 'date' },
    { match: /ant-cascader/i, type: 'select' },
    { match: /ant-radio/i, type: 'radio' },
    { match: /ant-checkbox/i, type: 'checkbox' },
    { match: /ant-switch/i, type: 'checkbox' },
    { match: /ant-input-number/i, type: 'number' },
    { match: /ant-rate/i, type: 'number' },
    { match: /ant-input/i, type: 'text' },
  ],
});

// --- Element UI / Element Plus ---
registerAdapter({
  name: 'element-ui',
  inputSelector: [
    '.el-input__inner', '.el-select', '.el-date-editor',
    '.el-cascader', '.el-radio-group', '.el-checkbox-group',
    '.el-switch', '.el-input-number', '.el-rate', '.el-upload',
    '.el-textarea__inner',
  ],
  containerSelector: [
    '[class*="el-form" i]', '[class*="el-dialog" i]', '[class*="el-drawer" i]',
  ],
  labelSelector: ['.el-form-item__label'],
  typeRules: [
    { match: /el-select/i, type: 'select' },
    { match: /el-date/i, type: 'date' },
    { match: /el-cascader/i, type: 'select' },
    { match: /el-radio/i, type: 'radio' },
    { match: /el-checkbox/i, type: 'checkbox' },
    { match: /el-switch/i, type: 'checkbox' },
    { match: /el-input-number/i, type: 'number' },
    { match: /el-textarea/i, type: 'textarea' },
    { match: /el-input/i, type: 'text' },
  ],
});

// --- Arco Design ---
registerAdapter({
  name: 'arco-design',
  inputSelector: [
    '.arco-input', '.arco-select', '.arco-picker',
    '.arco-cascader', '.arco-radio-group', '.arco-checkbox-group',
  ],
  containerSelector: [
    '[class*="arco-form" i]', '[class*="arco-modal" i]',
  ],
  labelSelector: ['.arco-form-label-item'],
  typeRules: [
    { match: /arco-select/i, type: 'select' },
    { match: /arco-picker/i, type: 'date' },
    { match: /arco-cascader/i, type: 'select' },
    { match: /arco-radio/i, type: 'radio' },
    { match: /arco-checkbox/i, type: 'checkbox' },
    { match: /arco-input/i, type: 'text' },
  ],
});

// --- Material UI (MUI) ---
registerAdapter({
  name: 'mui',
  inputSelector: [
    '[class*="MuiInput" i]', '[class*="MuiSelect" i]',
    '[class*="MuiTextField" i]', '[class*="MuiAutocomplete" i]',
  ],
  containerSelector: [
    '[class*="MuiDialog" i]', '[class*="MuiDrawer" i]',
  ],
  labelSelector: ['[class*="MuiFormLabel" i]', '[class*="MuiInputLabel" i]'],
  typeRules: [
    { match: /MuiSelect/i, type: 'select' },
    { match: /MuiAutocomplete/i, type: 'select' },
    { match: /MuiInput|MuiTextField/i, type: 'text' },
  ],
});

// --- Naive UI ---
registerAdapter({
  name: 'naive-ui',
  inputSelector: ['.n-input', '.n-select', '.n-date-picker'],
  containerSelector: ['[class*="n-form" i]', '[class*="n-modal" i]'],
  labelSelector: ['.n-form-item-label'],
  typeRules: [
    { match: /n-select/i, type: 'select' },
    { match: /n-date/i, type: 'date' },
    { match: /n-input/i, type: 'text' },
  ],
});

// --- iView / View Design ---
registerAdapter({
  name: 'iview',
  inputSelector: ['.ivu-input', '.ivu-select', '.ivu-date-picker'],
  containerSelector: ['[class*="ivu-form" i]', '[class*="ivu-modal" i]'],
  labelSelector: ['.ivu-form-item-label'],
  typeRules: [
    { match: /ivu-select/i, type: 'select' },
    { match: /ivu-date/i, type: 'date' },
    { match: /ivu-input/i, type: 'text' },
  ],
});

// --- TDesign ---
registerAdapter({
  name: 'tdesign',
  inputSelector: [
    // TDesign 的 .t-input 是包装 div，内部有原生 input.t-input__inner
    // 所以不要匹配 .t-input（否则和内部原生 input 重复），只匹配内部真正的输入元素
    // 但 .t-select 没有内部原生 select，需要单独匹配
    '.t-select',
    '.t-date-picker',
    '.t-textarea__inner',
  ],
  containerSelector: ['[class*="t-form" i]', '[class*="t-dialog" i]'],
  labelSelector: ['.t-form__label'],
  typeRules: [
    { match: /t-select/i, type: 'select' },
    { match: /t-date/i, type: 'date' },
    { match: /t-textarea/i, type: 'textarea' },
  ],
  searchInputSelector: [
    // TDesign select 下拉搜索框
    '.t-select__input-filter',
    '.t-input__inner[readonly]',
  ],
});

// --- Chakra UI ---
registerAdapter({
  name: 'chakra-ui',
  inputSelector: ['[class*="chakra-input" i]', '[class*="chakra-select" i]'],
  typeRules: [
    { match: /chakra-select/i, type: 'select' },
    { match: /chakra-input/i, type: 'text' },
  ],
});

// --- mod-form 自定义表单框架 ---
registerAdapter({
  name: 'mod-form',
  inputSelector: [],
  containerSelector: [
    '[class*="mod-form" i]',
  ],
  labelSelector: ['.mod-form__label'],
  typeRules: [],
});

// --- WG 自定义组件库 ---
registerAdapter({
  name: 'wg-components',
  inputSelector: [
    '.wg-input',
    '.wg-select',
  ],
  containerSelector: [
    '[data-id="form"]',
  ],
  labelSelector: ['.wg-component-label'],
  typeRules: [
    { match: /wg-select/i, type: 'select' },
    { match: /wg-input/i, type: 'text' },
  ],
  searchInputSelector: [
    '.wg-select-list .wg-select-list_search-input',
    '[class*="wg-select-list" i]',
  ],
  optionExtractor(input) {
    // 从 wg-select 提取选项
    const selectContainer = input.closest('.wg-select');
    if (!selectContainer) return null;

    const items = selectContainer.querySelectorAll('.wg-select-list_item-label');
    if (items.length === 0) return null;

    return Array.from(items).map(item => ({
      value: item.getAttribute('data-value') || item.textContent.trim(),
      text: item.textContent.trim(),
    })).filter(o => o.text);
  },
  valueSetter(input, value) {
    const selectContainer = input.closest('.wg-select');
    if (!selectContainer) return null; // 不是 wg-select，交给下一个适配器

    const list = selectContainer.querySelector('.wg-select-list');
    if (!list) return false;

    const originalDisplay = list.style.display;
    list.style.display = '';

    const items = list.querySelectorAll('.wg-select-list_item-label, .wg-select-list_item');
    let matched = false;
    for (const item of items) {
      const text = item.textContent.trim();
      if (text === value || text.includes(value) || value.includes(text)) {
        item.click();
        matched = true;
        break;
      }
    }

    if (!matched) list.style.display = originalDisplay;
    return matched;
  },
});
