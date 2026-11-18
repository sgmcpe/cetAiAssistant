/**
 * DeepSeek 大模型调用封装
 * ---------------------------------------------------------------
 * 与原版 script.js 的 callDeepSeek / callDeepSeekChat 完全一致：
 *   - 非流式 POST https://api.deepseek.com/v1/chat/completions
 *   - model: deepseek-chat, temperature 0.3
 */
import { storageGet } from '@/utils/storage'
import { STORAGE_KEYS } from '@/store/index'

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'

/** 统一追加的 system 规则：100 字内、不要客套 */
function withBriefRule(messages) {
  const rule = {
    role: 'system',
    content: '回答尽量简短（一般不超过100字），直接给结论，不要客套话、不要重复题目。'
  }
  return [rule].concat(messages || [])
}

/**
 * 多轮对话调用
 * @param {Array} messages [{role, content}]
 * @param {Number} maxTokens
 */
export async function callDeepSeekChat(messages, maxTokens = 1000) {
  const token = storageGet(STORAGE_KEYS.TOKEN)
  if (!token) {
    throw new Error('请先在设置页填写 DeepSeek Api Key')
  }
  const body = {
    model: 'deepseek-chat',
    messages: withBriefRule(messages),
    temperature: 0.3,
    max_tokens: maxTokens
  }
  return await post(body, token)
}

/**
 * 单轮调用
 * @param {String} prompt
 * @param {Number} maxTokens
 */
export async function callDeepSeek(prompt, maxTokens = 1000) {
  const token = storageGet(STORAGE_KEYS.TOKEN)
  if (!token) {
    throw new Error('请先在设置页填写 DeepSeek Api Key')
  }
  const body = {
    model: 'deepseek-chat',
    messages: withBriefRule([{ role: 'user', content: prompt }]),
    temperature: 0.3,
    max_tokens: maxTokens
  }
  return await post(body, token)
}

async function post(body, token) {
  let res
  try {
    res = await uni.request({
      url: DEEPSEEK_URL,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      data: body
    })
  } catch (e) {
    throw new Error('网络请求失败，请检查网络')
  }
  const status = res.statusCode
  if (status === 401) {
    throw new Error('DeepSeek Token 无效，请检查设置')
  } else if (status === 402) {
    throw new Error('DeepSeek 余额不足，请充值')
  } else if (status === 429) {
    throw new Error('请求过于频繁，请稍后再试')
  } else if (status !== 200) {
    throw new Error(`DeepSeek 返回错误（${status}）`)
  }
  const data = res.data
  if (data && data.choices && data.choices[0] && data.choices[0].message) {
    return data.choices[0].message.content
  }
  throw new Error('DeepSeek 返回内容为空')
}

/* ==================== 结果清洗工具（与原版一致） ==================== */

export function stripMarkdownBold(text) {
  return String(text || '').replace(/\*\*/g, '').replace(/^#+\s*/gm, '')
}

/** 压缩多余空行 */

export function compactLines(text) {
  return String(text || '').replace(/\n{3,}/g, '\n\n').trim()
}

/** 去掉 AI 重复的英文标题行 */

export function dropEnglishHeadline(text) {
  // 去掉 AI 偶尔重复的英文标题行
  const lines = String(text || '').split('\n')
  return lines
    .filter((line) => {
      const t = line.trim()
      if (!t) return true
      // 全英文且很短的行（像是标题），删掉
      if (/^[A-Za-z0-9 ,.'!?;:-]{1,60}$/.test(t) && t.split(' ').length <= 8) {
        return false
      }
      return true
    })
    .join('\n')
    .trim()
}
