<template>
  <AppShell page-id="quizPage" :page-class="{
              'practice-mode': isExtra,
              'quiz-submitted': submitted || pSubmitted,
              'quiz-calling': callMode,
              'quiz-actions-visible': sideVisible,
              'quiz-view-questions': view === 'questions',
              'quiz-view-chat': view === 'chat'
            }"
            @touchstart="onTouchStart" @touchend="onTouchEnd">
    <!-- 文章屏 -->
    <view v-if="!isExtra && view === 'article'" class="quiz-layout">
      <view class="quiz-passage">
        <view class="quiz-passage-text">
          <view v-for="(para, i) in paragraphs" :key="i" class="quiz-para">{{ para }}</view>
        </view>
      </view>
    </view>

    <!-- 题目屏 -->
    <view v-if="!isExtra && view === 'questions'" class="quiz-questions">
      <view v-for="q in questions" :key="q.no" class="quiz-q" :class="resultClass(q.no)">
        <view class="quiz-q-stem">{{ q.no }}. {{ q.stem }}</view>
        <view class="quiz-opts" :class="{ 'quiz-opts-letters': isLetters }">
          <button v-for="key in optKeys(q)" :key="key" class="quiz-opt"
                  :class="{ selected: answers[q.no] === key, 'opt-correct': submitted && results[q.no] && results[q.no].answer === key, 'opt-wrong': submitted && answers[q.no] === key && results[q.no] && answers[q.no] !== results[q.no].answer }"
                  @click="chooseOption(q.no, key)">
            <text class="quiz-opt-key">{{ key }}</text>
            <text class="quiz-opt-text">{{ q.options[key] || '' }}</text>
          </button>
        </view>

        <!-- 判卷结果 -->
        <view v-if="submitted" class="quiz-q-result">
          <view class="quiz-judge" :class="isCorrect(q.no) ? 'ok' : 'no'">
            {{ isCorrect(q.no) ? '✔ 回答正确' : '✘ 回答错误' }}
          </view>
          <view v-if="results[q.no] && results[q.no].analysis" class="quiz-analysis cn-open">解析：{{ results[q.no].analysis }}</view>
        </view>
      </view>

      <!-- 底部按钮 -->
      <view class="quiz-btn-row">
        <button v-if="!submitted" class="quiz-submit-btn" @click="submitQuiz">提交答案</button>
        <button v-else class="quiz-submit-btn" disabled>已提交</button>
        <button v-if="submitted" class="quiz-submit-btn" @click="redoQuiz">重做</button>
      </view>
    </view>

    <!-- 专项练习做题页（听力 / 写作 / 翻译）：和阅读共用右侧按钮组与聊天屏 -->
    <view v-if="isExtra" id="practiceQuizBody" class="practice-quiz-body">
      <!-- 听力：音频条 + 只显示题号的题目卡 + 提交判分 -->
      <template v-if="isListening">
        <!-- 音频条与精听页同一套（AudioBar：播放键 + 时间 + 可拖动进度，长度撑满页面） -->
        <AudioBar ref="audioRef" :src="pAudioSrc" :file-name="pAudioName">
          <template #empty>
            <view class="hint-text">当前音频未导入</view>
          </template>
        </AudioBar>

        <!-- 每题一张独立卡片，和阅读页 .quiz-q 同款（左色条 + 卡片内选项），
             仅保留「听力只有题号 + 选项、没有题干」这一点不变 -->
        <view v-if="pMissing > 0" class="cet-readonly-note">{{ noOptionNote(pMissing) }}</view>
        <view v-for="q in pQuestions" :key="q.no" class="quiz-q" :class="practiceResultClass(q.no)">
          <view class="quiz-q-stem">{{ q.no }}</view>
          <view class="quiz-opts">
            <button v-for="k in pOptionKeys" :key="k" class="quiz-opt"
                    :class="{ selected: pAnswers[q.no] === k, 'opt-correct': pSubmitted && pCorrect[q.no] === k, 'opt-wrong': pSubmitted && pAnswers[q.no] === k && pCorrect[q.no] !== k }"
                    @click="choosePractice(q.no, k)">
              <text class="quiz-opt-key">{{ k }}</text>
              <text class="quiz-opt-text">{{ q.options[k] || '' }}</text>
            </button>
          </view>
          <view v-if="pSubmitted && pHasAnswers" class="quiz-q-result">
            <view class="quiz-judge" :class="practiceIsCorrect(q.no) ? 'ok' : 'no'">
              {{ practiceIsCorrect(q.no) ? '✓ 回答正确' : '✗ 回答错误（正确答案 ' + (pCorrect[q.no] || '-') + '）' }}
            </view>
            <view v-if="pListenGrading" class="quiz-analysis">解析生成中…</view>
            <view v-else-if="pAnalysis[q.no]" class="quiz-analysis cn-open">解析：{{ pAnalysis[q.no] }}</view>
          </view>
        </view>

        <view class="cet-actions">
          <button class="jump-btn" :disabled="pSubmitted" @click="submitPractice">{{ pSubmitted ? '已提交' : '提交' }}</button>
          <button class="cet-btn" @click="clearPractice">重做</button>
        </view>

      </template>

      <!-- 写作 / 翻译：原文（题目）+ 作答输入 + AI 批改 -->
      <template v-else>
        <view class="cet-card">
          <view class="cet-card-label">
            <button class="cet-btn essay-src-toggle" @click="pSrcHidden = !pSrcHidden">
              {{ pSrcHidden ? (isWriting ? '显示题目' : '显示原文') : (isWriting ? '隐藏题目' : '隐藏原文') }}
            </button>
            {{ isWriting ? '写作题目（Directions）' : '中文原文' }}
          </view>
          <view v-if="!pSrcHidden" class="cet-text-block">{{ pText }}</view>
        </view>

        <view class="cet-card">
          <view class="cet-card-label">{{ isWriting ? '你的作文' : '你的英文译文' }}</view>
          <textarea class="cet-answer-input" v-model="pDraft" :spellcheck="false"></textarea>
          <view class="cet-actions">
            <button class="jump-btn" :disabled="pGrading" @click="submitEssay">{{ pGrading ? '批改中…' : '提交' }}</button>
          </view>
        </view>

        <view id="essayResult">
          <view v-if="pFeedback" class="cet-result">
            <view class="cet-result-head">AI 批改意见</view>
            <text>{{ pFeedback }}</text>
          </view>
        </view>
      </template>
    </view>

    <!-- 聊天屏 -->
    <view v-if="view === 'chat'" id="quizChatSlot" class="ask-slot quiz-chat-slot">
      <view class="ask-block">
        <view class="ask-input-row">
          <!-- 不加 auto-height：原版是固定 110px 高、框内滚动的输入框 -->
          <textarea placeholder="就这套题提问，比如：第2题为什么选 C" v-model="askInput"></textarea>
          <ActionBar>
            <button class="jump-btn" @click="askQuestion">提问</button>
          </ActionBar>
        </view>
        <scroll-view scroll-y class="ask-chat-list">
          <view v-for="(m, i) in visibleChatMessages" :key="i" class="ask-msg" :class="m.role === 'user' ? 'ask-msg-user' : 'ask-msg-ai'">{{ m.content }}</view>
          <view v-if="chatLoading" class="ask-msg ask-msg-ai">AI思考中，请稍候…</view>
        </scroll-view>
      </view>
    </view>

    <VoiceSideNav variant="quiz" :side-hidden="sideHiddenNav"
                  @toggle-side="toggleSide"
                  @go-article="view = 'article'" @go-questions="view = 'questions'"
                  @call="toggleCall" @interrupt="interruptCall" @hangup="hangupCall"
                  @sms="openChat" />

    <AppFooter />

    <template #overlay>
      <SelectLookup ref="lookupRef" />
    </template>
  </AppShell>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onLoad, onHide, onUnload } from '@dcloudio/uni-app'
