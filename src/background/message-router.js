
// ============================================
// Background 消息路由器
// ============================================

import { MSG } from '../shared/constants.js';
import { callAIForJSON } from './ai-service.js';
import { buildExtractPrompt, buildFillPrompt, buildMemoryExtractPrompt } from './prompt-templates.js';
import {
  getConfig, saveConfig,
  getProfile, saveProfile, mergeProfile,
  getRecords, saveRecord, updateRecord, deleteRecord, clearAll,
  getMemories, saveMemory, saveMemories, deleteMemory,
  getSDKConfig, saveSDKConfig,
} from './storage-manager.js';

/**
 * 处理消息
 */
async function handleMessage(message, sender) {
  const { type, data } = message;

  switch (type) {

    // ========== 表单提取（增强：含记忆提取）==========
    case MSG.EXTRACT_FORM: {
      const pageContext = data.pageContext || '';
      const prompt = buildExtractPrompt(data.rawFields, pageContext);
      const result = await callAIForJSON(prompt);
      
      // 自动保存 AI 提取的记忆
      if (result.memories && result.memories.length > 0) {
        const domain = data.domain || '*';
        for (const mem of result.memories) {
          mem.domain = domain;
          mem.source = 'form_extract';
        }
        await saveMemories(result.memories);
      }
      
      return { success: true, data: result };
    }

    // ========== 保存表单记录 + 合并到用户画像 + 提取记忆 ==========
    case MSG.SAVE_RECORD: {
      const record = await saveRecord(data.record);

      // 将字段数据合并到用户画像
      if (data.record.fields && data.record.fields.length > 0) {
        const profileUpdate = fieldsToProfile(data.record.fields);
        const changeLog = data.record.fields.map(f => `Extract from form: ${f.label} = ${f.value}`);
        await mergeProfile(profileUpdate, changeLog, `form_submit:${data.record.domain}`);
      }

      // 异步提取记忆（不阻塞主流程）
      extractMemoriesFromRecord(data.record).catch(err => {
        console.warn('[FormHelper] Memory extraction failed:', err.message);
      });

      return { success: true, data: record };
    }

    // ========== 准备填写（获取历史数据 + 相关记忆）==========
    case MSG.PREPARE_FILL: {
      const profile = await getProfile();
      const domain = data.domain || '*';
      const memories = await getMemories(domain);
      return { success: true, data: { profile, memories } };
    }

    // ========== 执行 AI 融合填充（DOM 分析版）==========
    case MSG.EXECUTE_FILL: {
      const { simplifiedDOM, userSupplement, pageContext, domain } = data;
      const profile = await getProfile();
      const memories = await getMemories(domain || '*');
      const config = await getConfig();

      const prompt = buildFillPrompt(simplifiedDOM, profile, memories, userSupplement, pageContext, { quickMode: config.quickMode });
      const result = await callAIForJSON(prompt);

      // 更新用户画像
      if (result.updatedProfile) {
        await mergeProfile(
          result.updatedProfile,
          result.changeLog || [],
          userSupplement ? 'user_supplement' : 'auto_fill'
        );
      }
      
      // 保存 AI 提取的新记忆
      if (result.newMemories && result.newMemories.length > 0) {
        for (const mem of result.newMemories) {
          mem.domain = domain || '*';
          mem.source = 'auto_fill';
        }
        await saveMemories(result.newMemories);
      }

      return { success: true, data: result };
    }

    // ========== 记忆系统 ==========
    case MSG.SAVE_MEMORY: {
      const memory = await saveMemory(data);
      return { success: true, data: memory };
    }

    case MSG.GET_MEMORIES: {
      const memories = await getMemories(data?.domain);
      return { success: true, data: memories };
    }

    case MSG.DELETE_MEMORY: {
      await deleteMemory(data.id);
      return { success: true };
    }

    // ========== 配置管理 ==========
    case MSG.GET_CONFIG: {
      const config = await getConfig();
      return { success: true, data: config };
    }

    case MSG.SAVE_CONFIG: {
      await saveConfig(data);
      return { success: true };
    }

    // ========== SDK 配置 ==========
    case MSG.GET_SDK_CONFIG: {
      const sdkConfig = await getSDKConfig();
      return { success: true, data: sdkConfig };
    }

    case MSG.SAVE_SDK_CONFIG: {
      await saveSDKConfig(data);
      return { success: true };
    }

    // ========== 用户画像 ==========
    case MSG.GET_PROFILE: {
      const profile = await getProfile();
      return { success: true, data: profile };
    }

    case MSG.SAVE_PROFILE: {
      await saveProfile(data);
      return { success: true };
    }

    // ========== 记录管理 ==========
    case MSG.GET_RECORDS: {
      const records = await getRecords();
      return { success: true, data: records };
    }

    case MSG.UPDATE_RECORD: {
      const updated = await updateRecord(data.id, data.record);
      if (updated) {
        return { success: true, data: updated };
      }
      return { success: false, error: 'Record not found' };
    }

    case MSG.DELETE_RECORD: {
      await deleteRecord(data.id);
      return { success: true };
    }

    case MSG.CLEAR_ALL: {
      await clearAll();
      return { success: true };
    }

    default:
      return { success: false, error: `未知消息类型: ${type}` };
  }
}

