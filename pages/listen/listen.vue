<template>
  <AppShell page-id="listenPage" :page-class="{ 'read-calling': callMode, 'read-actions-visible': sideVisible, 'quiz-view-questions': viewQuestions, 'quiz-view-chat': viewChat }"
            @touchstart="onTouchStart" @touchend="onTouchEnd">
    <PracticeBox>
      <!-- 音频播放器：<audio> 组件在 Vue3 下已废弃（timeupdate 不回调），
           改由 AudioBar 里的 uni.createInnerAudioContext 播放，控制条自己画 -->
      <AudioBar ref="audioRef" :src="audioSrc" :file-name="audioName" float-on-play
                @time="applyProgress" @ready="onAudioReady" @float-height="onFloatHeight">
        <template #empty>
          <view class="hint-text">当前音频未导入</view>
        </template>
      </AudioBar>

      <view class="quiz-layout" id="quizLayout" :style="floatPadStyle">
        <view class="quiz-passage">
          <view v-if="!srcHidden" class="quiz-passage-text" id="listenPassageText">
            <view class="quiz-para" :class="{ 'quiz-para-dialogue': isDialogue }">
              <text v-for="(sent, i) in sentenceSpans" :key="i" :id="`listenSent${i}`"
                    class="listen-sent" :class="{ 'listen-sent-active': i >= activeFrom && i <= activeTo }">{{ sent }}</text>
            </view>
          </view>
        </view>

        <!-- 题目 -->
        <view class="quiz-questions" id="listenQuestions">
          <view v-for="q in questions" :key="q.no" :id="`listenQ${q.no}`"
                class="quiz-q" :class="{ 'listen-q-active': q.no === activeQuestion }">
            <view class="quiz-q-stem">{{ q.no }}. {{ q.stem }}</view>
            <view class="quiz-opts">
              <button v-for="key in optionKeys(q)" :key="key" class="quiz-opt">
                <text class="quiz-opt-key">{{ key }}</text>
                <text class="quiz-opt-text">{{ q.options[key] || '' }}</text>
              </button>
            </view>
          </view>
        </view>
      </view>

      <!-- 聊天屏：从本页点「发消息」直接打开，不跳页；左右滑切换原文 / 题目 -->
      <view v-if="viewChat" id="quizChatSlot" class="ask-slot quiz-chat-slot" :style="floatPadStyle">
        <view class="ask-block">
          <view class="ask-input-row">
            <textarea placeholder="就这篇听力原文 / 题目向 AI 提问" v-model="askInput"></textarea>
            <ActionBar>
              <button class="jump-btn" @click="askQuestion">提问</button>
            </ActionBar>
          </view>
          <scroll-view scroll-y class="ask-chat-list">
            <view v-for="(m, i) in visibleChatMessages" :key="i"
                  class="ask-msg" :class="m.role === 'user' ? 'ask-msg-user' : 'ask-msg-ai'">{{ m.content }}</view>
            <view v-if="chatLoading" class="ask-msg ask-msg-ai">AI思考中，请稍候…</view>
          </scroll-view>
        </view>
      </view>
    </PracticeBox>

    <VoiceSideNav variant="listen" :side-hidden="!sideVisible"
                  @call="toggleCall" @interrupt="interruptCall" @hangup="hangupCall" @sms="openChat" />

    <AppFooter />

    <!-- 选中文字后的「复制 / 查词」菜单 -->
    <template #overlay>
      <SelectLookup ref="lookupRef" />
    </template>
  </AppShell>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { onShow, onHide, onUnload } from '@dcloudio/uni-app'