import useStore, { STORAGE_KEYS, claimChat, resetChat } from '@/store/index'
import * as CET from '@/utils/cet'
import { callDeepSeek, callDeepSeekChat } from '@/utils/deepseek'
import { speakText } from '@/utils/voice'
import { storageGet, storageSet } from '@/utils/storage'
import { audioUrl } from '@/utils/audio'
import AppShell from '@/components/layout/AppShell.vue'
import ActionBar from '@/components/layout/ActionBar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import VoiceSideNav from '@/components/VoiceSideNav.vue'
import SelectLookup from '@/components/SelectLookup.vue'
import AudioBar from '@/components/AudioBar.vue'
import { usePageInteractions, SWIPE_MIN } from '@/utils/interaction'
import { useCallSession } from '@/utils/callSession'

const state = useStore()
const lookupRef = ref(null)

const view = ref('article')
const chatOnLoad = ref(false)   // 从精听页 ?chat=1 进来，等异步加载完再定位聊天屏
const sideVisible = ref(false)
const askInput = ref('')
const paragraphs = ref([])
const questions = ref([])
const answers = ref({})
const results = ref({})
const submitted = ref(false)
const article = ref('')
const grading = ref(false)

const callMode = computed(() => state.callMode)
const chatLoading = computed(() => state.chatLoading)
// 界面上只显示 user / assistant，system 背景提示词不上屏（对齐原版 renderChat）
const visibleChatMessages = computed(() => state.chatMessages.filter((m) => m.role !== 'system'))
const isLetters = computed(() => questions.value.length > 0 && CET.isLetterOptions(questions.value[0].options))

