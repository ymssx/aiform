// ============================================
// 存储管理器 - Chrome Storage 读写封装
// ============================================

import { STORAGE_KEYS, DEFAULT_CONFIG, DEFAULT_PROFILE, DEFAULT_SDK_CONFIG } from '../shared/constants.js';
import { generateId } from '../shared/utils.js';

/** ========== 配置管理 ========== */

export async function getConfig() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.USER_CONFIG);
  return { ...DEFAULT_CONFIG, ...result[STORAGE_KEYS.USER_CONFIG] };
}

export async function saveConfig(config) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.USER_CONFIG]: { ...DEFAULT_CONFIG, ...config },
  });
}

/** ========== 用户画像管理 ========== */

export async function getProfile() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.USER_PROFILE);
  return { ...DEFAULT_PROFILE, ...result[STORAGE_KEYS.USER_PROFILE] };
}

export async function saveProfile(profile) {
  profile.lastUpdated = Date.now();
  await chrome.storage.local.set({
    [STORAGE_KEYS.USER_PROFILE]: profile,
  });
}

/**
 * 合并更新用户画像
 * @param {Object} updatedProfile - AI 返回的更新后 profile
 * @param {Array} changeLog - 变更日志
 * @param {string} source - 变更来源
 */
export async function mergeProfile(updatedProfile, changeLog, source) {
  const current = await getProfile();

  // 深度合并各分类
  const merged = {
    ...current,
    personal: { ...current.personal, ...updatedProfile.personal },
    contact: { ...current.contact, ...updatedProfile.contact },
    work: { ...current.work, ...updatedProfile.work },
    education: { ...current.education, ...updatedProfile.education },
    preferences: { ...current.preferences, ...updatedProfile.preferences },
    custom: { ...current.custom, ...updatedProfile.custom },
  };

  // 地址合并（按label去重，新的覆盖旧的）
  if (updatedProfile.addresses && updatedProfile.addresses.length > 0) {
    const addrMap = new Map();
    (current.addresses || []).forEach(a => addrMap.set(a.label || '默认地址', a));
    updatedProfile.addresses.forEach(a => addrMap.set(a.label || '默认地址', a));
    merged.addresses = Array.from(addrMap.values());
  }

  // 记录变更历史
  if (changeLog && changeLog.length > 0) {
    merged.changeHistory = [
      {
        timestamp: Date.now(),
        source: source || 'unknown',
        changes: changeLog,
      },
      ...(current.changeHistory || []).slice(0, 49), // 最多保留50条
    ];
  }

  await saveProfile(merged);
  return merged;
}

/** ========== 记忆系统管理 ========== */

/**
 * 获取所有记忆条目
 * @param {string} [domain] - 可选，按域名过滤
 */
export async function getMemories(domain) {
  const result = await chrome.storage.local.get(STORAGE_KEYS.USER_MEMORIES);
  const memories = result[STORAGE_KEYS.USER_MEMORIES] || [];
  
  // 过滤过期记忆
  const now = Date.now();
  const valid = memories.filter(m => !m.expiresAt || m.expiresAt > now);
  
  // 如果有过期的，清理存储
  if (valid.length !== memories.length) {
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_MEMORIES]: valid });
  }
  
  if (domain) {
    // 返回全局记忆 + 匹配域名的记忆
    return valid.filter(m => !m.domain || m.domain === '*' || m.domain === domain);
  }
  return valid;
}

/**
 * 保存一条记忆
 * @param {Object} memory - 记忆对象
 * @param {string} memory.content - 记忆内容（自然语言描述）
 * @param {string} memory.category - 分类：intent(意图计划)、preference(偏好)、fact(事实)、context(上下文)
 * @param {string} [memory.domain] - 关联域名，'*' 表示全局
 * @param {number} [memory.expiresAt] - 过期时间戳，null 表示永不过期
 * @param {Object} [memory.metadata] - 附加结构化数据
 */
export async function saveMemory(memory) {
  const memories = await getMemories();
  
  memory.id = memory.id || generateId();
  memory.createdAt = memory.createdAt || Date.now();
  memory.domain = memory.domain || '*';
  
  // 查找是否有相似的记忆需要更新（通过 id 或内容匹配）
  const existIndex = memories.findIndex(m => m.id === memory.id);
  if (existIndex >= 0) {
    memories[existIndex] = { ...memories[existIndex], ...memory, updatedAt: Date.now() };
  } else {
    memories.unshift(memory);
  }
  
  // 最多保留 200 条记忆
  if (memories.length > 200) memories.length = 200;
  
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_MEMORIES]: memories });
  return memory;
}

/**
 * 批量保存记忆（AI 提取后批量写入）
 */
export async function saveMemories(memoryList) {
  const results = [];
  for (const m of memoryList) {
    results.push(await saveMemory(m));
  }
  return results;
}

/**
 * 删除一条记忆
 */
export async function deleteMemory(id) {
  const memories = await getMemories();
  const filtered = memories.filter(m => m.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_MEMORIES]: filtered });
}

/** ========== 表单记录管理 ========== */

export async function getRecords() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.FORM_RECORDS);
  return result[STORAGE_KEYS.FORM_RECORDS] || [];
}

export async function saveRecord(record) {
  const records = await getRecords();
  record.id = record.id || generateId();
  record.timestamp = Date.now();
  records.unshift(record); // 最新的在前
  // 最多保留100条
  if (records.length > 100) records.length = 100;
  await chrome.storage.local.set({
    [STORAGE_KEYS.FORM_RECORDS]: records,
  });
  return record;
}

export async function deleteRecord(id) {
  const records = await getRecords();
  const filtered = records.filter(r => r.id !== id);
  await chrome.storage.local.set({
    [STORAGE_KEYS.FORM_RECORDS]: filtered,
  });
}

/** ========== SDK 配置管理 ========== */

export async function getSDKConfig() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SDK_CONFIG);
  return { ...DEFAULT_SDK_CONFIG, ...result[STORAGE_KEYS.SDK_CONFIG] };
}

export async function saveSDKConfig(config) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.SDK_CONFIG]: { ...DEFAULT_SDK_CONFIG, ...config },
  });
}

/** ========== 清空 ========== */

export async function clearAll() {
  await chrome.storage.local.clear();
}
