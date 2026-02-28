
// ============================================
// Prompt 模板管理
// ============================================

/**
 * 表单数据结构化提取 + 记忆提取 Prompt
 * @param {Array} rawFields - 原始表单字段数据
 * @param {string} pageContext - 页面上下文信息（标题、URL等）
 */
export function buildExtractPrompt(rawFields, pageContext) {
  return `You are a form data structuring expert and an intelligent memory assistant.

## Task
1. Extract the following raw form data into structured JSON
2. **Extract all potentially useful memory information from the form data**

## Page Context
${pageContext || 'None'}

## Requirements
1. Infer a semantic category for each field (personal/contact/address/work/education/preference/other)
2. Generate a standardized English label for each field
3. Ignore CSRF tokens, meaningless hidden fields, and empty-value fields
4. Do not include password fields
5. Generate a short name for the entire form
6. **Memory extraction rules**: Infer valuable memories from form content, including but not limited to:
   - User's travel plans (e.g., destination, date, transportation)
   - User's preferences (e.g., frequently used addresses, preferred seat types)
   - User's pending intentions (e.g., appointments, purchase plans)
   - Any context information helpful for future form filling

## Raw Data
${JSON.stringify(rawFields, null, 2)}

## Output Format (strict JSON, no extra text)
{
  "formName": "Form name",
  "fields": [
    {
      "category": "personal|contact|address|work|education|preference|other",
      "label": "English field label",
      "key": "field identifier",
      "value": "field value",
      "type": "text|email|phone|date|select|textarea|number"
    }
  ],
  "memories": [
    {
      "content": "Natural language description of the memory, e.g.: User plans to visit Guangzhou on Feb 28",
      "category": "intent|preference|fact|context",
      "expiresAt": null,
      "metadata": {}
    }
  ]
}

Category descriptions for memories:
- intent: Intentions/plans (e.g., travel plans, shopping plans), usually time-sensitive
- preference: Preferences/habits (e.g., prefers window seat), usually long-term
- fact: Factual information (e.g., ID card number, passport number), usually long-term
- context: Temporary context (e.g., current task being handled), usually short-term

expiresAt: If a memory has clear time relevance (e.g., "going to Guangzhou the day after tomorrow"), calculate a reasonable expiration timestamp (milliseconds) based on current time: ${Date.now()}. Set to null for long-term memories.`;
}

/**
 * 智能融合填充 Prompt（简化 HTML + data-fh-id 版）
 * AI 直接分析简化后的表单 DOM HTML，通过 data-fh-id 属性定位元素
 * 
 * @param {string} simplifiedDOM - 简化后的表单 HTML（含 data-fh-id 标记）
 * @param {Object} userProfile - 用户画像
 * @param {Array} memories - 相关记忆条目
 * @param {string} userSupplement - 用户补充输入
 * @param {string} pageContext - 页面上下文
 * @param {Object} options - 可选参数 { quickMode: boolean }
 */