/**
 * 将结构化字段列表转换为 Profile 格式
 */
function fieldsToProfile(fields) {
  const profile = {
    personal: {},
    contact: {},
    addresses: [],
    work: {},
    education: {},
    preferences: {},
    custom: {},
  };

  const addressInfo = {};

  for (const field of fields) {
    const { category, key, value, label } = field;
    if (!value) continue;

    switch (category) {
      case 'personal':
        profile.personal[key] = value;
        break;
      case 'contact':
        profile.contact[key] = value;
        break;
      case 'address':
        addressInfo[key] = value;
        break;
      case 'work':
        profile.work[key] = value;
        break;
      case 'education':
        profile.education[key] = value;
        break;
      case 'preference':
        profile.preferences[key] = value;
        break;
      default: {
        // 过滤掉不属于个人信息的内容型字段
        const excludePatterns = [
          'message', 'subject', 'comment', 'description', 'content', 'body',
          'note', 'remark', 'feedback', 'question', 'inquiry', 'detail',
          'reason', 'purpose', 'requirement', 'suggestion', 'opinion',
          'text', 'textarea', 'captcha', 'verify', 'code', 'token',
          'csrf', 'password', 'submit', 'action',
        ];
        const fieldKey = (key || label || '').toLowerCase();
        const shouldExclude = excludePatterns.some(p => fieldKey.includes(p));
        if (!shouldExclude) {
          profile.custom[key || label] = value;
        }
        break;
      }
    }
  }

  // 组装地址
  if (Object.keys(addressInfo).length > 0) {
    profile.addresses = [{
      label: 'Default Address',
      ...addressInfo,
      fullAddress: Object.values(addressInfo).join(''),
    }];
  }

  return profile;
}

/**
 * 从已保存的记录中提取记忆（异步，不阻塞主流程）
 * 将结构化字段数据转为自然语言描述，让 AI 提取有价值的记忆
 */
async function extractMemoriesFromRecord(record) {
  if (!record.fields || record.fields.length === 0) return;

  // 将结构化字段转为自然语言描述
  const fieldDescriptions = record.fields
    .filter(f => f.value)
    .map(f => `${f.label || f.key}: ${f.value}`)
    .join('\n');

  const summary = `User submitted a form "${record.formName || 'Unknown Form'}" on ${record.domain || 'unknown site'}.\nPage: ${record.pageTitle || ''}\nFields:\n${fieldDescriptions}`;

  try {
    const prompt = buildMemoryExtractPrompt(summary, `Domain: ${record.domain}, URL: ${record.url}`);
    const result = await callAIForJSON(prompt);

    if (result.memories && result.memories.length > 0) {
      const domain = record.domain || '*';
      for (const mem of result.memories) {
        mem.domain = domain;
        mem.source = 'record_extract';
      }
      await saveMemories(result.memories);
      console.log(`[FormHelper] Extracted ${result.memories.length} memories from record`);
    }
  } catch (err) {
    console.warn('[FormHelper] Memory extraction from record failed:', err.message);
  }
}

export { handleMessage };