/* ==================== 专项练习（听力 / 写作 / 翻译）做题页 ==================== */
const isExtra = computed(() => state.mode !== 'reading')
const isListening = computed(() => state.mode === 'listening')
const isWriting = computed(() => state.mode === 'writing')

// 聊天屏也允许点右边缘收起侧栏（和题目 / 文章屏一致）；
// 但通话进行中不收起，保证「打断 / 挂断」始终可点。
const sideHiddenNav = computed(() => {
  if (view.value === 'chat') return !sideVisible.value && !callMode.value
  return !sideVisible.value
})

// 做题页聊天会话按「模式 + 级别 + 套题 / 篇章」细分，
// 听力 / 写作 / 翻译 各自独立，切换套题也重开，避免记录串页共享。
function quizChatScope() {
  const ex = pExam.value || state.currentExam || {}
  return 'quiz|' + [state.mode, state.currentLevel, state.listenType || '',
    ex.year || '', ex.month || '', ex.set || '', state.selPassage || ''].join('|')
}

const pOptionKeys = ['A', 'B', 'C', 'D']
const pExam = ref(null)
const pExamData = ref(null)
const pQuestions = ref([])
const pAnswers = ref({})
const pCorrect = ref({})
const pSubmitted = ref(false)
const pHasAnswers = ref(false)
const pMissing = ref(0)
const pScore = ref('')
const audioRef = ref(null)
const pAudioSrc = ref('')
const pAudioName = ref('')
const pText = ref('')
const pDraft = ref('')
const pFeedback = ref('')
const pSrcHidden = ref(false)
const pGrading = ref(false)
const pAnalysis = ref({})
const pListenGrading = ref(false)

// 离开页面先把音频停掉，别在后台继续念
onHide(() => {
  if (audioRef.value) audioRef.value.pause()
})
onUnload(() => {
  if (audioRef.value) audioRef.value.destroy()
})

function optKeys(q) { return CET.optionKeys(q.options) }

function resultClass(no) {
  if (!submitted.value) return ''
  return isCorrect(no) ? 'q-right' : 'q-wrong'
}
function isCorrect(no) {
  return results.value[no] && answers.value[no] === results.value[no].answer
}

function startQuiz(fresh) {
  const resolved = CET.resolveExam()
  if (!resolved) return
  state.currentExamData = resolved.examData
  article.value = CET.passageTextOfSelected(resolved.examData, resolved.passageNo)
  paragraphs.value = article.value.split('\n\n')
  questions.value = collectQuestions(resolved)

  // 恢复作答
  const key = quizSessionKey(resolved.exam)
  if (!fresh) {
    try {
      const snap = JSON.parse(storageGet(STORAGE_KEYS.QUIZ) || 'null')
      if (snap && snap.key === key) {
        answers.value = snap.answers || {}
        results.value = snap.results || {}
        submitted.value = !!snap.submitted
      } else {
        answers.value = {}; results.value = {}; submitted.value = false
      }
    } catch (e) {
      answers.value = {}; results.value = {}; submitted.value = false
    }
  } else {
    answers.value = {}; results.value = {}; submitted.value = false
  }

  state.quizSelKey = CET.selectionKey()
  state.activeTab = 'quiz'
  view.value = 'article'
  state.askContext = buildQuizPageContext()
  if (!fresh) saveQuizSession(resolved.exam)
}

function collectQuestions(resolved) {
  const data = CET.questionData()
  if (!data || !state.currentExam) return []
  const sets = data[resolved.exam.year] && data[resolved.exam.year][resolved.exam.month] &&
    data[resolved.exam.year][resolved.exam.month][resolved.exam.set]
  if (!sets) return []
  const groups = sets.filter((group, idx) => !resolved.exam.passage || idx + 1 === resolved.exam.passage)
  const out = []
  groups.forEach((group) => {
    group.questions.forEach((q) => {
      out.push({ group: group.name, no: q.no, stem: q.stem, options: q.options, answer: q.answer || '' })
    })
  })
  return out
}

function quizSessionKey(exam) {
  return [state.currentLevel, state.currentExamType, exam.year, exam.month, exam.set, exam.passage || 0].join('|')
}

