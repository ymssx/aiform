// ============================================
// 公共类型与常量定义
// ============================================

/** 消息类型常量 */
export const MSG = {
  // 表单提交 → 提取
  EXTRACT_FORM: 'EXTRACT_FORM',
  // 保存记录
  SAVE_RECORD: 'SAVE_RECORD',
  // 准备填写（获取历史数据）
  PREPARE_FILL: 'PREPARE_FILL',
  // 执行填写
  EXECUTE_FILL: 'EXECUTE_FILL',
  // 获取配置
  GET_CONFIG: 'GET_CONFIG',
  // 保存配置
  SAVE_CONFIG: 'SAVE_CONFIG',
  // 获取用户画像
  GET_PROFILE: 'GET_PROFILE',
  // 获取历史记录列表
  GET_RECORDS: 'GET_RECORDS',
  // 删除记录
  DELETE_RECORD: 'DELETE_RECORD',
  // 清空所有数据
  CLEAR_ALL: 'CLEAR_ALL',
  // 记忆系统
  SAVE_MEMORY: 'SAVE_MEMORY',
  GET_MEMORIES: 'GET_MEMORIES',
  DELETE_MEMORY: 'DELETE_MEMORY',
  // SDK 相关
  GET_SDK_CONFIG: 'GET_SDK_CONFIG',
  SAVE_SDK_CONFIG: 'SAVE_SDK_CONFIG',
};

/** 存储 Key 常量 */
export const STORAGE_KEYS = {
  USER_CONFIG: 'user_config',
  USER_PROFILE: 'user_profile',
  FORM_RECORDS: 'form_records',
  USER_MEMORIES: 'user_memories',
  SDK_CONFIG: 'sdk_config',
};

/** 默认配置 */
export const DEFAULT_CONFIG = {
  apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  modelName: 'qwen-plus',
  apiKey: '',
  autoDetect: true,
  enabledDomains: [],
};

/** 默认用户画像 */
export const DEFAULT_PROFILE = {
  id: 'default_user',
  lastUpdated: 0,
  personal: {},
  contact: {},
  addresses: [],
  work: {},
  education: {},
  preferences: {},
  custom: {},
  changeHistory: [],
};

/** 默认 SDK 配置 */
export const DEFAULT_SDK_CONFIG = {
  enabled: true,
  shareMode: 'global',  // 'global' = 所有域名共享, 'domain' = 仅本域名共享
  allowedDomains: [],    // shareMode='domain' 时的域名白名单
  showButton: true,      // 是否显示浮动按钮
  buttonPosition: { bottom: '80px', right: '20px' },
};
