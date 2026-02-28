
// ============================================
// AI 服务层 - 封装 OpenAI 兼容协议调用
// ============================================

import { STORAGE_KEYS, DEFAULT_CONFIG } from '../shared/constants.js';
import { safeParseJSON } from '../shared/utils.js';

/**
 * 获取用户配置
 */
async function getAIConfig() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.USER_CONFIG);
  return { ...DEFAULT_CONFIG, ...result[STORAGE_KEYS.USER_CONFIG] };
}

/**
 * 调用 AI 接口（OpenAI Chat Completions 兼容协议）
 * @param {string} prompt - 用户 prompt
 * @returns {Promise<string>} - AI 返回的文本内容
 */
export async function callAI(prompt) {
  const config = await getAIConfig();

  if (!config.apiKey) {
    throw new Error('Please configure API Key in extension settings first');
  }

  const url = `${config.apiEndpoint.replace(/\/+$/, '')}/chat/completions`;
  const isQuickMode = config.quickMode === true;

  const systemContent = isQuickMode
    ? 'You are a JSON data processing expert. All output must be strict JSON format, do not include markdown code block markers or any extra text. Do not think, do not reason, do not explain, directly output the final JSON result.'
    : 'You are a JSON data processing expert. All output must be strict JSON format, do not include markdown code block markers or any extra text.';

  // 构建请求参数
  const requestBody = {
    model: config.modelName,
    messages: [
      { role: 'system', content: systemContent },
      { role: 'user', content: prompt },
    ],
    temperature: isQuickMode ? 0 : 0.1,
    max_tokens: 8192,
  };

  // 快速模式：尝试禁用模型的深度思考/推理能力
  // 不同模型供应商的参数格式不同，按模型名称精准下发参数
  if (isQuickMode) {
    const model = (config.modelName || '').toLowerCase();
    const endpoint = (config.apiEndpoint || '').toLowerCase();

    // DeepSeek 推理模型（deepseek-reasoner）：通过 thinking 参数控制
    // 注意：deepseek-chat 不支持 thinking 参数，不能下发
    if (model.includes('reasoner') || model.includes('r1')) {
      requestBody.thinking = { type: 'disabled' };
    }

    // Qwen 系列（qwq / qwen3 等推理模型）：通过 enable_thinking 参数控制
    if (model.includes('qwq') || model.includes('qwen3') || endpoint.includes('dashscope')) {
      requestBody.enable_thinking = false;
    }

    // OpenAI o 系列推理模型：通过 reasoning_effort 控制
    if (model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
      requestBody.reasoning_effort = 'low';
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI API call failed (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('AI returned empty content');
  }

  return content;
}

/**
 * 调用 AI 并解析 JSON 结果
 * @param {string} prompt
 * @returns {Promise<Object>}
 */
export async function callAIForJSON(prompt) {
  const content = await callAI(prompt);
  const parsed = safeParseJSON(content);
  if (!parsed) {
    throw new Error('AI response cannot be parsed as JSON: ' + content.substring(0, 200));
  }
  return parsed;
}
