/**
 * 全局响应式状态（替代原 script.js / practice.js 里的全局变量）
 * ---------------------------------------------------------------
 * 用 Vue3 reactive 管理，组件通过 useStore() 访问。
 */
import { reactive } from 'vue'
import { storageGet, storageSet } from '@/utils/storage'

// 存储键（与原版完全一致）
export const STORAGE_KEYS = {
  TOKEN: 'deepseek_token',
  LAST_EXAM: 'cet6_read_last_exam',
  WORD_BOOK: 'cet6_read_word_book',
  MISTAKE_BOOK: 'cet6_read_mistake_book',
  LEVEL: 'cet_read_level',
  SELECTION: 'cet_read_selection',
  MISTAKE_FILTER: 'cet_read_mistake_filter',
  MISTAKE_TYPE: 'cet_read_mistake_type',
  TENCENT_ID: 'tencent_secret_id',
  TENCENT_KEY: 'tencent_secret_key',
  LAST_ASK: 'cet_last_ask_record',
  QUIZ: 'cet_quiz_session',
  FONT_SCALE: 'cet_read_font_scale',
  EXAM_TYPE: 'cet_read_exam_type',
  AI_SCOPE: 'cet_read_ai_scope',
  MODE: 'cet_practice_mode',
  RECORDS: 'cet_practice_records',
  INTENSIVE: 'cet_intensive_session',
  PRACTICE_QUIZ: 'cet_practice_session'
}

const state = reactive({
  // ===== 当前状态（原 script.js 全局变量） =====
  currentLevel: '4',                    // 4 / 6
  currentExamType: 'careful',           // careful 仔细阅读 / long 长篇阅读
  currentExam: null,                    // 当前套题信息 {level, year, month, set, passage}
  selYear: '',                          // 题库选择：年份
  selMonth: '',                         // 月份
  selSet: '',                           // 第几套
  selPassage: '',                       // 第几篇
  currentExamData: null,                // 当前套题的题库数据
  sentences: [],                        // 精读句列表
  currentIndex: 0,                      // 当前句下标
  wordCache: {},                        // 查词缓存
  translateCache: {},                   // 每句翻译缓存
  phraseCache: {},                      // 每句短语缓存

  // 精读/做题当前载入的套题标识
  readSelKey: '',
  quizSelKey: '',
  quizPageScrollY: 0,
  quizQuestionsScrollY: 0,
  quizLastView: 'article',              // article / questions / chat

  // 错题本
  mistakeFilter: null,
  mistakeTypeFilter: 'careful',
  mistakeListenTypeFilter: '',

  // AI 问答上下文
  chatMessages: [],
  chatGeneration: 0,
  chatLoading: false,
  voiceAskMode: false,
  askContext: null,
  chatOwner: '',                          // 当前聊天会话归属的页面（read / quiz / listen）

  // 题目卡「问 AI」
  quizCardChats: {},
  quizCardLoading: {},
  quizCardAskNo: null,
  quizCardEpoch: 0,

  // 做题页
  quizGroups: [],
  quizAnswers: {},
  quizResults: {},
  quizSubmitted: false,
  quizGrading: false,
  quizArticle: '',

  // AI 范围
  aiScope: 'full',

  // 字号
  fontScale: 1,

  // 通话
  callMode: false,
  voiceSpeaking: false,

  // 查词弹窗
  lookupText: '',
  lookupTriples: [],
  lookupSeq: 0,
  lookupVisible: false,
  lookupLoading: false,

  // ===== 专项练习（原 practice.js 全局变量） =====
  mode: 'listening',                    // listening / reading / writing / translation（首次默认听力）
  listenType: '',
  listenEx: null,
  listenSel: '',
  listenSrcHidden: false,
  listenSubs: null,

  intensiveEx: null,
  intensiveIdx: 0,
  intensiveDrafts: {},
  intensiveResults: {},

  practiceEx: null,
  practiceSel: '',
  practiceSubmitted: false,
  essayDraft: '',
  essayFeedback: null,
  essaySrcHidden: false,

  records: [],

  // ===== 页面 =====
  currentPage: 'settings',              // 当前页面名
  activeTab: 'settings',                // 底部 tab 高亮
  pickerVisible: false,

  // 音频
  audioImported: 0,                     // 已导入音频段数
  audioImporting: false,
  audioImportStatus: ''
})

/** 读 AI 范围（full/wrong） */
export function isAiScopeFull() {
  return state.aiScope === 'full'
}

/** 恢复 AI 范围 */
export function restoreAiScope() {
  state.aiScope = storageGet(STORAGE_KEYS.AI_SCOPE) === 'wrong' ? 'wrong' : 'full'
}

export function applyAiScope(value) {
  state.aiScope = value === 'wrong' ? 'wrong' : 'full'
  storageSet(STORAGE_KEYS.AI_SCOPE, state.aiScope)
}

/** 强制重开某页的聊天会话（清空记录和上下文） */
export function resetChat(pageId) {
  state.chatOwner = pageId || ''
  state.chatMessages = []
  state.chatGeneration++
}

/** 接管聊天会话：换页进入提问屏 / 提问时先清掉上一页的记录，避免上下文串页 */
export function claimChat(pageId) {
  if (state.chatOwner === pageId) return
  resetChat(pageId)
}

/** 级别名称 */
export function levelName() {
  return state.currentLevel === '4' ? '四级' : '六级'
}

/** AI 提示词开场白 */
export function teacherIntro() {
  return `你是一位英语老师，正在辅导学生备考大学英语${levelName()}。`
}
export function readingIntro() {
  return `你是一位英语老师，正在帮学生精读大学英语${levelName()}真题。`
}

export function useStore() {
  return state
}

export default useStore
