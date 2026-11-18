/**
 * 原生语音适配层：VoiceShell 桥接 + TTS 朗读兜底
 * ---------------------------------------------------------------
 * Android 优先走离线工程 com.sgmcpe.cetAssistant.VoiceShell：
 *   AudioRecord + PCM + RMS VAD + 腾讯云一句话识别 + 系统 TTS + finishListen 状态机
 *
 * 对外导出保持和旧版 voice.js 一致：
 *   speakText / stopSpeaking / isSpeaking
 *   startCallMode / stopCallMode / isCallMode / interruptSpeaking / resumeVoiceListening
 *   onVoiceState / onVoiceResult / setVoiceTextHandler / ensureAudioPermission
 */

import { STORAGE_KEYS } from '@/store/index'
import { storageGet } from '@/utils/storage'

/* ==================== 诊断日志 ==================== */

let logClass = null

function nlog(level, msg) {
  // #ifdef APP-PLUS
  try {
    if (!logClass) logClass = plus.android.importClass('android.util.Log')
    const text = String(msg)
    if (level === 'e') logClass.e('cetvoice', text)
    else logClass.i('cetvoice', text)
  } catch (e) {}
  // #endif
}

function vlog(msg) {
  console.log('[voice] ' + msg)
  nlog('i', msg)
}

function verr(msg, err) {
  const detail = err ? (err.message || err.msg || String(err)) : ''
  const full = detail ? msg + ' | ' + detail : msg
  console.error('[voice] ' + full)
  nlog('e', full)
}

/* ==================== 事件分发 ==================== */

const listeners = {
  state: [],
  result: []
}

export function onVoiceState(cb) {
  listeners.state.push(cb)
}

export function onVoiceResult(cb) {
  listeners.result.push(cb)
}

function emitState(state) {
  const value = String(state || '')
  if (value === 'idle') callModeActive = false
  if (value === 'listening' || value === 'thinking') callModeActive = true
  listeners.state.forEach((cb) => {
    try { cb(value) } catch (e) {}
  })
}

function emitResult(text) {
  const value = String(text || '')
  listeners.result.forEach((cb) => {
    try { cb(value) } catch (e) {}
  })
}

function dispatchVoiceEvent(ev) {
  if (!ev || !ev.e) return
  if (ev.e === 'state') {
    emitState(ev.v)
    return
  }
  if (ev.e !== 'result') return

  const text = String(ev.v || '').trim()
  if (!text) return

  if (currentTextCb) {
    try {
      currentTextCb(text)
    } catch (e) {
      verr('text handler error', e)
      resumeVoiceListening()
    }
    return
  }

  emitResult(text)
  resumeVoiceListening()
}

/* ==================== 状态与密钥 ==================== */

const VOICE_CLASS = 'com.sgmcpe.cetAssistant.VoiceShell'
const PERM_MIC = 'android.permission.RECORD_AUDIO'
const PM_GRANTED = 0
const PERM_TIMEOUT_MS = 20000

let callModeActive = false
let currentTextCb = null

function storageKey(key) {
  try {
    return String(storageGet(key) || '').trim()
  } catch (e) {
    return ''
  }
}

function hasTencentKeys() {
  return !!storageKey(STORAGE_KEYS.TENCENT_ID) && !!storageKey(STORAGE_KEYS.TENCENT_KEY)
}

function toast(msg, duration) {
  try {
    uni.showToast({ title: msg, icon: 'none', duration: duration || 3000 })
  } catch (e) {}
}

/* ==================== Android / VoiceShell 桥接 ==================== */

let voiceShell = null
let voiceShellError = ''
let pollTimer = null

function hasPlusAndroid() {
  // #ifdef APP-PLUS
  return typeof plus !== 'undefined' && !!plus.android && !!plus.android.runtimeMainActivity
  // #endif
  return false
}

