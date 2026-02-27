
// ============================================
// 表单填充器
// 根据 AI 返回的映射关系自动填充表单
// ============================================

/**
 * 自动填充表单
 * @param {Object} fillData - { fieldName: value } 映射
 */
export function fillForm(fillData) {
  if (!fillData || typeof fillData !== 'object') return;

  let filledCount = 0;

  for (const [name, value] of Object.entries(fillData)) {
    if (value === null || value === undefined) continue;

    // 通过 name 或 id 查找元素
    const input = document.querySelector(
      `[name="${name}"], #${CSS.escape(name)}`
    );

    if (input) {
      const success = setFieldValue(input, String(value));
      if (success) filledCount++;
    }
  }

  console.log(`[FormHelper] 已填充 ${filledCount} 个字段`);
  return filledCount;
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
