// ============================================
// 表单填充器
// 根据 AI 返回的映射关系自动填充表单
// 组件库选择器通过 component-adapters.js 统一管理
// ============================================

import {
  setValueByAdapters,
  findInputInContainerByAdapters,
  buildLabelSelectors,
} from './component-adapters.js';

/**
 * 自动填充表单（增强版：支持多种定位方式）
 * @param {Object} fillData - { fieldName: value } 映射
 * @param {Array} formSchema - 表单结构数据（含 _locator 定位信息）
 */
export function fillForm(fillData, formSchema = []) {
  if (!fillData || typeof fillData !== 'object') return;

  let filledCount = 0;

  for (const [name, value] of Object.entries(fillData)) {
    if (value === null || value === undefined) continue;

    // 查找对应的 schema 信息（含 _locator）
    const schemaItem = formSchema.find(s => s.name === name);
    const locator = schemaItem?._locator;

    // 多策略查找元素
    const input = findInputElement(name, locator);

    if (input) {
      // 先尝试通过适配器设置值（自定义组件）
      const adapterResult = setValueByAdapters(input, String(value));
      if (adapterResult === true) {
        filledCount++;
      } else if (adapterResult === null) {
        // 没有适配器处理，用通用逻辑
        const success = setFieldValue(input, String(value));
        if (success) filledCount++;
      }
    }
  }

  console.log(`[FormHelper] 已填充 ${filledCount} 个字段`);
  return filledCount;
}

/**
 * 多策略查找输入元素
 * @param {string} name - 字段名称
 * @param {Object} locator - 定位信息
 * @returns {HTMLElement|null}
 */
function findInputElement(name, locator) {
  // 策略1：通过 name 属性
  if (name && !name.startsWith('_')) {
    const byName = document.querySelector(`[name="${CSS.escape(name)}"]`);
    if (byName) return byName;
  }

  // 策略2：通过 id
  if (name && !name.startsWith('_')) {
    try {
      const byId = document.getElementById(name);
      if (byId) return byId;
    } catch (e) { /* invalid id */ }
  }

  // 策略3：通过 data-id（自定义组件常用）
  if (locator?.dataId) {
    const container = document.querySelector(`[data-id="${CSS.escape(locator.dataId)}"]`);
    if (container) {
      const input = findInputInContainerByAdapters(container);
      if (input) return input;
    }
  }
  
  // name 本身也可能是 data-id 值
  if (name && !name.startsWith('_')) {
    const container = document.querySelector(`[data-id="${CSS.escape(name)}"]`);
    if (container) {
      const input = findInputInContainerByAdapters(container);
      if (input) return input;
    }
  }

  // 策略4：通过 label 文本匹配（适用于 name 是从 label 生成的情况）
  if (name && name.startsWith('_label_')) {
    const labelText = name.replace('_label_', '').replace(/_/g, ' ').trim();
    const input = findInputByLabelText(labelText);
    if (input) return input;
  }

  // 策略5：通过 CSS 路径
  if (locator?.cssPath) {
    const cssPath = locator.cssPath.replace(/^_css_/, '');
    try {
      const el = document.querySelector(cssPath);
      if (el) return el;
    } catch (e) { /* invalid selector */ }
  }

  // 策略6：通过 className 和 tagName 组合查找
  if (locator?.className && locator?.tagName) {
    const mainClass = locator.className.split(/\s+/).find(c => c.length > 3);
    if (mainClass) {
      try {
        const el = document.querySelector(`${locator.tagName}.${CSS.escape(mainClass)}`);
        if (el) return el;
      } catch (e) { /* invalid selector */ }
    }
  }

  return null;
}

/**
 * 通过 label 文本查找关联的输入元素
 */