function saveQuizSession(exam) {
  if (!exam) return
  storageSet(STORAGE_KEYS.QUIZ, JSON.stringify({
    key: quizSessionKey(exam), level: state.currentLevel, type: state.currentExamType,
    year: exam.year, month: exam.month, set: exam.set, passage: exam.passage || 0,
    answers: answers.value, results: results.value, submitted: submitted.value, savedAt: Date.now()
  }))
}

function chooseOption(no, key) {
  if (submitted.value) return
  answers.value[no] = key
  if (state.currentExam) saveQuizSession(state.currentExam)
}

async function submitQuiz() {
  if (submitted.value || grading.value || questions.value.length === 0) return
  const unanswered = questions.value.filter((q) => !answers.value[q.no])
  if (unanswered.length > 0) { CET.tip(`还有 ${unanswered.length} 道题没有作答`); return }

  results.value = {}
  questions.value.forEach((q) => {
    results.value[q.no] = { answer: q.answer, analysis: '' }
  })
  submitted.value = true
  view.value = 'questions'
  sideVisible.value = true
  if (state.currentExam) saveQuizSession(state.currentExam)

  const token = storageGet(STORAGE_KEYS.TOKEN)
  if (!token) {
    saveWrongToMistakeBook()
    CET.tip('已判完对错；在「设置」页填 DeepSeek Token 可自动生成中文翻译和解析')
    return
  }

  grading.value = true
  try {
    const grade = await askAIForGrading()
    questions.value.forEach((q) => {
      const cn = grade.cn[q.no]
      if (cn) {
        if (cn.stem) results.value[q.no].stemCn = cn.stem
        if (cn.opts && Object.keys(cn.opts).length) results.value[q.no].optCn = cn.opts
      }
      if (grade.analysis[q.no]) results.value[q.no].analysis = grade.analysis[q.no]
    })
    if (state.currentExam) saveQuizSession(state.currentExam)
  } catch (err) {
    CET.tip(`中文翻译生成失败：${err.message}（不影响判对错）`)
  }
  grading.value = false
  saveWrongToMistakeBook()
}

async function askAIForGrading() {
  let lines = ''
  questions.value.forEach((q) => {
    const r = results.value[q.no] || {}
    lines += `${q.no}. ${q.stem}\n`
    if (!CET.isLetterOptions(q.options)) {
      CET.optionKeys(q.options).forEach((key) => {
        lines += `${key}) ${q.options[key] || ''}\n`
      })
    }
    lines += `正确答案：${r.answer || q.answer || '未知'}　学生答案：${answers.value[q.no] || '未作答'}\n\n`
  })
  const prompt = '你是一位专业的英语老师。下面是大学英语' + CET.levelName() + CET.examTypeName() +
    '的一篇阅读真题和本次的全部题目。\n\n【原文】\n' + article.value + '\n\n【全部题目】\n' + lines +
    '【任务】一、翻译：把每道题的题干、每个选项各翻成简洁中文。二、解析：每道题写一句中文解析。\n' +
    '【输出格式】严格按行输出：\n题干|题号|中文\n选项|题号|选项字母|中文\n解析|题号|中文'
  const answer = await callDeepSeek(prompt, 3000)
  return parseGradingOutput(answer)
}

function parseGradingOutput(text) {
  const out = { analysis: {}, cn: {} }
  String(text).split(/\r?\n/).forEach((line) => {
    const s = line.replace(/^[\s*•\-]+/, '').replace(/[*\s]+$/, '').trim()
    if (!s) return
    const p = s.split(/[|｜]/).map((x) => x.trim())
    const no = parseInt(p[1], 10)
    if (!no) return
    const tag = p[0] || ''
    if (tag.indexOf('题干') === 0) {
      if (!out.cn[no]) out.cn[no] = { opts: {} }
      out.cn[no].stem = p.slice(2).join('|')
    } else if (tag.indexOf('选项') === 0) {
      const key = (p[2] || '').toUpperCase()
      if (!/^[A-Z]{1,2}$/.test(key)) return
      if (!out.cn[no]) out.cn[no] = { opts: {} }
      out.cn[no].opts[key] = p.slice(3).join('|')
    } else if (tag.indexOf('解析') === 0) {
      out.analysis[no] = p.slice(2).join('|')
    }
  })
  return out
}

function saveWrongToMistakeBook() {
  const items = []
  questions.value.forEach((q) => {
    const result = results.value[q.no]
    if (!result || !result.answer) return
    if (answers.value[q.no] === result.answer) return
    items.push({
      level: state.currentLevel, type: state.currentExamType,
      exam: examLabel(), passage: q.group, no: q.no, stem: q.stem, options: q.options,
      my: answers.value[q.no] || '', answer: result.answer, analysis: result.analysis, time: Date.now()
    })
  })
  if (!items.length) return
  const added = CET.addMistakes(items)
  if (added > 0) CET.tip(`已把 ${added} 道错题加入错题本`)
}