import useStore, { claimChat } from '@/store/index'
import * as CET from '@/utils/cet'
import { audioUrl } from '@/utils/audio'
import { questionTimeline } from '@/utils/listenSubs'
import { buildSentenceSpans, loadListenCues, findCueIndex, scrollIntoViewSafe } from '@/utils/listenText'
import { callDeepSeekChat } from '@/utils/deepseek'
import { speakText } from '@/utils/voice'
import AppShell from '@/components/layout/AppShell.vue'
import PracticeBox from '@/components/layout/PracticeBox.vue'
import ActionBar from '@/components/layout/ActionBar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import VoiceSideNav from '@/components/VoiceSideNav.vue'
import AudioBar from '@/components/AudioBar.vue'
import SelectLookup from '@/components/SelectLookup.vue'
import { usePageInteractions, SWIPE_MIN } from '@/utils/interaction'
import { useCallSession } from '@/utils/callSession'

const state = useStore()
const lookupRef = ref(null)

const audioRef = ref(null)
const questions = ref([])
const sentenceSpans = ref([])
const activeFrom = ref(-1)
const activeTo = ref(-1)
const activeQuestion = ref(-1)
const srcHidden = ref(false)
const sideVisible = ref(false)
const viewQuestions = ref(false)   // true = 题目屏（quiz-view-questions），false = 原文屏
const viewChat = ref(false)        // true = 提问屏（quiz-view-chat），和原文 / 题目三屏切换
const askInput = ref('')
const chatLoading = computed(() => state.chatLoading)
const visibleChatMessages = computed(() => state.chatMessages.filter((m) => m.role !== 'system'))
const isDialogue = ref(false)
const audioSrc = ref('')
const audioName = ref('')
const subCues = ref([])          // 逐句对齐后的字幕 [{start,end,si0,si1}]
const qCues = ref([])            // 题目播报时间点 [{start,no}]
const fallbackStart = ref(-1)    // 原文念完的时间（之后进入题目播报段）
const audioDuration = ref(0)     // 音频总时长（题目时间点不足时按它均分兜底）
let lastSubIdx = -1              // 当前命中的字幕下标（非响应式，只用于去重）
function onAudioReady(d) { audioDuration.value = d }

onHide(() => { if (audioRef.value) audioRef.value.pause() })
onUnload(() => { if (audioRef.value) audioRef.value.destroy() })
// 从做题页聊天屏退回来时把底部高亮切回「精听」
onShow(() => { state.activeTab = 'listen' })

function optionKeys(q) { return CET.optionKeys(q.options) }

async function loadListen() {
  const r = CET.resolveExamResult()
  if (r.error) return
  const examData = r.examData
  if (!examData) return
  const selected = CET.selectedParts(examData, r.passageNo)
  if (!selected.length) return
  const part = selected[0]
  isDialogue.value = part.type === '长对话'
  sentenceSpans.value = buildSentenceSpans(part.transcript || '', isDialogue.value)
  questions.value = part.questions || []
  audioName.value = part.audio || ''

  // 换篇先把上一次的字幕 / 高亮状态清掉
  subCues.value = []
  qCues.value = []
  fallbackStart.value = -1
  lastSubIdx = -1
  activeFrom.value = -1
  activeTo.value = -1
  activeQuestion.value = -1

  // 加载音频：从 plus.io 音频库取 file:// 路径
  if (audioName.value) {
    const url = await audioUrl(audioName.value)
    audioSrc.value = url || ''
    // 字幕：优先用内置字幕（CET_SRT_BUILTIN，随题库一起打包），没有再用导入的同名 .srt
    const aligned = await loadListenCues(audioName.value, sentenceSpans.value)
    if (aligned) {
      subCues.value = aligned.cues
      qCues.value = aligned.qCues
      fallbackStart.value = aligned.fallbackStart
    }
  }
  state.activeTab = 'listen'
}

