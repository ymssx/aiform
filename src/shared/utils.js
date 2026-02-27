
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
 * 安全解析JSON，失败返回null
 */
export function safeParseJSON(str) {
  try {
    // 尝试提取 markdown 代码块中的 JSON
    const codeBlockMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim());
    }
    return JSON.parse(str);
  } catch (e) {
    console.error('[FormHelper] JSON 解析失败:', e);
    return null;
  }
}

/**
 * 获取当前域名
 */
export function getCurrentDomain() {
  return location.hostname;
}