function examLabel() {
  return `${state.currentExam.year}年${state.currentExam.month}月第${state.currentExam.set}套`
}

function redoQuiz() {
  startQuiz(true)
}

function buildQuizPageContext() {
  const full = CET.isAiScopeFull()
  const wrong = submitted.value ? questions.value.filter((q) => {
    const r = results.value[q.no]
    return r && r.answer && answers.value[q.no] !== r.answer
  }) : []
  const wrongOnly = !full && wrong.length > 0
  const items = wrongOnly ? wrong : questions.value
  let blocks = ''
  items.forEach((q) => {
    const r = results.value[q.no] || {}
    const answer = r.answer || q.answer || '未知'
    const mine = answers.value[q.no] ? `　学生选的：${answers.value[q.no]}` : ''
    blocks += `${q.no}. ${q.stem}\n${CET.optionsToText(q.options)}\n正确答案：${answer}${mine}\n\n`
  })
  const articleBlock = `【原文】\n${article.value}`
  const head = wrongOnly ? '【本次做错的题目】\n' : '【本次题目】\n'
  return {
    quizPage: true, scopeFull: full, wrongOnly,
    text: blocks ? `${articleBlock}\n\n${head}${blocks}` : articleBlock
  }
}

function buildSystemPrompt() {
  const ctx = state.askContext
  const scopeDesc = ctx.scopeFull ? '原文和本次的全部题目（含正确答案）' : (ctx.wrongOnly ? '本次做错的题目和相关原文段落' : '原文和本次的全部题目（本次没有错题）')
  const translationRule = state.mode === 'translation'
    ? '这是中译英翻译练习：学生问“翻译”“怎么翻译”“参考译文”“翻成英文”时，必须先给出地道英文译文，不要只回答中文；只有学生明确要求讲解语法、用词或原因时，才补充中文说明。\n'
    : ''
  return `${CET.teacherIntro()}\n学生正在做大学英语${CET.levelName()}${CET.examTypeName()}的练习，下面是${scopeDesc}：\n${ctx.text}\n\n${translationRule}` +
    '请围绕这些题目、选项、原文和批改意见回答学生的问题；默认用中文简洁讲解，控制在250字以内。'
}

async function askQuestion() {
  const q = askInput.value.trim()
  if (!q) { CET.tip('请先输入你的问题'); return }
  if (state.chatLoading) { CET.tip('AI正在回答，请稍候'); return }
  claimChat(quizChatScope())
  const sys = buildSystemPrompt()
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

function toggleSide() { sideVisible.value = !sideVisible.value }
function openChat() {
  if (isExtra.value && !pExam.value) { CET.tip('题目还没加载好'); return }
  if (!isExtra.value && !submitted.value) { CET.tip('提交后点这里，可以和 AI 讨论这套题'); return }
  state.askContext = isExtra.value ? buildPracticeContext() : buildQuizPageContext()
  claimChat(quizChatScope())
  sideVisible.value = true
  view.value = 'chat'
}
// 通话中语音识别到一句话：不切屏，直接填输入框提问（回复朗读，问答写入聊天记录；
// 想看记录由用户自己点侧栏的短信按钮进聊天屏）
function handleVoiceResult(text) {
  const q = String(text || '').trim()
  if (!q) { CET.tip('没有听清，请再说一次'); return }
  askInput.value = q
  state.voiceAskMode = true
  askQuestion()
}

// 通话开始时按当前屏准备 AI 上下文；切页自动挂断由 useCallSession 统一处理，
// navigate() 三屏左右滑只改 view，不会挂断
const { toggleCall, interruptCall, hangupCall } = useCallSession({
  onBeforeStart: () => {
    state.askContext = isExtra.value ? buildPracticeContext() : buildQuizPageContext()
    resetChat(quizChatScope())
  },
  onResult: handleVoiceResult
})

let touchStart = null
function onTouchStart(e) {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, at: Date.now() }
}

