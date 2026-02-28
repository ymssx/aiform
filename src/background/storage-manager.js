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
    (current.addresses || []).forEach(a => addrMap.set(a.label || 'Default Address', a));
    updatedProfile.addresses.forEach(a => addrMap.set(a.label || 'Default Address', a));
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

/** 默认过期天数（如果 AI 未指定 expiresAt） */
const DEFAULT_EXPIRE_DAYS = {
  intent: 7,     // 计划/意图：7 天后过期
  context: 3,    // 临时上下文：3 天后过期
  preference: null, // 偏好：永不过期
  fact: null,       // 事实：永不过期
};

/** 记忆容量上限 */
const MAX_MEMORIES = 200;

/**
 * 获取所有记忆条目（自动淘汰过期记忆）
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
    console.log(`[FormHelper] 淘汰 ${memories.length - valid.length} 条过期记忆`);
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_MEMORIES]: valid });
  }
  
  if (domain) {
    // 返回全局记忆 + 匹配域名的记忆
    return valid.filter(m => !m.domain || m.domain === '*' || m.domain === domain);
  }
  return valid;
}

/**
 * 保存一条记忆（自动去重、设默认过期、容量淘汰）
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
  
  // 如果 AI 未指定 expiresAt，根据 category 设置默认过期时间
  if (memory.expiresAt === undefined || memory.expiresAt === null) {
    const expireDays = DEFAULT_EXPIRE_DAYS[memory.category];
    if (expireDays) {
      memory.expiresAt = Date.now() + expireDays * 24 * 60 * 60 * 1000;
    } else {
      memory.expiresAt = null; // 永不过期
    }
  }
  
  // 智能去重：查找同 category 下内容相似的记忆，用新的覆盖旧的
  const duplicateIndex = findSimilarMemory(memories, memory);
  if (duplicateIndex >= 0) {
    // 用新记忆覆盖旧记忆（保留旧的 createdAt，更新内容和过期时间）
    const old = memories[duplicateIndex];
    memories[duplicateIndex] = {
      ...old,
      ...memory,
      createdAt: old.createdAt, // 保留原始创建时间
      updatedAt: Date.now(),
    };
    // 将更新的记忆移到最前面
    const updated = memories.splice(duplicateIndex, 1)[0];
    memories.unshift(updated);
    console.log(`[FormHelper] 更新已有记忆: "${memory.content}"`);
  } else {
    // 查找是否有相同 id 的记忆
    const existIndex = memories.findIndex(m => m.id === memory.id);
    if (existIndex >= 0) {
      memories[existIndex] = { ...memories[existIndex], ...memory, updatedAt: Date.now() };
    } else {
      memories.unshift(memory);
    }
  }
  
  // 容量淘汰：超出上限时，优先淘汰过期的和最旧的短期记忆
  if (memories.length > MAX_MEMORIES) {
    evictMemories(memories, MAX_MEMORIES);
  }
  
  await chrome.storage.local.set({ [STORAGE_KEYS.USER_MEMORIES]: memories });
  return memory;
}

/**
 * 查找与新记忆相似的已有记忆（用于去重更新）
 * 判定条件：同 category + 同 domain + 内容相似度高
 * @returns {number} 相似记忆的索引，-1 表示未找到
 */
function findSimilarMemory(memories, newMemory) {
  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    // 必须是同 category
    if (m.category !== newMemory.category) continue;
    // 必须是同 domain（或都是全局）
    if (m.domain !== newMemory.domain) continue;
    
    // 内容相似度判断
    if (isContentSimilar(m.content, newMemory.content)) {
      return i;
    }
  }
  return -1;
}

/**
 * 判断两段记忆内容是否相似
 * 策略：提取关键词（去除停用词和数字），计算 Jaccard 相似度
 */
function isContentSimilar(contentA, contentB) {
  if (!contentA || !contentB) return false;
  
  // 完全相同
  if (contentA === contentB) return true;
  
  const stopWords = new Set([
    '的', '了', '在', '是', '有', '用户', '到', '去', '要', '会', '和', '与', '或', '等',
    '把', '被', '从', '向', '对', '给', '让', '将', '已', '正在', '计划', '打算', '准备', '想要',
    'the', 'a', 'an', 'is', 'are', 'was', 'to', 'for', 'of', 'in', 'on', 'at',
  ]);
  
  const extractKeywords = (text) => {
    // 去除数字和日期，按空格和中文标点分割
    const cleaned = text.replace(/[\d\-\/\.\,\:]+/g, ' ');
    const tokens = cleaned.split(/[\s，。、！？；：""''（）\(\)\[\]]+/).filter(Boolean);
    // 进一步拆分中文（逐字）+ 保留英文单词
    const keywords = new Set();
    for (const token of tokens) {
      if (/^[a-zA-Z]+$/.test(token)) {
        // 英文单词
        const lower = token.toLowerCase();
        if (!stopWords.has(lower) && lower.length > 1) keywords.add(lower);
      } else {
        // 中文逐字拆分
        for (const char of token) {
          if (!stopWords.has(char) && char.trim()) keywords.add(char);
        }
      }
    }
    return keywords;
  };
  
  const kwA = extractKeywords(contentA);
  const kwB = extractKeywords(contentB);
  
  if (kwA.size === 0 || kwB.size === 0) return false;
  
  // Jaccard 相似度
  let intersection = 0;
  for (const w of kwA) {
    if (kwB.has(w)) intersection++;
  }
  const union = kwA.size + kwB.size - intersection;
  const similarity = intersection / union;
  
  // 阈值：0.5 以上视为相似（同一个主题的不同表述）
  return similarity >= 0.5;
}

/**
 * 容量淘汰：超出上限时按优先级删除记忆
 * 淘汰顺序：已过期 > 最旧的 context > 最旧的 intent > 最旧的其他
 * @param {Array} memories - 记忆数组（原地修改）
 * @param {number} maxCount - 保留上限
 */
function evictMemories(memories, maxCount) {
  const now = Date.now();
  
  // 第一轮：删除已过期的
  for (let i = memories.length - 1; i >= 0 && memories.length > maxCount; i--) {
    if (memories[i].expiresAt && memories[i].expiresAt <= now) {
      memories.splice(i, 1);
    }
  }
  if (memories.length <= maxCount) return;
  
  // 第二轮：从末尾开始删除最旧的 context
  for (let i = memories.length - 1; i >= 0 && memories.length > maxCount; i--) {
    if (memories[i].category === 'context') {
      memories.splice(i, 1);
    }
  }
  if (memories.length <= maxCount) return;
  
  // 第三轮：从末尾开始删除最旧的 intent
  for (let i = memories.length - 1; i >= 0 && memories.length > maxCount; i--) {
    if (memories[i].category === 'intent') {
      memories.splice(i, 1);
    }
  }
  if (memories.length <= maxCount) return;
  
  // 第四轮：直接截断
  memories.length = maxCount;
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

export async function updateRecord(id, updatedRecord) {
  const records = await getRecords();
  const index = records.findIndex(r => r.id === id);
  if (index === -1) return null;
  records[index] = { ...records[index], ...updatedRecord, id }; // 保持原 id
  await chrome.storage.local.set({
    [STORAGE_KEYS.FORM_RECORDS]: records,
  });
  return records[index];
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