function ensureVoiceShell() {
  if (voiceShell) return voiceShell
  // #ifdef APP-PLUS
  if (voiceShellError || !hasPlusAndroid()) return null
  try {
    const main = plus.android.runtimeMainActivity()
    if (!main) throw new Error('runtimeMainActivity unavailable')
    const cls = plus.android.importClass(VOICE_CLASS)
    if (cls) {
      voiceShell = plus.android.invoke(cls, 'getInstance', main)
    }
    if (!voiceShell && typeof plus.android.newObject === 'function') {
      voiceShell = plus.android.newObject(VOICE_CLASS, main)
    }
    if (!voiceShell) throw new Error('VoiceShell instance unavailable')
    ensureVoicePolling()
    vlog('VoiceShell ready')
  } catch (e) {
    voiceShellError = e.message || String(e)
    voiceShell = null
    verr('VoiceShell init failed', e)
  }
  return voiceShell
  // #endif
  return null
}

function callNative(name, args) {
  // #ifdef APP-PLUS
  if (!voiceShell) return null
  try {
    if (!args || args.length === 0) return plus.android.invoke(voiceShell, name)
    if (args.length === 1) return plus.android.invoke(voiceShell, name, args[0])
    if (args.length === 2) return plus.android.invoke(voiceShell, name, args[0], args[1])
    return plus.android.invoke(voiceShell, name, args[0], args[1], args[2])
  } catch (e) {
    verr('native ' + name + ' failed', e)
    return null
  }
  // #endif
  return null
}

function nativeBool(name, args) {
  const res = callNative(name, args)
  return String(res) === 'true'
}

function nativeString(name, args) {
  const res = callNative(name, args)
  return res == null ? '' : String(res)
}

function syncVoiceKeys() {
  const secretId = storageKey(STORAGE_KEYS.TENCENT_ID)
  const secretKey = storageKey(STORAGE_KEYS.TENCENT_KEY)
  if (!secretId || !secretKey) {
    toast('请先在「设置」填写腾讯云 SecretId 和 SecretKey')
    return false
  }
  callNative('setKeys', [secretId, secretKey])
  return true
}

function ensureVoicePolling() {
  if (pollTimer) return
  // #ifdef APP-PLUS
  if (!voiceShell) return
  pollTimer = setInterval(() => {
    if (!voiceShell) return
    try {
      const raw = nativeString('pollEvents') || '[]'
      const events = JSON.parse(raw)
      if (Array.isArray(events)) {
        events.forEach((ev) => {
          try { dispatchVoiceEvent(ev) } catch (e) { verr('poll event dispatch', e) }
        })
      }
    } catch (e) {
      verr('pollEvents parse failed', e)
    }
  }, 150)
  // #endif
}

/* ==================== Android TTS 兜底 ====================
 * VoiceShell 不可用时（例如标准基座 / 旧 APK），只兜底页面朗读；
 * 语音通话不兜底，避免继续走旧的固定分片 mp3 识别。
 */

let fallbackTts = null
let fallbackTtsReady = false
let fallbackTtsInitRequested = false
let fallbackTtsPending = []
let fallbackTtsInitTimer = null
let fallbackSpeaking = false
let fallbackWatchdog = null
let fallbackWatchdogStarted = false

function clearFallbackWatchdog() {
  if (fallbackWatchdog) {
    clearInterval(fallbackWatchdog)
    fallbackWatchdog = null
  }
  fallbackWatchdogStarted = false
}

function fallbackAfterTts() {
  if (callModeActive) {
    setTimeout(() => {
      if (callModeActive) resumeVoiceListening()
    }, 150)
  } else {
    emitState('idle')
  }
}

function flushFallbackPending() {
  const pending = fallbackTtsPending
  fallbackTtsPending = []
  pending.forEach((text) => {
    try { fallbackSpeak(text) } catch (e) {}
  })
}