// 三屏左右滑的统一入口：手指、鼠标右键拖拽、外接键盘都走这里
// 和阅读做题页一致：左滑去文章、右滑回题目；
// 专项练习（听力 / 写作 / 翻译）没有文章屏，左右滑都只在题目 / 聊天两屏间切换，不跨页跳转
function navigate(dir) {
  if (view.value === 'chat') {
    // 从左往右滑 → 原文；专项练习没有原文屏，回题目
    if (dir > 0) { view.value = isExtra.value ? 'questions' : 'article'; return }
    // 从右往左滑 → 题目；专项练习左滑不做任何跳转
    if (!isExtra.value) view.value = 'questions'
    return
  }
  if (dir < 0) view.value = 'questions'
  else if (!isExtra.value) view.value = 'article'
}

function onTouchEnd(e) {
  if (!touchStart) return
  const start = touchStart
  touchStart = null
  const dx = e.changedTouches[0].clientX - start.x
  const dy = e.changedTouches[0].clientY - start.y
  // 长按选词 / 拖选字手柄：这次手指位移不算切屏
  if (Date.now() - start.at > 400) return
  if (isSelecting()) return
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return
  navigate(dx < 0 ? -1 : 1)
}

// 未交卷时不弹查词菜单（与原版一致），复制仍走系统
const { isSelecting } = usePageInteractions({
  onNavigate: navigate,
  canSelect: () => submitted.value || pSubmitted.value,
  onSelect: (text, x, y) => lookupRef.value && lookupRef.value.show(text, x, y),
  onSelectionLost: () => lookupRef.value && lookupRef.value.hideFromSelection(),
  // 原版：点页面右边缘展开 / 收起电话圆钮，点内容区收起
  onEdgeClick: (isEdge) => { sideVisible.value = isEdge ? !sideVisible.value : false }
})

/* ==================== 专项练习：载入 / 作答 / 判分 ==================== */
function noOptionNote(cnt) {
  return `本套有 ${cnt} 题没有选项文字：源题库未提供该题的选项内容，请听音频后按 A / B / C / D 字母作答，提交后仍会按答案判分。`
}
function hasOptionText(q) {
  const o = q.options || {}
  return pOptionKeys.some((k) => String(o[k] || '').trim())
}
function practiceKey(exam) {
  return [state.mode, state.currentLevel, state.listenType || '',
    exam.year, exam.month, exam.set, state.selPassage || ''].join('|')
}
function practiceSave() {
  if (!pExam.value) return
  storageSet(STORAGE_KEYS.PRACTICE_QUIZ, JSON.stringify({
    key: practiceKey(pExam.value), level: state.currentLevel, mode: state.mode,
    answers: pAnswers.value, submitted: pSubmitted.value,
    essay: pDraft.value, feedback: pFeedback.value, analysis: pAnalysis.value, savedAt: Date.now()
  }))
}

async function loadPractice(fresh) {
  const r = CET.resolveExamResult()
  if (r.error) return
  pExam.value = r.exam
  pExamData.value = r.examData
  pCorrect.value = r.examData.answers || {}
  pHasAnswers.value = !!r.examData.hasAnswers

  if (isListening.value) {
    const parts = CET.selectedParts(r.examData, r.passageNo)
    let qs = []
    parts.forEach((p) => { qs = qs.concat(p.questions || []) })
    pQuestions.value = qs
    pMissing.value = qs.filter((q) => !hasOptionText(q)).length
    const part = parts[0] || {}
    pAudioName.value = part.audio || ''
    if (part.audio) {
      const url = await audioUrl(part.audio)
      pAudioSrc.value = url || ''
    } else {
      pAudioSrc.value = ''
    }
  } else {
    pText.value = r.examData.text || ''
  }

  // 恢复作答 / 批改（换套题就重来）
  const key = practiceKey(r.exam)
  let restored = null
  if (!fresh) {
    try {
      const s = JSON.parse(storageGet(STORAGE_KEYS.PRACTICE_QUIZ) || 'null')
      if (s && s.key === key) restored = s
    } catch (e) {}
  }
  pAnswers.value = restored ? (restored.answers || {}) : {}
  pSubmitted.value = restored ? !!restored.submitted : false
  pDraft.value = restored ? (restored.essay || '') : ''
  pFeedback.value = restored ? (restored.feedback || '') : ''
  pAnalysis.value = restored ? (restored.analysis || {}) : {}
  pScore.value = ''
  if (pSubmitted.value && isListening.value) calcPracticeScore()

  state.currentExam = r.exam
  state.currentExamData = r.examData
  state.activeTab = 'quiz'
  // 从精听页带 ?chat=1 进来时，异步加载完成后仍停在聊天屏
  view.value = chatOnLoad.value ? 'chat' : 'article'
  chatOnLoad.value = false
  state.askContext = buildPracticeContext()
  if (!fresh) practiceSave()
}

