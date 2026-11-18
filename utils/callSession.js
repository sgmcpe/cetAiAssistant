/**
 * 语音通话会话：统一挂断入口 + 页面级自动挂断
 * ------------------------------------------------------------------
 * 对齐 HTML 原版 js/script.js 的 hangupCall()，并按 uni-app / Vue3 规范化：
 *   - 通话状态放在全局 store（callMode / voiceSpeaking / voiceAskMode），
 *     页面切走时若不复位，下一页会继续显示「打断 / 挂断」，麦克风也还在收音。
 *   - 只在页面生命周期 onHide / onUnload 挂断：navigateTo、redirectTo、
 *     navigateBack、switchTab、切后台都会触发这几个钩子；而页内左右滑
 *     （切句 / 切原文题目屏）只改页面内 ref，不触发生命周期，通话会保持。
 *   - Vue3 下 onHide / onUnload 必须从 @dcloudio/uni-app 导入，否则静默失效。
 */
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import useStore from '@/store/index'
import * as CET from '@/utils/cet'
import { registerVoicePipeline, setVoiceResultTarget, invalidateVoiceRequests } from '@/utils/voiceCall'

const state = useStore()

/** store 状态与底层录音状态任一为真都算通话中，避免两者漂移后漏挂断 */
export function isCalling() {
  return !!state.callMode || !!CET.isCallMode()
}

/**
 * 统一挂断：停朗读、停录音、复位全局状态。幂等，可重复调用。
 * 不动页面的侧栏展开状态，挂断后「打断 / 挂断」由 v-if 移除、
 * 电话圆钮自然恢复；展开状态下电话按钮立即可见。
 */
export function hangupCall() {
  if (!isCalling()) return
  state.callMode = false
  state.voiceSpeaking = false
  state.voiceAskMode = false
  invalidateVoiceRequests()
  CET.stopSpeaking()
  CET.stopCallMode()
}

/**
 * 页面侧通话会话。参数：
 *   onBeforeStart()  开始通话前由页面准备上下文（如做题页设置 askContext）
 *   onResult(text)   语音识别拿到文字后的回调（页面填输入框 → 提问；
 *                    AI 回复后页面 speakText，TTS onDone 自动续听）
 * 返回 toggleCall / hangupCall / interruptCall，直接绑到 VoiceSideNav 的事件上。
 */
export function useCallSession(options = {}) {
  const { onBeforeStart = () => {}, onResult = null } = options

  // 注册全局「录音 → ASR → 本页提问」闭环，并在本页显示时把结果回调指向本页
  registerVoicePipeline()
  setVoiceResultTarget(onResult)
  onShow(() => setVoiceResultTarget(onResult))

  function toggleCall() {
    // 用 isCalling()（store 或底层任一为真）判断：启动在途时再次点击 = 取消
    if (isCalling()) {
      hangupCall()
      return
    }
    onBeforeStart()
    // 通话状态完全由底层 emitState（listening/speaking/idle）驱动：
    // 录音真正启动成功后才会亮起，失败时底层复位为 idle，这里不再无条件置 true
    CET.startCallMode()
  }

  function interruptCall() {
    CET.interruptSpeaking()
  }

  // 路由级切页才自动挂断；页内左右滑不触发这两个钩子
  onHide(hangupCall)
  onUnload(hangupCall)

  return { toggleCall, hangupCall, interruptCall }
}