function ensureFallbackTts() {
  // #ifdef APP-PLUS
  if (fallbackTts) return fallbackTts
  if (fallbackTtsInitRequested) return null
  if (!hasPlusAndroid()) return null
  fallbackTtsInitRequested = true
  try {
    const main = plus.android.runtimeMainActivity()
    const TTS = plus.android.importClass('android.speech.tts.TextToSpeech')
    const Locale = plus.android.importClass('java.util.Locale')

    const progressListener = plus.android.implements('android.speech.tts.UtteranceProgressListener', {
      onStart: function () {
        fallbackSpeaking = true
        emitState('speaking')
      },
      onDone: function () {
        clearFallbackWatchdog()
        fallbackSpeaking = false
        fallbackAfterTts()
      },
      onError: function () {
        clearFallbackWatchdog()
        fallbackSpeaking = false
        fallbackAfterTts()
      },
      onStop: function () {
        fallbackSpeaking = false
      }
    })

    const initListener = plus.android.implements('android.speech.tts.TextToSpeech$OnInitListener', {
      onInit: function (status) {
        if (status === 0) {
          fallbackTtsReady = true
          if (fallbackTtsInitTimer) {
            clearTimeout(fallbackTtsInitTimer)
            fallbackTtsInitTimer = null
          }
          try {
            fallbackTts.setLanguage(Locale.US)
            fallbackTts.setOnUtteranceProgressListener(progressListener)
          } catch (e) {}
          flushFallbackPending()
        } else {
          verr('fallback tts init failed, status=' + status)
          fallbackTtsPending = []
          if (fallbackTtsInitTimer) {
            clearTimeout(fallbackTtsInitTimer)
            fallbackTtsInitTimer = null
          }
          fallbackAfterTts()
        }
      }
    })

    fallbackTts = new TTS(main, initListener)
    if (!fallbackTtsInitTimer) {
      fallbackTtsInitTimer = setTimeout(() => {
        fallbackTtsInitTimer = null
        if (!fallbackTtsReady && fallbackTtsPending.length) {
          verr('fallback tts init timeout')
          fallbackTtsPending = []
          fallbackAfterTts()
        }
      }, 3000)
    }
    return fallbackTts
  } catch (e) {
    verr('fallback tts create failed', e)
    return null
  }
  // #endif
  return null
}

function startFallbackWatchdog() {
  // #ifdef APP-PLUS
  if (!fallbackTts) return
  clearFallbackWatchdog()
  const t0 = Date.now()
  fallbackWatchdog = setInterval(() => {
    let busy = false
    try {
      busy = String(fallbackTts.isSpeaking()) === 'true'
    } catch (e) {
      clearFallbackWatchdog()
      return
    }
    if (busy) {
      fallbackWatchdogStarted = true
      return
    }
    if (fallbackWatchdogStarted) {
      clearFallbackWatchdog()
      fallbackSpeaking = false
      fallbackAfterTts()
      return
    }
    if (Date.now() - t0 > 6000) {
      clearFallbackWatchdog()
      fallbackSpeaking = false
      fallbackAfterTts()
    }
  }, 400)
  // #endif
}

function fallbackStopSpeaking() {
  fallbackSpeaking = false
  clearFallbackWatchdog()
  // #ifdef APP-PLUS
  if (fallbackTts) {
    try { fallbackTts.stop() } catch (e) {}
  }
  // #endif
}

function fallbackSpeak(text) {
  // #ifdef APP-PLUS
  if (!text || !hasPlusAndroid()) return false
  const tts = ensureFallbackTts()
  if (!tts) return false
  if (!fallbackTtsReady) {
    if (!fallbackTtsInitTimer) {
      fallbackAfterTts()
      return false
    }
    fallbackTtsPending.push(String(text))
    return true
  }

  try {
    const Locale = plus.android.importClass('java.util.Locale')
    const hasChinese = /[\u4e00-\u9fa5]/.test(text)
    const locale = hasChinese ? Locale.CHINA : Locale.US
    tts.setLanguage(locale)
    const QUEUE_FLUSH = 0
    const result = tts.speak(String(text), QUEUE_FLUSH, null, 'cet-' + Date.now())
    if (result === -1) {
      fallbackAfterTts()
      return false
    }
    fallbackSpeaking = true
    startFallbackWatchdog()
    return true
  } catch (e) {
    verr('fallback speak failed', e)
    fallbackAfterTts()
    return false
  }
  // #endif
  return false
}