function practiceIsCorrect(no) {
  return pHasAnswers.value && pCorrect.value[String(no)] === pAnswers.value[no]
}
// 听力卡片和阅读页同款左色条反馈：提交且有标准答案时，答对绿 / 答错红
function practiceResultClass(no) {
  if (!pSubmitted.value || !pHasAnswers.value) return ''
  return practiceIsCorrect(no) ? 'q-right' : 'q-wrong'
}

function choosePractice(no, key) {
  if (pSubmitted.value) return
  pAnswers.value[no] = key
  practiceSave()
}

function calcPracticeScore() {
  const qs = pQuestions.value
  const lines = qs.map((q) => {
    const mine = pAnswers.value[q.no] || '-'
    const answer = pHasAnswers.value ? `　正确答案 ${pCorrect.value[String(q.no)] || '-'}` : ''
    return `${q.no}. 你的答案 ${mine}${answer}`
  }).join('\n')
  if (!pHasAnswers.value) {
    pScore.value = `本套暂无标准答案，已保存作答。\n\n${lines}`
    return
  }
  const right = qs.filter((q) => pCorrect.value[String(q.no)] === pAnswers.value[q.no]).length
  pScore.value = `答对 ${right} / ${qs.length} 题\n\n${lines}`
}

async function submitPractice() {
  if (pSubmitted.value || pQuestions.value.length === 0) return
  const missing = pQuestions.value.filter((q) => !pAnswers.value[q.no])
  if (missing.length > 0) { CET.tip(`还有 ${missing.length} 道题没有作答`); return }
  pSubmitted.value = true
  practiceSave()
  calcPracticeScore()
  sideVisible.value = true
  if (!pHasAnswers.value) { saveListenWrong(); return }
  const token = storageGet(STORAGE_KEYS.TOKEN)
  if (token) {
    pListenGrading.value = true
    try {
      await generateListenAnalysis()
      practiceSave()
    } catch (err) {
      CET.tip(`解析生成失败：${err.message}`)
    }
    pListenGrading.value = false
  } else {
    CET.tip('已判完对错；在「设置」页填 DeepSeek Token 可自动生成中文解析')
  }
  saveListenWrong()
}

async function generateListenAnalysis() {
  const parts = CET.selectedParts(pExamData.value, state.selPassage)
  const transcript = parts.map((p) => `${p.name}\n${p.transcript}`).join('\n\n')
  let lines = ''
  pQuestions.value.forEach((q) => {
    lines += `${q.no}. ${q.stem || ''}\n`
    pOptionKeys.forEach((k) => { lines += `${k}) ${(q.options || {})[k] || ''}\n` })
    lines += `正确答案：${pCorrect.value[String(q.no)] || '未知'}　学生答案：${pAnswers.value[q.no] || '未作答'}\n\n`
  })
  const prompt = '你是一位专业的英语老师。下面是大学英语' + CET.levelName() + '听力真题的原文和题目。\n\n' +
    '【听力原文】\n' + transcript + '\n\n【题目】\n' + lines +
    '【任务】为每道题写一句简洁中文解析，说明依据原文何处、为何选该答案。\n' +
    '【输出格式】严格按行输出：解析|题号|中文'
  const answer = await callDeepSeek(prompt, 1800)
  const parsed = parseGradingOutput(answer)
  const next = {}
  pQuestions.value.forEach((q) => { if (parsed.analysis[q.no]) next[q.no] = parsed.analysis[q.no] })
  pAnalysis.value = next
}

function saveListenWrong() {
  if (!pHasAnswers.value) return
  const parts = CET.selectedParts(pExamData.value, state.selPassage)
  const part = parts[0]
  const partName = part ? part.name : CET.currentListenType()
  const items = pQuestions.value.filter((q) =>
    pCorrect.value[String(q.no)] && pAnswers.value[q.no] !== pCorrect.value[String(q.no)]).map((q) => ({
    level: state.currentLevel, type: 'listening', listenType: CET.currentListenType(),
    exam: examLabel(), passage: partName, no: q.no,
    stem: q.stem || '（题干在音频中念出）',
    options: q.options || { A: '', B: '', C: '', D: '' },
    answer: pCorrect.value[String(q.no)], my: pAnswers.value[q.no] || '未作答',
    analysis: pAnalysis.value[q.no] || q.analysis || q.explanation || q.desc || '', time: Date.now()
  }))
  const added = items.length ? CET.addMistakes(items) : 0
  if (added > 0) CET.tip(`已把 ${added} 道错题加入错题本`)
}

function clearPractice() {
  pAnswers.value = {}
  pAnalysis.value = {}
  pScore.value = ''
  pSubmitted.value = false
  sideVisible.value = false
  practiceSave()
}

