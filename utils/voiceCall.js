/**
 * 语音通话闭环控制器
 * ---------------------------------------------------------------
 * 把「录音 → 腾讯云一句话识别 → 拿到文字 → 交给页面提问 → DeepSeek →
 * TTS 朗读 → 自动续听」整条链路串起来，
 * 以内部事件订阅 + 回调注册取代原版 window.onVoiceResult / window.onVoiceState。
 *
 * 关键：一句话识别拿到文字后的回调（setVoiceTextHandler）是全局单例，只注册一次；
 * 具体是哪一页处理，由 setVoiceResultTarget(fn) 在页面 onShow 时切换。
 * 页面统一通过 utils/callSession.js 的 useCallSession({ onResult }) 接入。
 */
import useStore from '@/store/index'
import { callDeepSeekChat } from '@/utils/deepseek'
import { stripMarkdownBold } from '@/utils/cet'
import {
  startCallMode, stopCallMode, interruptSpeaking, isCallMode, speakText,
  setVoiceTextHandler, onVoiceState, resumeVoiceListening
} from '@/utils/voice'

const state = useStore()

let pipelineReady = false
let asrSeq = 0            // 作废在途识别
let activeOnResult = null // 当前页面拿到识别文字后的回调

function isFillerText(text) {
  const value = String(text || '').replace(/[\s，。、,.!！?？…~～]/g, '')
  if (value.length === 0) return true
  if (/^[对嗯啊哦呃唔噢呀哎诶嘿哈哟好行是的了]{1,6}$/.test(value)) return true
  if (/^(.)\1{1,5}$/.test(value)) return true
  return false
}

/** 切换当前页面的识别结果回调（页面 onShow 时调用） */
export function setVoiceResultTarget(fn) {
  activeOnResult = typeof fn === 'function' ? fn : null
}

/** 作废在途识别结果：挂断 / 切页时调用，避免异步回调继续触发页面逻辑 */
export function invalidateVoiceRequests() {
  asrSeq++
}

/** 恢复收音：提问 / 加词失败后重开一轮，避免卡在暂停状态（不改 callMode，避免按钮闪动） */
export function resumeListening() {
  resumeVoiceListening()
}

/**
 * 注册语音闭环（全局只生效一次）。幂等，可在每个页面的 setup 里放心调用。
 */
export function registerVoicePipeline() {
  if (pipelineReady) return
  pipelineReady = true

  const applyText = (q) => {
    const text = String(q || '').trim()
    if (!text) {
      uni.showToast({ title: '没有听清，请再说一次', icon: 'none' })
      resumeListening()
      return
    }
    if (isFillerText(text)) {
      resumeListening()
      return
    }
    if (activeOnResult) activeOnResult(text)
    else resumeListening()
  }

  // 腾讯云一句话识别：录音完成后 HTTP 返回识别文字，空结果自动重试
  setVoiceTextHandler((text) => {
    asrSeq++
    applyText(text)
  })

  // 语音状态同步到全局（listening / speaking / idle）
  onVoiceState((s) => {
    state.callMode = s !== 'idle'
    state.voiceSpeaking = s === 'speaking'
  })
}

/**
 * 生成「语音提问 → AI 回答 → TTS 朗读」的处理函数。
 * buildContext() 返回本轮系统提示（页面自己拼当前句子 / 原文 / 题目等上下文）。
 * 朗读结束由 TTS onDone 自动续听；失败时也续听，避免卡住。
 */
export function createVoiceAnswerer(buildContext, opts = {}) {
  const maxTokens = opts.maxTokens || 500
  return async function handleVoiceResult(text) {
    const q = String(text || '').trim()
    if (!q) {
      uni.showToast({ title: '没有听清，请再说一次', icon: 'none' })
      resumeListening()
      return
    }
    if (state.chatLoading) {
      resumeListening()
      return
    }
    state.chatLoading = true
    try {
      let sys = ''
      try { sys = buildContext() || '' } catch (e) {}
      const messages = []
      if (sys) messages.push({ role: 'system', content: sys })
      messages.push({ role: 'user', content: q })
      const answer = await callDeepSeekChat(messages, maxTokens)
      const reply = stripMarkdownBold(answer || '')
      if (reply) {
        state.voiceAskMode = true
        speakText(reply)
      } else {
        resumeListening()
      }
    } catch (err) {
      uni.showToast({ title: `回答失败：${err.message}`, icon: 'none' })
      if (state.callMode) resumeListening()
    }
    state.chatLoading = false
  }
}

/**
 * 兼容旧用法：页面自己 startCall / hangupCall。
 * 当前页面统一走 useCallSession，这里保留给出示例与单独接入的场景。
 */
export function useVoiceCall(opts = {}) {
  setVoiceResultTarget(opts.onResult || opts.onVoiceResult)
  registerVoicePipeline()

  function startCall() {
    if (isCallMode()) return
    state.callMode = true
    startCallMode()
  }

  function hangupCall() {
    state.callMode = false
    state.voiceSpeaking = false
    asrSeq++   // 作废在途识别
    stopCallMode()
  }

  function interruptCall() {
    interruptSpeaking()
  }

  return { startCall, hangupCall, interruptCall, resumeListening }
}