export function buildFillPrompt(simplifiedDOM, userProfile, memories, userSupplement, pageContext, options = {}) {
  // 清洗画像数据：剔除对 AI 填充无用的字段，大幅减少 token 消耗
  const cleanProfile = cleanProfileForPrompt(userProfile);
  const isQuickMode = options.quickMode === true;

  // Quick mode: minimal prompt, skip detailed rules, let AI return results directly
  if (isQuickMode) {
    return `Analyze the following form DOM HTML, combine with user info, and directly return JSON fill instructions. Do not think, do not reason, output results directly.

## Form DOM HTML
Each fillable element has a \`data-fh-id\` attribute (e.g. \`data-fh-id="3"\`). Use this ID in the "id" field of your response.
\`\`\`html
${simplifiedDOM}
\`\`\`

## User Info
${JSON.stringify(cleanProfile, null, 2)}

## Memories
${memories.length > 0 ? memories.map(m => `- ${m.content}`).join('\n') : 'None'}

## Supplement
"${userSupplement || 'None'}"

${userSupplement?.includes?.('[AI_GENERATE]') ? '【MUST generate content for every field, NEVER return null】' : ''}

## Output Format (strict JSON, no extra text)
{"fields":[{"id":1,"label":"field name","value":"value to fill","type":"text|select|textarea|checkbox|radio"}]}

IMPORTANT:
- "id" must be the data-fh-id number from the HTML
- For select, value must be chosen from <option> text
- For radio/checkbox, fill the option's value or text
- Output ALL fillable fields, do NOT skip any
- fields array MUST be complete`;
  }

  // Standard mode: full detailed prompt
  return `You are a super-intelligent form filling assistant. You will directly analyze the form's DOM structure to understand the meaning of each field.

## Task
Analyze the following form DOM HTML, understand the purpose of each field, and generate precise fill instructions based on user information.

**IMPORTANT**: Each fillable element (input, select, textarea, etc.) has a \`data-fh-id\` attribute like \`data-fh-id="3"\`. You MUST use this ID number in your response to reference the element.

## Page Context
URL/Title: ${pageContext || 'Unknown'}

## Form DOM HTML
\`\`\`html
${simplifiedDOM}
\`\`\`

## User Profile (structured info)
${JSON.stringify(cleanProfile, null, 2)}

## User Memories (natural language entries)
${memories.length > 0 ? memories.map(m => `- [${m.category}] ${m.content}${m.metadata ? ' ' + JSON.stringify(m.metadata) : ''}`).join('\n') : 'No memories yet'}

## User Supplement for This Session
"${userSupplement || 'None'}"

## DOM Analysis Rules
1. Carefully read the DOM structure, identify every fillable form field (input, select, textarea, [role="textbox"], [role="combobox"], [contenteditable="true"], etc.)
2. Each fillable element has a \`data-fh-id="N"\` attribute — this is the element's unique ID
3. Understand field meaning through label, placeholder, name, id, and context text
4. Labels may be:
   - <label> tags (associated via for attribute or wrapping relationship)
   - Text in <div>/<span> before/above the field
   - Elements with class names containing "label"
   - Component library label containers (e.g., .t-form__label, .ant-form-item-label, .el-form-item__label, .wg-component-label, etc.)
5. For native <select>, choose from its <option> elements
6. For custom dropdowns (non-native <select>), identify available options through option list text in the DOM

## Fill Instruction Format
Return an instruction object for each field that needs filling:
- **id**: The data-fh-id number from the DOM — **MUST match exactly**
- **label**: The field's label (extracted from DOM context)
- **value**: The value to fill
- **type**: Field type (text/number/email/phone/date/select/textarea/checkbox/radio)

## Core Fill Rules
1. **Priority**: User's current supplement > Related memories > User profile
2. User supplement may be natural language; you need to understand and extract structured info
3. **Smart memory association**: If a memory mentions "going to Guangzhou" and the form has a "destination" field, fill "Guangzhou"
4. For select type fields, value must be chosen from available options
5. **checkbox**: Fill "true" or "false"
6. **radio**: Fill the option's value or text
7. **Smart generate mode**: ${userSupplement?.includes?.('[AI_GENERATE]') ? 'ENABLED. **MUST generate content for every single field, absolutely NO null values allowed**. For fields without historical data, use your imagination to generate reasonable, realistic mock data.' : 'DISABLED. But you should still **try your best to fill every field**. Only skip in extreme cases where the field meaning is completely incomprehensible.'}
8. **Better to fill wrong than leave empty**: Modifying an incorrect value is much easier for users than typing from scratch
9. Date format should match the format required by the form
10. Do not fill submit/button/reset type elements
11. Do not fill disabled or readonly elements (unless you are sure they are dynamically enabled)

## Output Format (strict JSON, no extra text)
{
  "fields": [
    {
      "id": 1,
      "label": "field label",
      "value": "value to fill",
      "type": "field type"
    }
  ],
  "updatedProfile": {},
  "newMemories": [],
  "changeLog": []
}

**CRITICAL**: 
- The "fields" array is the most important part. You MUST output ALL fillable fields. Do NOT omit any.
- Put ALL fields FIRST, then updatedProfile/newMemories/changeLog (keep these minimal/empty if token budget is tight).
- If a field's meaning is unclear, still try to fill it with a reasonable guess.

Current timestamp: ${Date.now()}`;
}

/**
 * 清洗画像数据：剔除 changeHistory / lastUpdated / id 等对 AI 填充无用的字段
 * 同时移除值为空对象、空数组的分类，减少 token
 * @param {Object} profile
 * @returns {Object}
 */
export function cleanProfileForPrompt(profile) {
  if (!profile) return {};
  const {
    changeHistory, lastUpdated, id,
    ...rest
  } = profile;

  // 进一步移除空分类（如 personal: {}, custom: {} 等）
  const cleaned = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * 记忆提取 Prompt（从用户自然语言输入中提取记忆）
 * @param {string} userInput - 用户的自然语言输入
 * @param {string} pageContext - 页面上下文
 */
export function buildMemoryExtractPrompt(userInput, pageContext) {
  return `You are an intelligent memory management assistant.

## Task
Extract all valuable memory information from the user's input.

## Page Context
${pageContext || 'None'}

## User Input
"${userInput}"

## Extraction Rules
1. Extract everything that could be useful in the future
2. Each memory should be independent and atomic
3. Infer reasonable categories and expiration times
4. If the user mentions relative time like "the day after tomorrow" or "next week", calculate absolute time based on current time

Current timestamp: ${Date.now()}
Current date: ${new Date().toLocaleDateString('en-US')}

## Output Format (strict JSON)
{
  "memories": [
    {
      "content": "Memory content description",
      "category": "intent|preference|fact|context",
      "expiresAt": null,
      "metadata": { "key_field": "structured_value" }
    }
  ]
}`;
}


