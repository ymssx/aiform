
// ============================================
// 工具函数
// ============================================

/**
 * 生成唯一ID
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

/**
 * 向 Background 发送消息
 */
export function sendMessage(type, data = {}) {
  return chrome.runtime.sendMessage({ type, data });
}

/**
 * 脱敏显示
 * @param {string} value - 原始值
 * @param {string} type - 字段类型
 */
export function maskSensitive(value, type) {
  if (!value) return '';
  if (type === 'password') return '******';
  if (type === 'idCard' && value.length > 8) {
    return value.substring(0, 4) + '****' + value.substring(value.length - 4);
  }
  if (type === 'phone' && value.length >= 11) {
    return value.substring(0, 3) + '****' + value.substring(value.length - 4);
  }
  if (type === 'bankCard' && value.length > 8) {
    return value.substring(0, 4) + ' **** **** ' + value.substring(value.length - 4);
  }
  return value;
}

/**
 * 安全解析JSON，失败时尝试修复截断的 JSON
 * AI 输出可能因 max_tokens 限制被截断，需要尽可能抢救数据
 */
export function safeParseJSON(str) {
  if (!str) return null;

  // 尝试提取 markdown 代码块中的 JSON
  const codeBlockMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : str.trim();

  // 第1次尝试：直接解析
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn('[FormHelper] JSON 直接解析失败，尝试修复截断的 JSON...', e.message);
  }

  // 第2次尝试：修复截断的 JSON
  // AI 输出被 max_tokens 截断时，JSON 通常不完整，需要补全括号
  try {
    let fixed = jsonStr;

    // 去掉末尾不完整的 key-value 对（如 "label": "用户 或 "value":）
    // 找到最后一个完整的 } 或 ]
    const lastCompleteObj = fixed.lastIndexOf('}');
    const lastCompleteArr = fixed.lastIndexOf(']');
    const lastComplete = Math.max(lastCompleteObj, lastCompleteArr);

    if (lastComplete > 0) {
      fixed = fixed.substring(0, lastComplete + 1);
    }

    // 统计未闭合的括号并补全
    let braces = 0, brackets = 0;
    let inString = false, escape = false;
    for (const ch of fixed) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }

    // 补全缺失的闭合括号
    while (brackets > 0) { fixed += ']'; brackets--; }
    while (braces > 0) { fixed += '}'; braces--; }

    const result = JSON.parse(fixed);
    console.log('[FormHelper] ✅ 成功修复截断的 JSON，fields 数量:', result.fields?.length || 0);
    return result;
  } catch (e2) {
    console.warn('[FormHelper] JSON 修复也失败，尝试正则提取 fields...', e2.message);
  }

  // 第3次尝试：用正则从截断的 JSON 中提取 fields 数组
  try {
    const fieldsMatch = jsonStr.match(/"fields"\s*:\s*\[([\s\S]*)/);
    if (fieldsMatch) {
      let fieldsStr = '[' + fieldsMatch[1];
      // 找到 fields 数组的结束位置（可能没有闭合）
      // 尝试找到最后一个完整的 } 然后补上 ]
      const lastBrace = fieldsStr.lastIndexOf('}');
      if (lastBrace > 0) {
        fieldsStr = fieldsStr.substring(0, lastBrace + 1) + ']';
        const fields = JSON.parse(fieldsStr);
        console.log('[FormHelper] ✅ 从截断 JSON 中正则提取了', fields.length, '个 fields');
        return { fields };
      }
    }
  } catch (e3) {
    console.error('[FormHelper] 所有 JSON 解析尝试均失败:', e3.message);
  }

  return null;
}

/**
 * 获取当前域名
 */
export function getCurrentDomain() {
  return location.hostname;
}