async function submitEssay() {
  const answer = String(pDraft.value || '').trim()
  if (!answer) { CET.tip(isWriting.value ? '先把作文写出来' : '先把译文写出来'); return }
  if (pGrading.value) return
  pDraft.value = answer
  pSubmitted.value = true
  practiceSave()
  sideVisible.value = true
  pGrading.value = true
  try {
    const prompt = isWriting.value
      ? '你是大学英语四六级写作阅卷老师。请批改下面这篇学生作文，重点是语法错误。\n\n' +
        '【题目】\n' + pText.value + '\n\n【学生作文】\n' + answer + '\n\n' +
        '【要求】用简洁中文分四部分回答，不要用 JSON：\n' +
        '1. 语法错误清单：逐条写「原句 → 修改后 → 原因」；没有明显错误就写「无明显语法错误」。\n' +
        '2. 用词与表达：列出 3~5 处可以更地道的中式英语表达，并给替换建议。\n' +
        '3. 内容与结构：一句话点评是否扣题、论证是否充分。\n' +
        '4. 参考得分：按四六级写作 15 分制给一个分数，并说明扣分点。'
      : '你是大学英语四六级翻译阅卷老师。请批改学生把下面这段中文真题译成的英文。\n\n' +
        '【中文原文】\n' + pText.value + '\n\n【学生译文】\n' + answer + '\n\n' +
        '【要求】用简洁中文分四部分回答，不要用 JSON：\n' +
        '1. 语法错误清单：逐条写「原句 → 修改后 → 原因」；没有就写「无明显语法错误」。\n' +
        '2. 漏译 / 误译：指出没译出来或译错的信息点。\n' +
        '3. 修改后全文：给出一版语法正确、表达地道的完整英文译文。\n' +
        '4. 一句话点评：指出最值得改进的地方。'
    const fb = await CET.callDeepSeek(prompt, 1600)
    pFeedback.value = fb
    practiceSave()
    // 练习记录：写作 / 翻译批改成功后写入（记录页按模式展示）
    const ex = pExam.value || {}
    CET.addPracticeRecord({
      mode: state.mode,
      kind: isWriting.value ? '写作' : '整篇翻译',
      level: state.currentLevel,
      year: ex.year,
      month: ex.month,
      set: ex.set,
      title: `${CET.levelName()}${isWriting.value ? '写作' : '翻译'} · ${ex.year}年${ex.month}月第${ex.set}套`,
      source: pText.value,
      answer,
      feedback: fb
    })
    state.askContext = buildPracticeContext()
    CET.tip('已批改')
  } catch (err) {
    CET.tip(`批改失败：${err.message}`)
  }
  pGrading.value = false
}

function buildPracticeContext() {
  if (!isExtra.value || !pExamData.value) return null
  const typeName = isListening.value ? '听力' : (isWriting.value ? '写作' : '翻译')
  const lines = [`【练习类型】${CET.levelName()}${typeName}`]
  if (isListening.value) {
    const parts = CET.selectedParts(pExamData.value, state.selPassage)
    const transcript = parts.map((p) => `${p.name}\n${p.transcript}`).join('\n\n')
    lines.push(`【听力原文】\n${transcript}`)
    const items = pQuestions.value.map((q) => {
      const opts = pOptionKeys.map((k) => `${k}) ${(q.options || {})[k] || ''}`).join('\n')
      const answer = pCorrect.value[String(q.no)] || '未知'
      const mine = pAnswers.value[q.no] || '未作答'
      return `${q.no}. ${q.stem || ''}\n${opts}\n正确答案：${answer}　学生选的：${mine}`
    })
    lines.push(`【题目与作答】\n${items.join('\n\n')}`)
  } else {
    lines.push(`【题目 / 原文】\n${pText.value}`)
    lines.push(`【我的作答】\n${pDraft.value || ''}`)
    lines.push(`【AI 批改】\n${pFeedback.value || '（暂无）'}`)
  }
  return { quizPage: true, scopeFull: true, wrongOnly: false, text: lines.join('\n\n') }
}

function goImportAudio() {
  uni.reLaunch({ url: '/pages/settings/settings' })
}

// 从精听页点「发消息」跳过来（?chat=1）：直接进聊天屏，上下文用本页练习上下文
onLoad((query) => {
  if (query && query.chat === '1') {
    chatOnLoad.value = true
    resetChat(quizChatScope())
    askInput.value = ''
    sideVisible.value = true
    view.value = 'chat'
  }
})

if (isExtra.value) loadPractice()
else startQuiz()
</script>

<style scoped>
</style>
