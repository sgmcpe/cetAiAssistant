<template>
  <AppShell page-id="readPage" :page-class="{ 'read-calling': callMode, 'read-actions-visible': sideVisible }"
            @touchstart="onTouchStart" @touchend="onTouchEnd">
    <PracticeBox>
      <view class="title-row">
        <text class="translate-title" id="passageHint" @click="jumpInputVisible = true">{{ hint }}</text>
        <input v-if="jumpInputVisible" type="number" class="passage-jump-input"
               :placeholder="'第几句'" :min="1" :max="sentences.length"
               v-model="jumpValue" @blur="finishJump" @confirm="finishJump" />
      </view>

      <view class="sentence-box" lang="en">{{ currentSentence }}</view>

      <!-- 不加 auto-height：原版是固定 96px 高、框内滚动的 textarea，
           auto-height 会让内容超过 max-height 后被裁掉且无法滚动 -->
      <textarea class="read-ask-input" placeholder="就当前句子提问，如：这个句子怎么理解"
                v-model="askInput"></textarea>

      <ActionBar variant="translate">
        <button class="jump-btn" @click="translateAndSummarize">翻译和短语</button>
        <button class="jump-btn" @click="askQuestion">提问</button>
      </ActionBar>

      <!-- 聊天记录（system 背景提示词不显示，与原版 renderChat 一致） -->
      <view v-if="visibleChatMessages.length || chatLoading" class="read-chat-panel" :class="{ 'is-collapsed': chatCollapsed }">
        <button class="read-chat-toggle" @click="chatCollapsed = !chatCollapsed">
          <text>聊天记录</text>
          <text class="read-chat-caret">{{ chatCollapsed ? '▸' : '▾' }}</text>
        </button>
        <scroll-view scroll-y class="ask-chat-list read-chat-list">
          <view v-for="(m, i) in visibleChatMessages" :key="i"
                class="ask-msg" :class="m.role === 'user' ? 'ask-msg-user' : 'ask-msg-ai'">{{ m.content }}</view>
          <view v-if="chatLoading" class="ask-msg ask-msg-ai">AI思考中，请稍候…</view>
        </scroll-view>
      </view>

      <!-- 翻译结果 -->
      <view v-if="showTranslate" class="ai-result-panel" :class="{ 'is-collapsed': translateCollapsed }">
        <button class="ai-result-toggle" @click="translateCollapsed = !translateCollapsed">
          <text>翻译</text>
          <text class="ai-result-caret">{{ translateCollapsed ? '▸' : '▾' }}</text>
        </button>
        <view class="word-result">{{ translateResult }}</view>
      </view>

      <!-- 短语结果 -->
      <view v-if="showPhrase" class="ai-result-panel" :class="{ 'is-collapsed': phraseCollapsed }">
        <button class="ai-result-toggle" @click="phraseCollapsed = !phraseCollapsed">
          <text>短语</text>
          <text class="ai-result-caret">{{ phraseCollapsed ? '▸' : '▾' }}</text>
        </button>
        <view class="word-result">{{ phraseResult }}</view>
      </view>
    </PracticeBox>

    <VoiceSideNav variant="read" :side-hidden="!sideVisible"
                  @toggle-side="sideVisible = !sideVisible"
                  @call="toggleCall" @interrupt="interruptCall" @hangup="hangupCall" />

    <AppFooter />

    <!-- 长按选词：复制 / 查词 -->
    <template #overlay>
      <SelectLookup ref="lookupRef" />
    </template>
  </AppShell>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import useStore, { claimChat } from '@/store/index'
import * as CET from '@/utils/cet'
import { callDeepSeek, callDeepSeekChat } from '@/utils/deepseek'
import { speakText } from '@/utils/voice'
import AppShell from '@/components/layout/AppShell.vue'
import PracticeBox from '@/components/layout/PracticeBox.vue'
import ActionBar from '@/components/layout/ActionBar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import VoiceSideNav from '@/components/VoiceSideNav.vue'
import SelectLookup from '@/components/SelectLookup.vue'
import { usePageInteractions, SWIPE_MIN } from '@/utils/interaction'
import { useCallSession } from '@/utils/callSession'