// 音频播放进度 → 逐句高亮（对应原版 onListenTimeUpdate）：
//   - 原文段：按时间二分找当前字幕，让它对应的原文句高亮并滚到视野中间
//   - 题目播报段（原文念完之后）：清掉句子高亮，题目卡跟着播报高亮
function applyProgress(t) {
  const n = questions.value.length
  // 1) 题目播报段：原文念完了，清句高亮、切到题目屏，题目卡跟着念到的那题高亮
  if (n && fallbackStart.value >= 0 && t >= fallbackStart.value) {
    if (activeFrom.value !== -1 || activeTo.value !== -1) {
      clearSentenceHighlight()
      lastSubIdx = -1
    }
    const times = questionTimeline(qCues.value, fallbackStart.value, n, audioDuration.value,
      questions.value.map((x) => x.no))
    let qi = -1
    for (let i = 0; i < times.length; i++) {
      if (times[i] >= 0 && times[i] <= t) qi = i
      else break
    }
    if (qi >= 0) {
      // times 已按题号归位成与题目一一对应，直接取第 qi 题；字幕漏识别某题也不会跳题
      const q = questions.value[qi]
      if (q && q.no !== activeQuestion.value) {
        activeQuestion.value = q.no
        // 提问屏打开时不抢屏，只更新题目高亮
        if (!viewQuestions.value && !viewChat.value) viewQuestions.value = true
        nextTick(() => scrollToQuestion(q.no))
      }
    }
    return
  }

  // 2) 原文段：清题目高亮，回原文屏，恢复逐句高亮 + 自动滚动
  if (activeQuestion.value !== -1) {
    activeQuestion.value = -1
    if (viewQuestions.value && !viewChat.value) viewQuestions.value = false
  }
  const cues = subCues.value
  if (!cues.length) return
  const idx = findCueIndex(cues, t)
  if (idx === lastSubIdx) return
  lastSubIdx = idx
  if (idx < 0) { clearSentenceHighlight(); return }
  const cue = cues[idx]
  activeFrom.value = cue.si0
  activeTo.value = cue.si1
  scrollToSentence(cue.si1)
}

function clearSentenceHighlight() {
  if (activeFrom.value !== -1 || activeTo.value !== -1) {
    activeFrom.value = -1
    activeTo.value = -1
  }
}

// 悬浮播放条挡住的高度：优先用组件实测高度（含状态栏让位），拿不到时按状态栏 + 110 估算
const floatHeight = ref(0)
function onFloatHeight(h) {
  floatHeight.value = h || 0
}

// 悬浮时给正文留出顶部空间，避免第一题被固定条压住
const floatPadStyle = computed(() => {
  if (!floatHeight.value) return {}
  return { paddingTop: (floatHeight.value + 8) + 'px' }
})

function floatInset() {
  if (!audioRef.value || !audioRef.value.floating) return 0
  if (floatHeight.value > 0) return floatHeight.value + 8
  const sb = (uni.getSystemInfoSync().statusBarHeight || 0)
  return sb + 110
}

function scrollToSentence(idx) {
  if (srcHidden.value || idx < 0) return
  scrollIntoViewSafe(`listenSent${idx}`, floatInset())
}

function scrollToQuestion(no) {
  scrollIntoViewSafe(`listenQ${no}`, floatInset())
}

function goImportAudio() {
  uni.reLaunch({ url: '/pages/settings/settings' })
}

// 通话中语音识别到一句话：不切屏，直接走 askQuestion（问答写入聊天记录并朗读；
// 想看记录由用户自己点侧栏的短信按钮进提问屏）
function handleVoiceResult(text) {
  const q = String(text || '').trim()
  if (!q) { CET.tip('没有听清，请再说一次'); return }
  if (state.chatLoading) { CET.resumeVoiceListening(); return }
  askInput.value = q
  state.voiceAskMode = true
  askQuestion()
}

const { toggleCall, interruptCall, hangupCall } = useCallSession({ onResult: handleVoiceResult })

// 提问屏的上下文：当前听力原文 + 题目
function buildChatContext() {
  const passage = sentenceSpans.value.join('')
  const qs = questions.value.map((q) => `${q.no}. ${q.stem}`).join('\n')
  return `【听力原文】\n${passage}\n\n【题目】\n${qs}`
}