/* ==================== 麦克风权限 ==================== */

let micGranted = false
let permInFlight = false
let permWaiters = []

function isOldAndroid() {
  // #ifdef APP-PLUS
  try {
    const major = parseInt(String(plus.os.version || ''), 10)
    return !isNaN(major) && major > 0 && major < 6
  } catch (e) {
    return false
  }
  // #endif
  return false
}

function checkMicPermission() {
  // #ifdef APP-PLUS
  if (isOldAndroid()) return true
  if (!hasPlusAndroid()) return false
  try {
    const main = plus.android.runtimeMainActivity()
    const state = plus.android.invoke(main, 'checkSelfPermission', PERM_MIC)
    return state === PM_GRANTED
  } catch (e) {
    verr('checkSelfPermission error', e)
    return false
  }
  // #endif
  return false
}

function openAppPermissionSettings() {
  // #ifdef APP-PLUS
  try {
    const main = plus.android.runtimeMainActivity()
    const Intent = plus.android.importClass('android.content.Intent')
    const intent = new Intent('android.settings.APPLICATION_DETAILS_SETTINGS')
    try {
      const Uri = plus.android.importClass('android.net.Uri')
      intent.setData(Uri.parse('package:' + main.getPackageName()))
    } catch (e) {
      verr('set settings uri failed', e)
    }
    main.startActivity(intent)
    vlog('opened app settings')
    return
  } catch (e) {
    verr('open settings failed', e)
  }
  // #endif
  try {
    if (typeof uni.openAppAuthorizeSetting === 'function') uni.openAppAuthorizeSetting({})
  } catch (e) {
    verr('openAppAuthorizeSetting failed', e)
  }
}

function handlePermissionFailure(reason) {
  if (reason === 'unsupported') {
    toast('当前环境不支持语音通话')
    return
  }
  if (reason === 'deniedAlways' || reason === 'apiError' || reason === 'timeout') {
    uni.showModal({
      title: '需要麦克风权限',
      content: '语音通话需要麦克风权限。请在系统设置中找到本应用，允许使用麦克风后返回重试。',
      confirmText: '去设置',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) openAppPermissionSettings()
      }
    })
    return
  }
  toast('没有麦克风权限，请允许后重试')
}

export function ensureAudioPermission(cb) {
  // #ifndef APP-PLUS
  cb({ ok: false, reason: 'unsupported' })
  return
  // #endif
  // #ifdef APP-PLUS
  const plusOk = hasPlusAndroid() && typeof plus.android.requestPermissions === 'function'
  if (!plusOk) {
    verr('plus.android not available')
    cb({ ok: false, reason: 'apiError' })
    return
  }
  if (micGranted && checkMicPermission()) {
    cb({ ok: true, reason: 'granted' })
    return
  }
  micGranted = false

  permWaiters.push(cb)
  if (permInFlight) return
  permInFlight = true

  let settled = false
  let timer = null
  const finish = (result) => {
    if (settled) return
    settled = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    permInFlight = false
    micGranted = !!result.ok
    vlog('perm result: ' + result.reason)
    const list = permWaiters
    permWaiters = []
    list.forEach((fn) => {
      try { fn(result) } catch (e) {}
    })
  }

  timer = setTimeout(() => {
    if (settled) return
    vlog('perm request timeout, re-check')
    finish(checkMicPermission() ? { ok: true, reason: 'granted' } : { ok: false, reason: 'timeout' })
  }, PERM_TIMEOUT_MS)

  vlog('perm request RECORD_AUDIO')
  try {
    plus.android.requestPermissions([PERM_MIC], (res) => {
      if (checkMicPermission()) {
        finish({ ok: true, reason: 'granted' })
        return
      }
      if (res && res.deniedAlways && res.deniedAlways.length > 0) {
        finish({ ok: false, reason: 'deniedAlways' })
        return
      }
      finish({ ok: false, reason: 'denied' })
    }, (err) => {
      verr('perm request fail', err)
      finish(checkMicPermission() ? { ok: true, reason: 'granted' } : { ok: false, reason: 'apiError' })
    })
  } catch (e) {
    verr('perm request throw', e)
    finish(checkMicPermission() ? { ok: true, reason: 'granted' } : { ok: false, reason: 'apiError' })
  }
  // #endif
}

