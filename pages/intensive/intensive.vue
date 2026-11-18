<template>
  <AppShell page-id="intensivePage" :page-class="{
              'read-calling': callMode,
              'read-actions-visible': sideVisible,
              'intensive-view-chat': chatVisible
            }"
            @touchstart="onTouchStart" @touchend="onTouchEnd">
    <PracticeBox v-if="!chatVisible">
      <view class="title-row">
        <text class="translate-title" @click="jumpVisible = true">{{ hint }}</text>
        <input v-if="jumpVisible" type="number" class="passage-jump-input" :max="sentences.length"
               v-model="jumpValue" @blur="finishJump" @confirm="finishJump" />
      </view>

      <view class="sentence-box">{{ currentSentence }}</view>

      <!-- 不加 auto-height：原版是固定 260px 高、框内滚动的输入框 -->
      <textarea class="read-ask-input" placeholder="把这一句翻译成英文写在这里，提交后 AI 会批改语法。"
                v-model="draft"></textarea>
      <ActionBar variant="translate">
        <button class="jump-btn" @click="submitIntensive">提交</button>
      </ActionBar>

      <!-- 批改结果 -->
      <view v-if="showResult" class="ai-result-panel" :class="{ 'is-collapsed': resultCollapsed }">
        <button class="ai-result-toggle" @click="resultCollapsed = !resultCollapsed">
          <text>批改意见</text>
          <text class="ai-result-caret">{{ resultCollapsed ? '▸' : '▾' }}</text>
        </button>
        <view class="word-result">{{ result }}</view>
      </view>
    </PracticeBox>

    <view v-else id="intensiveChatSlot" class="ask-slot intensive-chat-slot">
      <view class="ask-block">
        <view class="ask-input-row">
          <textarea placeholder="就这句翻译向 AI 提问，比如：这里怎么译成英文" v-model="askInput"></textarea>
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

    <VoiceSideNav variant="intensive" :side-hidden="!sideVisible"
                  @toggle-side="sideVisible = !sideVisible"
                  @call="toggleCall" @interrupt="interruptCall" @hangup="hangupCall" @sms="openChat" />

    <AppFooter />

    <!-- 选中文字后的「复制 / 查词」菜单 -->
    <template #overlay>
      <SelectLookup ref="lookupRef" />
    </template>
  </AppShell>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onShow } from '@dcloudio/uni-app'
import useStore, { STORAGE_KEYS, claimChat } from '@/store/index'
import * as CET from '@/utils/cet'
import { callDeepSeek, callDeepSeekChat } from '@/utils/deepseek'
import { storageGet, storageSet } from '@/utils/storage'
import AppShell from '@/components/layout/AppShell.vue'
import PracticeBox from '@/components/layout/PracticeBox.vue'
import ActionBar from '@/components/layout/ActionBar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import VoiceSideNav from '@/components/VoiceSideNav.vue'
import SelectLookup from '@/components/SelectLookup.vue'
import { usePageInteractions, SWIPE_MIN } from '@/utils/interaction'
import { useCallSession } from '@/utils/callSession'
import { speakText } from '@/utils/voice'

const state = useStore()
const lookupRef = ref(null)

const sentences = ref([])
const index = ref(0)
const draft = ref('')
const drafts = ref({})
const results = ref({})
const result = ref('')
const showResult = ref(false)
const resultCollapsed = ref(false)
const jumpVisible = ref(false)
const jumpValue = ref('')
const sideVisible = ref(false)
const chatVisible = ref(false)
const askInput = ref('')

const callMode = computed(() => state.callMode)
const chatLoading = computed(() => state.chatLoading)
const visibleChatMessages = computed(() => state.chatMessages.filter((m) => m.role !== 'system'))
const currentSentence = computed(() => sentences.value[index.value] || '')
const hint = computed(() => `第${index.value + 1}/${sentences.value.length}句`)

function loadIntensive() {
  const data = CET.translationData(state.currentLevel)
  const r = CET.resolveExamResult()
  if (r.error || !data) return
  const examData = data[r.exam.year] && data[r.exam.year][r.exam.month] && data[r.exam.year][r.exam.month][r.exam.set]
  if (!examData) return
  // 翻译题库：优先用数据里已经切好的 sentences 逐句数组，避免把整篇当成一句；
  // 只有整篇 text / translation 时才按中文标点切分
  if (examData.passages) {
    sentences.value = examData.passages.flatMap((p) => p.sentences || [])
  } else if (Array.isArray(examData.sentences) && examData.sentences.length) {
    sentences.value = examData.sentences.slice()
  } else {
    const text = examData.text || examData.translation || (typeof examData === 'string' ? examData : '')
    const parts = text ? String(text).match(/[^。！？]+[。！？]?/g) : []
    sentences.value = (parts || []).map((s) => s.trim()).filter(Boolean)
  }
  // 恢复草稿
  try {
    const saved = JSON.parse(storageGet(STORAGE_KEYS.INTENSIVE) || '{}')
    if (saved && saved[state.selYear + state.selMonth + state.selSet]) {
      drafts.value = saved[state.selYear + state.selMonth + state.selSet].drafts || {}
      results.value = saved[state.selYear + state.selMonth + state.selSet].results || {}
    }
  } catch (e) {}
  index.value = 0
  draft.value = drafts.value[index.value] || ''
  result.value = results.value[index.value] || ''
  showResult.value = !!result.value
  state.activeTab = 'intensive'
}