function findInputByLabelText(labelText) {
  const labelSelectors = buildLabelSelectors();
  
  for (const sel of labelSelectors) {
    try {
      const labels = document.querySelectorAll(sel);
      for (const label of labels) {
        const text = label.textContent.trim();
        if (text === labelText || text.includes(labelText) || labelText.includes(text)) {
          // 找到匹配的 label，在其父容器中找 input
          let container = label.parentElement;
          for (let i = 0; i < 5 && container && container !== document.body; i++) {
            const input = findInputInContainerByAdapters(container);
            if (input && !input.closest('[style*="display: none"]')) {
              return input;
            }
            container = container.parentElement;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }
  
  return null;
}



/**
 * 设置字段值并触发相关事件
 */
function setFieldValue(input, value) {
  try {
    const tagName = input.tagName;
    const type = input.type?.toLowerCase() || 'text';

    if (tagName === 'SELECT') {
      return setSelectValue(input, value);
    }

    if (type === 'radio') {
      return setRadioValue(input.name, value);
    }

    if (type === 'checkbox') {
      // 检查是否是 checkbox 组（同名多个）
      const cbName = input.name;
      const allCheckboxes = cbName ? document.querySelectorAll(`input[type="checkbox"][name="${cbName}"]`) : [];
      if (allCheckboxes.length > 1) {
        // checkbox 组：value 为逗号分隔的选中项
        const selectedValues = value.split(',').map(v => v.trim().toLowerCase());
        allCheckboxes.forEach(cb => {
          const shouldCheck = selectedValues.includes(cb.value.toLowerCase()) || 
                              selectedValues.includes((findCheckboxLabel(cb) || '').toLowerCase());
          if (cb.checked !== shouldCheck) {
            cb.checked = shouldCheck;
            triggerEvents(cb);
          }
        });
        return true;
      }
      // 单个 checkbox：期望 true/false
      const shouldCheck = ['true', '1', 'yes', '是', 'on', 'checked'].includes(value.toLowerCase());
      if (input.checked !== shouldCheck) {
        input.checked = shouldCheck;
        triggerEvents(input);
      }
      return true;
    }

    if (input.getAttribute('contenteditable') === 'true') {
      input.textContent = value;
      triggerEvents(input);
      return true;
    }

    // 通用 input / textarea
    // 使用 native setter 确保 React 等框架能检测到变化
    // 注意：textarea 和 input 的 native setter 不同，必须分别获取
    let nativeSetter;
    if (tagName === 'TEXTAREA') {
      nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set;
    } else {
      nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
    }

    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }

    triggerEvents(input);
    return true;
  } catch (e) {
    console.error(`[FormHelper] 填充字段失败:`, e);
    return false;
  }
}

/**
 * 设置 select 的值
 */
function setSelectValue(select, value) {
  // 精确匹配 value
  for (const option of select.options) {
    if (option.value === value || option.textContent.trim() === value) {
      select.value = option.value;
      triggerEvents(select);
      return true;
    }
  }

  // 模糊匹配
  for (const option of select.options) {
    if (option.textContent.trim().includes(value) || value.includes(option.textContent.trim())) {
      select.value = option.value;
      triggerEvents(select);
      return true;
    }
  }

  return false;
}

/**
 * 设置 radio 的值
 */
function setRadioValue(name, value) {
  const radios = document.querySelectorAll(`input[type="radio"][name="${name}"]`);
  for (const radio of radios) {
    const label = radio.parentElement?.textContent?.trim() || radio.value;
    if (radio.value === value || label.includes(value) || value.includes(label)) {
      radio.checked = true;
      triggerEvents(radio);
      return true;
    }
  }
  return false;
}

/**
 * 查找 checkbox 关联的 label 文本（简化版）
 */
function findCheckboxLabel(input) {
  // 通过 for 属性
  if (input.id) {
    const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label) return label.textContent.trim();
  }
  // 祖先 label
  const parentLabel = input.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input').forEach(el => el.remove());
    return clone.textContent.trim();
  }
  return '';
}

/**
 * 触发 input / change / blur 事件确保框架检测到变化
 */
function triggerEvents(element) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  element.dispatchEvent(new Event('blur', { bubbles: true }));
}