function buildChatSystemPrompt() {
  return CET.teacherIntro() + '\n学生正在精听下面这篇听力，下面是原文和题目：\n' + buildChatContext() +
    '\n\n请围绕原文和题目用中文简洁回答学生的问题，控制在150字以内。'
}

// 发消息：在本页打开提问屏（不跳页，底部标签仍是精听）
function openChat() {
  if (!sentenceSpans.value.length) { CET.tip('听力内容还没加载好'); return }
  state.askContext = { quizPage: true, scopeFull: true, wrongOnly: false, text: buildChatContext() }
  claimChat('listen')
  // 已有对话（含通话中语音刚聊的）直接保留进提问屏，不抹记录；空白会话才重置输入
  if (state.chatMessages.length === 0) {
    state.chatGeneration++
    askInput.value = ''
  }
  viewChat.value = true
  viewQuestions.value = false
}

async function askQuestion() {
  const q = askInput.value.trim()
  if (!q) { CET.tip('请先输入你的问题'); return }
  if (state.chatLoading) { CET.tip('AI正在回答，请稍候'); return }
  claimChat('listen')
  if (state.chatMessages.length === 0) {
    state.chatMessages.push({ role: 'system', content: buildChatSystemPrompt() })
  }
  state.chatMessages.push({ role: 'user', content: q })
  askInput.value = ''
  const gen = state.chatGeneration
  state.chatLoading = true
  try {
    const answer = await callDeepSeekChat(state.chatMessages, 900)
    if (gen !== state.chatGeneration) return
    const reply = CET.stripMarkdownBold(answer)
    state.chatMessages.push({ role: 'assistant', content: reply })
    // 语音提问时，AI 的回复直接读出来；TTS onDone 会自动续听
    if (state.voiceAskMode) {
      state.voiceAskMode = false
      speakText(reply)
    }
  } catch (err) {
    if (gen !== state.chatGeneration) return
    state.voiceAskMode = false
    state.chatMessages.pop()
    askInput.value = q
    if (err.message !== '缺少Token') CET.tip(`提问失败：${err.message}`)
    if (state.callMode) CET.resumeVoiceListening()
  }
  state.chatLoading = false
}

// 三屏切换（原文 / 题目 / 提问）：手指左右滑、鼠标右键拖拽、外接键盘方向键共用同一入口。
// 与阅读做题交卷后的短信提问页完全一致：
//   · 提问页：右滑（dir>0）→ 原文；左滑（dir<0）→ 题目
//   · 非提问页：右滑 → 原文，左滑 → 题目；提问页只能点短信按钮进入，不靠滑动进入
function navigate(dir) {
  if (viewChat.value) {
    if (dir > 0) { viewChat.value = false; viewQuestions.value = false }   // 右滑 → 原文
    else { viewChat.value = false; viewQuestions.value = true }            // 左滑 → 题目
    return
  }
  if (dir < 0) viewQuestions.value = true                                   // 左滑 → 题目
  else viewQuestions.value = false                                          // 右滑 → 原文
}

const callMode = computed(() => state.callMode)

let touchStart = null
function onTouchStart(e) {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() }
}
function onTouchEnd(e) {
  if (!touchStart) return
  const start = touchStart
  touchStart = null
  const dx = e.changedTouches[0].clientX - start.x
  const dy = e.changedTouches[0].clientY - start.y
  if (Date.now() - start.at > 400) return
  if (isSelecting()) return
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return
  navigate(dx < 0 ? -1 : 1)
}

// 鼠标右键拖拽、外接键盘：切换原文屏 / 题目屏 / 提问屏
const { isSelecting } = usePageInteractions({
  onNavigate: navigate,
  onSelect: (text, x, y) => lookupRef.value && lookupRef.value.show(text, x, y),
  onSelectionLost: () => lookupRef.value && lookupRef.value.hideFromSelection(),
  // 原版：点页面右边缘展开 / 收起电话圆钮，点内容区收起
  onEdgeClick: (isEdge) => { sideVisible.value = isEdge ? !sideVisible.value : false }
})

loadListen()
</script>