/* ==================== 对外 API ==================== */

export function isCallMode() {
  // #ifdef APP-PLUS
  if (voiceShell) {
    try {
      return nativeBool('isCallMode')
    } catch (e) {
      verr('native isCallMode failed', e)
    }
  }
  // #endif
  return !!callModeActive
}

export function isSpeaking() {
  // #ifdef APP-PLUS
  if (voiceShell) {
    try {
      return nativeBool('isSpeaking')
    } catch (e) {
      verr('native isSpeaking failed', e)
    }
  }
  // #endif
  return fallbackSpeaking
}

export function speakText(text) {
  if (!text) return false
  // #ifdef APP-PLUS
  if (ensureVoiceShell()) {
    try {
      if (syncVoiceKeys() && nativeBool('speak', [String(text)])) return true
    } catch (e) {
      verr('native speak failed', e)
    }
  }
  if (fallbackSpeak(String(text))) return true
  // #endif
  if (!callModeActive) emitState('idle')
  return false
}

export function stopSpeaking() {
  fallbackStopSpeaking()
  // #ifdef APP-PLUS
  if (voiceShell) {
    callNative('stopSpeaking')
    return
  }
  // #endif
  if (!callModeActive) emitState('idle')
}

export function startCallMode() {
  // #ifdef APP-PLUS
  if (!ensureVoiceShell()) {
    toast('语音通话需要重新编译自定义基座或正式 APK')
    if (!callModeActive) emitState('idle')
    return false
  }
  if (!hasTencentKeys()) {
    toast('请先在「设置」填写腾讯云 SecretId 和 SecretKey')
    if (!callModeActive) emitState('idle')
    return false
  }

  callModeActive = true
  ensureAudioPermission((result) => {
    if (!callModeActive) return
    if (!result.ok) {
      micGranted = false
      verr('perm denied: ' + result.reason)
      handlePermissionFailure(result.reason)
      stopCallMode()
      return
    }
    if (!syncVoiceKeys()) {
      stopCallMode()
      return
    }
    try {
      if (!nativeBool('startCallMode')) {
        verr('native startCallMode returned false')
        stopCallMode()
      }
    } catch (e) {
      verr('native startCallMode failed', e)
      stopCallMode()
    }
  })
  return true
  // #endif

  toast('当前环境不支持语音通话')
  if (!callModeActive) emitState('idle')
  return false
}

export function stopCallMode() {
  callModeActive = false
  fallbackStopSpeaking()
  // #ifdef APP-PLUS
  if (voiceShell) callNative('stopCallMode')
  // #endif
  emitState('idle')
}

export function interruptSpeaking() {
  stopSpeaking()
  // #ifdef APP-PLUS
  if (voiceShell) {
    callNative('interruptSpeaking')
    return
  }
  // #endif
  if (callModeActive) {
    setTimeout(() => {
      if (callModeActive) resumeVoiceListening()
    }, 300)
  }
}

export function resumeVoiceListening() {
  if (!callModeActive) return
  // #ifdef APP-PLUS
  if (voiceShell) {
    callNative('resumeListening')
    return
  }
  // #endif
  setTimeout(() => {
    if (callModeActive) emitState('listening')
  }, 150)
}

export function setVoiceTextHandler(cb) {
  currentTextCb = cb
}