const state = useStore()
const lookupRef = ref(null)

const sentences = computed(() => state.sentences)
const currentIndex = computed(() => state.currentIndex)
const currentSentence = computed(() => state.sentences[state.currentIndex] ? state.sentences[state.currentIndex].text : '加载中…')
const hint = computed(() => {
  const item = state.sentences[state.currentIndex]
  return item ? `第${item.no}/${state.sentences.length}句` : '第1/1句'
})
const callMode = computed(() => state.callMode)
const chatLoading = computed(() => state.chatLoading)
// 界面上只显示 user / assistant，system 背景提示词不上屏（对齐原版 renderChat）
const visibleChatMessages = computed(() => state.chatMessages.filter((m) => m.role !== 'system'))

const jumpInputVisible = ref(false)
const jumpValue = ref('')
const askInput = ref('')
const chatCollapsed = ref(false)

const showTranslate = ref(false)
const translateCollapsed = ref(false)
const translateResult = ref('')
const showPhrase = ref(false)
const phraseCollapsed = ref(false)
const phraseResult = ref('')
const sideVisible = ref(false)

function startReading() {
  if (state.sentences.length && state.readSelKey === CET.selectionKey()) return
  const resolved = CET.resolveExam()
  if (!resolved) return
  CET.loadExamIntoState(resolved)
  state.readSelKey = CET.selectionKey()
  state.activeTab = 'read'
  showTranslate.value = false
  showPhrase.value = false
}

function goToSentence(index) {
  if (index < 0 || index >= state.sentences.length) {
    CET.tip(index < 0 ? '已经是第一句了' : '已经是最后一句了')
    return
  }
  state.currentIndex = index
  state.askContext = null
  state.chatMessages = []
  state.chatGeneration++
  CET.savePosition()
  showTranslate.value = false
  showPhrase.value = false
}

function finishJump() {
  jumpInputVisible.value = false
  const n = parseInt(jumpValue.value, 10)
  if (isNaN(n) || n < 1 || n > state.sentences.length) {
    if (jumpValue.value.trim()) CET.tip(`请输入 1 到 ${state.sentences.length} 之间的句号`)
    return
  }
  goToSentence(n - 1)
}

async function translateAndSummarize() {
  if (!state.sentences.length) { CET.tip('请先进入精读页并选择一套题库'); return }
  showPhrase.value = true
  showTranslate.value = true
  await Promise.all([summarizePhrases(), translateSentence()])
}

async function translateSentence() {
  const sentence = currentSentence.value
  showTranslate.value = true
  if (state.translateCache[state.currentIndex]) {
    translateResult.value = state.translateCache[state.currentIndex]
    return
  }
  const prompt = CET.readingIntro() + '\n\n【当前句子】\n' + sentence + '\n\n' +
    '【要求】只输出这句的中文译文，不要英文原文：\n1. 直接给整句通顺自然的中文翻译\n2. 不要输出英文原句\n3. 不要加「译文：」前缀'
  translateResult.value = '翻译中，请稍候…'
  try {
    const answer = await callDeepSeek(prompt, 600)
    const cleaned = CET.dropEnglishHeadline(CET.compactLines(CET.stripMarkdownBold(answer)))
    state.translateCache[state.currentIndex] = cleaned
    translateResult.value = cleaned
  } catch (err) {
    if (err.message !== '缺少Token') translateResult.value = `翻译失败：${err.message}`
  }
}