function finishJump() {
  jumpVisible.value = false
  const n = parseInt(jumpValue.value, 10)
  if (isNaN(n) || n < 1 || n > sentences.value.length) return
  gotoSentence(n - 1)
}

function gotoSentence(i) {
  if (i < 0 || i >= sentences.value.length) {
    CET.tip(i < 0 ? '已经是第一句了' : '已经是最后一句了')
    return
  }
  // 保存当前草稿
  drafts.value[index.value] = draft.value
  index.value = i
  draft.value = drafts.value[i] || ''
  result.value = results.value[i] || ''
  showResult.value = !!result.value
  saveDrafts()
}

function saveDrafts() {
  drafts.value[index.value] = draft.value
  const key = state.selYear + state.selMonth + state.selSet
  try {
    const all = JSON.parse(storageGet(STORAGE_KEYS.INTENSIVE) || '{}')
    all[key] = { drafts: drafts.value, results: results.value }
    storageSet(STORAGE_KEYS.INTENSIVE, JSON.stringify(all))
  } catch (e) {}
}

async function submitIntensive() {
  const src = currentSentence.value
  const my = draft.value.trim()
  if (!src || !my) { CET.tip('请先填写你的译文'); return }
  const prompt = '你是一位英语老师，正在批改学生翻译的英语句子。\n\n【中文原句】\n' + src + '\n\n【学生的英文译文】\n' + my +
    '\n\n【要求】分四部分：\n1. 语法错误\n2. 修改后的译文\n3. 参考译文\n4. 一句话点评'
  result.value = '批改中，请稍候…'
  showResult.value = true
  try {
    const answer = await callDeepSeek(prompt, 1200)
    result.value = CET.stripMarkdownBold(answer)
    results.value[index.value] = result.value
    saveDrafts()
  } catch (err) {
    if (err.message !== '缺少Token') result.value = `批改失败：${err.message}`
  }
}

function intensiveChatScope() {
  return `intensive|${state.currentLevel}|${state.selYear}${state.selMonth}${state.selSet}|${index.value}`
}

function buildChatContext() {
  const my = draft.value.trim() || '（未作答）'
  return `【精翻练习 · ${hint.value}】\n【中文原句】\n${currentSentence.value}\n【我的译文】\n${my}` +
    (result.value ? `\n【AI 批改】\n${result.value}` : '')
}

function buildChatSystemPrompt() {
  return CET.teacherIntro() +
    `\n学生正在做大学英语${CET.levelName()}${CET.examTypeName()}的精翻练习，下面是本句上下文：\n${buildChatContext()}\n\n` +
    '这是中译英练习：学生问“翻译”“怎么翻译”“参考译文”“翻成英文”时，必须先给出地道英文译文，不要只回答中文；' +
    '学生明确要求讲解语法、用词或原因时，再用中文简短说明。回答控制在250字以内。'
}

function openChat() {
  if (!currentSentence.value) { CET.tip('翻译内容还没加载好'); return }
  claimChat(intensiveChatScope())
  state.askContext = { quizPage: false, scopeFull: false, wrongOnly: false, text: buildChatContext() }
  if (state.chatMessages.length === 0) {
    state.chatGeneration++
    askInput.value = ''
  }
  chatVisible.value = true
  sideVisible.value = true
}

async function askQuestion() {
  const q = askInput.value.trim()
  if (!q) { CET.tip('请先输入你的问题'); return }
  if (state.chatLoading) { CET.tip('AI正在回答，请稍候'); return }
  claimChat(intensiveChatScope())
  const sys = buildChatSystemPrompt()
  if (state.chatMessages.length === 0) {
    state.chatMessages.push({ role: 'system', content: sys })
  } else if (state.chatMessages[0] && state.chatMessages[0].role === 'system') {
    state.chatMessages[0].content = sys
  } else {
    state.chatMessages.unshift({ role: 'system', content: sys })
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

function handleVoiceResult(text) {
  const q = String(text || '').trim()
  if (!q) { CET.tip('没有听清，请再说一次'); return }
  if (state.chatLoading) { CET.resumeVoiceListening(); return }
  askInput.value = q
  state.voiceAskMode = true
  askQuestion()
}

// 切页自动挂断由 useCallSession 统一处理；gotoSentence 左右滑切句不挂断
const { toggleCall, interruptCall, hangupCall } = useCallSession({ onResult: handleVoiceResult })

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

function navigate(dir) {
  if (chatVisible.value) {
    if (dir > 0) chatVisible.value = false
    return
  }
  gotoSentence(index.value + (dir < 0 ? 1 : -1))
}

// 鼠标右键拖拽、外接键盘、左右手指拖选后的查词菜单
const { isSelecting } = usePageInteractions({
  onNavigate: navigate,
  onSelect: (text, x, y) => lookupRef.value && lookupRef.value.show(text, x, y),
  onSelectionLost: () => lookupRef.value && lookupRef.value.hideFromSelection(),
  // 原版：点页面右边缘展开 / 收起电话圆钮，点内容区收起
  onEdgeClick: (isEdge) => { sideVisible.value = isEdge ? !sideVisible.value : false }
})

loadIntensive()
// 从做题页聊天屏退回来时把底部高亮切回「精翻」
onShow(() => { state.activeTab = 'intensive' })
</script>