async function summarizePhrases() {
  const sentence = currentSentence.value
  const key = [state.currentLevel, state.currentExam && state.currentExam.year, state.currentExam && state.currentExam.month,
    state.currentExam && state.currentExam.set, state.currentExam && state.currentExam.passage,
    state.sentences.length, state.currentIndex].join('|')
  showPhrase.value = true
  if (state.phraseCache[key]) {
    phraseResult.value = state.phraseCache[key]
    return
  }
  const prompt = CET.readingIntro() + '\n\n【当前句子】\n' + sentence + '\n\n' +
    '【要求】只从这个句子里挑出值得记住的固定搭配、短语、习语和常用词组，每条按两行输出：第一行只写英文短语和中文冒号，第二行只写中文意思。最多10条，重复的只留一次。没有就输出一行：这个句子里没有明显的固定搭配或词组。'
  phraseResult.value = '正在总结短语，请稍候…'
  try {
    const answer = await callDeepSeek(prompt, 600)
    const cleaned = CET.compactLines(CET.stripMarkdownBold(answer))
    phraseResult.value = cleaned || '这个句子里没有找到明显的固定搭配或词组。'
    state.phraseCache[key] = phraseResult.value
  } catch (err) {
    if (err.message === '缺少Token') { showPhrase.value = false; phraseResult.value = '' }
    else phraseResult.value = `总结失败：${err.message}`
  }
}

function currentContextText() {
  if (state.askContext) return state.askContext.text || state.askContext
  if (!state.sentences.length) return ''
  const item = state.sentences[state.currentIndex]
  if (CET.isLongReading()) return `【文章${item.passage}】\n${item.text}`
  return item.text
}

async function askQuestion() {
  const q = askInput.value.trim()
  if (!q) { CET.tip('请先输入你的问题'); return }
  if (state.chatLoading) { CET.tip('AI正在回答，请稍候'); return }
  claimChat('read')
  if (state.chatMessages.length === 0) {
    state.chatMessages.push({ role: 'system', content: buildSystemPrompt() })
  }
  state.chatMessages.push({ role: 'user', content: q })
  askInput.value = ''
  chatCollapsed.value = false
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
    // 通话中提问失败也要续听，避免一直卡在暂停状态
    if (state.callMode) CET.resumeVoiceListening()
  }
  state.chatLoading = false
}

function buildSystemPrompt() {
  return CET.teacherIntro() + '\n学生正在精读下面这个真题句子：\n' + currentContextText() +
    '\n\n请围绕这个句子回答学生的问题，用中文简洁讲解，控制在150字以内。'
}

// 通话中语音识别到一句话：填进输入框 → 提问（回复会朗读，TTS 结束自动续听）
function handleVoiceResult(text) {
  const q = String(text || '').trim()
  if (!q) { CET.tip('没有听清，请再说一次'); return }
  askInput.value = q
  state.voiceAskMode = true
  askQuestion()
}

// 电话 → 打断 / 挂断；只在页面级切页（onHide / onUnload）自动挂断，
// 左右滑切句由 goToSentence 处理，不碰通话状态
const { toggleCall, interruptCall, hangupCall } = useCallSession({ onResult: handleVoiceResult })

function onTouchStart(e) {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() }
}
let touchStart = null
function onTouchEnd(e) {
  if (!touchStart) return
  const start = touchStart
  touchStart = null
  const dx = e.changedTouches[0].clientX - start.x
  const dy = e.changedTouches[0].clientY - start.y
  // 长按选词 / 拖选字手柄：手指停留久了或有选区时，位移不算翻句
  if (Date.now() - start.at > 400) return
  if (isSelecting()) return
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return
  // 通话中保持右侧「打断 / 挂断」可见，左右滑不挂断也不收起
  if (!state.callMode) sideVisible.value = false
  goToSentence(state.currentIndex + (dx < 0 ? 1 : -1))
}

// 鼠标右键拖拽、外接键盘、选区稳定后的前端「复制 / 查词」菜单
const { isSelecting } = usePageInteractions({
  onNavigate: (dir) => {
    if (!state.callMode) sideVisible.value = false
    goToSentence(state.currentIndex + (dir < 0 ? 1 : -1))
  },
  onSelect: (text, x, y) => lookupRef.value && lookupRef.value.show(text, x, y),
  onSelectionLost: () => lookupRef.value && lookupRef.value.hideFromSelection(),
  // 原版：点页面右边缘展开 / 收起电话圆钮，点内容区收起
  onEdgeClick: (isEdge) => { sideVisible.value = isEdge ? !sideVisible.value : false }
})

startReading()
// 从做题页聊天屏退回来时把底部高亮切回「精读」
onShow(() => { state.activeTab = 'read' })
</script>
