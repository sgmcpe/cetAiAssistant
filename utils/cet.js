/**
 * 业务逻辑层：题库选择、生词、错题、判卷、备份恢复等纯逻辑
 * ---------------------------------------------------------------
 * 从原 script.js 提取，改为响应式 + 可复用模块。
 * 通过 useCETStore() 访问全局状态，通过 uni storage 持久化。
 */
import useStore, { STORAGE_KEYS, isAiScopeFull, levelName, teacherIntro, readingIntro } from '@/store/index'
import { storageGet, storageSet, listStoreKeys, isAudioStoreKey } from '@/utils/storage'
import { callDeepSeek, callDeepSeekChat, stripMarkdownBold, compactLines, dropEnglishHeadline } from '@/utils/deepseek'
import {
  readingData as _readingData, questionData as _questionData,
  longReadingData as _longReadingData, longQuestionData as _longQuestionData,
  listeningData as _listeningData, translationData as _translationData,
  writingData as _writingData, DATA
} from '@/utils/exam'
import { saveTextFile, chooseTextFile } from '@/utils/file'
import { speakText, stopSpeaking, startCallMode, stopCallMode, interruptSpeaking, resumeVoiceListening, isCallMode, isSpeaking, onVoiceState, onVoiceResult } from '@/utils/voice'

const state = useStore()

/* ==================== 工具函数 ==================== */
export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export function cnNum(value) {
  const n = Number(value)
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (!isFinite(n) || n < 0 || n > 9 || Math.floor(n) !== n) return String(value)
  return digits[n]
}
/** 去除 Markdown 加粗/标题标记 */
export function stripMarkdown(s) {
  return String(s).replace(/\*\*/g, '').replace(/\s*(?:=>|→|⇒)\s*/g, '：')
}

const OPTION_KEYS = ['A', 'B', 'C', 'D']
/** 提取选项 key 列表 */
export function optionKeys(options) {
  if (options && Object.keys(options).length > 0) return Object.keys(options)
  return OPTION_KEYS
}
/** 是否为 A/B/C/D 字母选项 */
export function isLetterOptions(options) {
  const keys = optionKeys(options)
  return keys.length > OPTION_KEYS.length && keys.every((k) => !(options && options[k]))
}
/** 生成字母选项范围文字 */
export function letterRangeText(options) {
  return `可选段落：${optionKeys(options).join(' ')}`
}
/** 选项数组 → 可读文本 */
export function optionsToText(options) {
  if (isLetterOptions(options)) return `${letterRangeText(options)}（对应文章段落）`
  return optionKeys(options).map((k) => `${k}) ${options[k] || ''}`).join('\n')
}

/* ==================== 题库分流 ==================== */
export function isLongReading() {
  return state.currentExamType === 'long'
}
export function examTypeName() {
  return isLongReading() ? '段落匹配' : '仔细阅读'
}
/** 按当前模式/级别取阅读题库 */
export function readingData() {
  // 听力 / 写作 / 翻译这些「专项」题库也从这里分流（对应原版 readingData 里的 extra 分支，
  // 原版会交给 practice.js 的 dataset(mode, level)）。
  // 之前漏了这一步：听力模式下拿到的是阅读题库，exam.parts 不存在，
  // 题库清单里那一套就一个篇按钮都列不出来，于是「选不了第几套」。
  if (state.mode === 'listening') return _listeningData(state.currentLevel)
  if (state.mode === 'writing') return _writingData(state.currentLevel)
  if (state.mode === 'translation') return _translationData(state.currentLevel)
  if (isLongReading()) return _longReadingData(state.currentLevel)
  return _readingData(state.currentLevel)
}
/** 按当前模式/级别取题目 */
export function questionData() {
  // 专项练习的题目就在各自的 parts 里，没有单独的题目库（原版同此，返回 null）
  if (state.mode !== 'reading') return null
  if (isLongReading()) return _longQuestionData(state.currentLevel)
  return _questionData(state.currentLevel)
}

/**
 * 「当前已选择」第二行的内容（原版 updateExamHint 的 tail 分支）：
 *   - 听力：显示篇名，如「新闻报道第一篇」
 *   - 写作 / 翻译：整套一道题，不显示
 *   - 阅读：第X篇；段落匹配是整篇，不显示
 */
export function examHintTail() {
  if (state.mode === 'listening') {
    const r = resolveExamResult()
    if (r.error) return ''
    // passageNo 是 parts 里的 1 基全局序号（听力类型过滤前）
    const parts = r.examData.parts || []
    const part = parts[(r.passageNo || 1) - 1]
    return part && part.name ? part.name : ''
  }
  if (state.mode !== 'reading') return ''
  if (state.selPassage) return `第${cnNum(state.selPassage)}篇`
  return isLongReading() ? '' : '全部文章'
}

/* ==================== 听力题型 / 篇选择 ==================== */
// 当前听力题型：存的选择不在本题型的候选里时落回第一个（原版 practice.js currentListenType）
export function currentListenType() {
  const types = (DATA.CET_LISTENING_TYPES || {})[state.currentLevel] || []
  return types.indexOf(state.listenType) >= 0 ? state.listenType : (types[0] || '')
}

/**
 * 当前选中的「篇」：
 *   - 听力只取一篇（passageNo 是整套 parts 里的 1 基全局序号；序号无效时落到当前题型第一篇）
 *   - 其它题型（写作 / 翻译）整套就是一个 parts 数组，直接返回全部
 * 精听页和听力做题页共用（原版 practice.js selectedParts）。
 */
export function selectedParts(examData, passageNo) {
  const parts = (examData && examData.parts) || []
  if (state.mode !== 'listening') return parts
  const p = parseInt(passageNo, 10) || 0
  if (p > 0 && parts[p - 1]) return [parts[p - 1]]
  const typed = parts.filter((x) => x.type === currentListenType())
  return [typed[0] || parts[0]].filter(Boolean)
}

/* ==================== 套题解析 ==================== */
export function resolveExamResult() {
  const year = (state.selYear || '').trim()
  const month = String(parseInt(state.selMonth || '0', 10))
  const setNo = String(parseInt(state.selSet || '0', 10))
  const passageInput = (state.selPassage || '').trim()
  let passageNo = isLongReading() ? 0 : (passageInput ? parseInt(passageInput, 10) : 0)
  if (!isLongReading() && !passageNo) passageNo = 1
  if (!year || !state.selMonth || !state.selSet) {
    return { error: '请填写完整的 年份 / 月份 / 第几套' }
  }
  const data = readingData()
  if (!data) return { error: '题库尚未加载完成，请稍候' }
  const examData = data[year] && data[year][month] && data[year][month][setNo]
  if (!examData) {
    let tipText = '未找到该套题。\n'
    if (data[year]) {
      const months = Object.keys(data[year]).sort((a, b) => Number(a) - Number(b))
      tipText += `${year}年可选：${months.join('月、')}月`
      const sets = Object.keys(data[year][months[0]])
      tipText += `（第${sets.join('、')}套）`
    } else {
      tipText += `可选年份：${Object.keys(data).sort().join('、')}`
    }
    return { error: tipText }
  }
  // 阅读是 passages，听力等专项题库是 parts；这里都要能算出「这一套有几组」
  const groupCount = examData.passages ? examData.passages.length : (examData.parts ? examData.parts.length : 0)
  if (passageNo && groupCount && (passageNo < 1 || passageNo > groupCount)) {
    return { error: `该套题只有 ${groupCount} 篇，请填写 1 - ${groupCount}` }
  }
  return {
    exam: { year, month, set: setNo, passage: passageNo },
    examData,
    passageNo
  }
}

/** 按当前选择取完整题库对象 */

export function resolveExam() {
  const result = resolveExamResult()
  if (result.error) { tip(result.error); return null }
  return result
}

/** 生成当前题库选择唯一 key */

export function selectionKey() {
  return [state.mode, state.currentLevel, state.currentExamType,
    state.selYear || '', state.selMonth || '', state.selSet || '', state.selPassage || ''].join('|')
}

/** 初始化/校验题库选择项 */

export function ensureSelection() {
  if (!resolveExamResult().error) return true
  const data = readingData()
  if (!data) return false
  const years = Object.keys(data).map(Number).sort((a, b) => b - a)
  if (years.length === 0) return false
  const year = years[0]
  const months = Object.keys(data[year]).sort((a, b) => Number(b) - Number(a))
  const sets = Object.keys(data[year][months[0]]).sort((a, b) => Number(a) - Number(b))
  const listeningMode = state.mode === 'listening'
  const noPassage = isLongReading() || (state.mode !== 'reading' && !listeningMode)
  fillExamInputs({ year: String(year), month: String(months[0]), set: String(sets[0]), passage: noPassage ? '' : '1' })
  saveSelection()
  return true
}

/** 把选择写入 DOM 表单隐藏域 */

export function fillExamInputs(sel) {
  if (sel && (sel.type === 'careful' || sel.type === 'long')) {
    state.currentExamType = sel.type
    storageSet(STORAGE_KEYS.EXAM_TYPE, state.currentExamType)
  }
  state.selYear = sel.year || ''
  state.selMonth = sel.month || ''
  state.selSet = sel.set || ''
  state.selPassage = sel.passage || ''
}

/** 获取当前选择数据 */

export function selectionData() {
  return {
    type: state.currentExamType,
    year: state.selYear || '',
    month: state.selMonth || '',
    set: state.selSet || '',
    passage: state.selPassage || ''
  }
}

/** 持久化当前题库选择 */

export function saveSelection() {
  storageSet(STORAGE_KEYS.SELECTION, JSON.stringify(selectionData()))
  // 专项练习各记一份
  if (state.mode !== 'reading') {
    storageSet(`cet_sel_${state.mode}_${state.currentLevel}`, JSON.stringify({
      year: state.selYear || '', month: state.selMonth || '', set: state.selSet || '', passage: state.selPassage || ''
    }))
  }
}

/** 从本地恢复上次选择 */

export function loadSelection() {
  try {
    const saved = JSON.parse(storageGet(STORAGE_KEYS.SELECTION) || 'null')
    if (!saved) return null
    return saved.selection || saved
  } catch (e) { return null }
}

/* ==================== 提示 / 确认 ==================== */
export function tip(msg) {
  uni.showToast({ title: String(msg), icon: 'none', duration: 2500 })
}
export function uiConfirm(message, options) {
  options = options || {}
  return new Promise((resolve) => {
    uni.showModal({
      title: '',
      content: message == null ? '' : String(message),
      cancelText: options.cancelText || '取消',
      confirmText: options.okText || '确定',
      confirmColor: options.danger ? '#e53935' : '#4a90e2',
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false)
    })
  })
}

/* ==================== 句子展平 ==================== */
export function flattenSentences(examData, passageNo) {
  const list = []
  // 听力等专项题库没有 passages（内容在 parts 里，由听力页自己处理），这里按空数组兜底
  ;(examData.passages || []).forEach((p, pIdx) => {
    if (passageNo && pIdx + 1 !== passageNo) return
    p.sentences.forEach((s) => {
      list.push({ passage: p.name, text: s, no: list.length + 1 })
    })
  })
  return list
}
/** 取选中篇章全文 */
export function passageTextOfSelected(examData, passageNo) {
  const parts = []
  ;(examData.passages || []).forEach((p, pIdx) => {
    if (passageNo && pIdx + 1 !== passageNo) return
    parts.push(p.text || p.sentences.join(' '))
  })
  return parts.join('\n\n')
}

/* ==================== 加载套题到状态 ==================== */
export function loadExamIntoState(resolved) {
  state.currentExam = resolved.exam
  state.currentExamData = resolved.examData
  state.sentences = flattenSentences(resolved.examData, resolved.passageNo)
  state.wordCache = {}
  state.translateCache = {}
  state.phraseCache = {}
  state.askContext = null
  state.chatMessages = []
  state.chatGeneration++
  state.currentIndex = 0
  try {
    const last = JSON.parse(storageGet(STORAGE_KEYS.LAST_EXAM) || 'null')
    if (last && last.year === state.currentExam.year && last.month === state.currentExam.month &&
      last.set === state.currentExam.set && (last.passage || 0) === state.currentExam.passage &&
      (last.level || '6') === state.currentLevel && (last.type || 'careful') === state.currentExamType) {
      if (last.index >= 0 && last.index < state.sentences.length) state.currentIndex = last.index
    }
  } catch (e) {}
  savePosition()
}

/** 保存当前阅读/听力进度位置 */

export function savePosition() {
  if (!state.currentExam) return
  storageSet(STORAGE_KEYS.LAST_EXAM, JSON.stringify({
    level: state.currentLevel, type: state.currentExamType,
    year: state.currentExam.year, month: state.currentExam.month, set: state.currentExam.set,
    passage: state.currentExam.passage, index: state.currentIndex
  }))
}

/* ==================== 生词库 ==================== */
export function loadWordBook() {
  const raw = loadJsonArray(STORAGE_KEYS.WORD_BOOK)
  const list = raw.map((w) => (typeof w === 'string' ? { word: w, pos: '', meaning: '' } : w))
    .filter((w) => w && w.word)
  const cleaned = list.filter((w) => isValidWordEntry(w.word))
  if (cleaned.length !== list.length) saveWordBook(cleaned)
  return cleaned
}
/** 保存生词本数组到本地 */
export function saveWordBook(list) {
  storageSet(STORAGE_KEYS.WORD_BOOK, JSON.stringify(list))
}
/** 按 key 读取 JSON 数组 */
export function loadJsonArray(key) {
  try { return JSON.parse(storageGet(key) || '[]') } catch (e) { return [] }
}

const WORD_PLACEHOLDER_RE = /^(单词或短语|英文单词|英文短语|单词|短语|词性|意思|中文意思|释义|查询单位|示例|例子|格式|说明|没有|无)$/
/** 清洗单词文本（去多余空白/括号） */
export function cleanWordText(s) {
  return String(s == null ? '' : s)
    .replace(/^\s*[-*•·]+\s*/, '')
    .replace(/^\s*\d+\s*[.、)]\s*/, '')
    .replace(/^\s*["'“”‘’「」『』【】\[\]（）()]+/, '')
    .replace(/["'“”‘’「」『』【】\[\]（）()]+\s*$/, '')
    .replace(/\s*[：:]\s*$/, '')
    .trim()
}
/** 单词条目格式是否合法 */
export function isValidWordEntry(word) {
  const w = cleanWordText(word)
  if (!w || w.length > 80 || !/[A-Za-z]/.test(w)) return false
  if (/[\u4e00-\u9fff]/.test(w)) return false
  if (WORD_PLACEHOLDER_RE.test(w)) return false
  if (/[.!?。！？]$/.test(w) && w.split(/\s+/).length > 8) return false
  return true
}
/** 从文本中查找生词本匹配 */
export function findWordEntry(text) {
  const key = cleanWordText(text).toLowerCase()
  if (!key) return null
  const list = loadWordBook()
  for (let i = 0; i < list.length; i++) {
    if (cleanWordText(list[i].word).toLowerCase() === key) return list[i]
  }
  return null
}
/** 批量添加生词到生词本 */
export function addToWordBook(triples) {
  if (!triples || triples.length === 0) return 0
  const valid = triples.filter((t) => t && isValidWordEntry(t.word)).map((t) => ({
    word: cleanWordText(t.word), pos: t.pos || '', meaning: t.meaning || ''
  }))
  if (!valid.length) return 0
  const list = loadWordBook()
  const index = {}
  list.forEach((w, i) => { index[String(w.word).toLowerCase()] = i })
  valid.forEach((t) => {
    const key = t.word.toLowerCase()
    if (index[key] !== undefined) list[index[key]] = t
    else { index[key] = list.length; list.push(t) }
  })
  saveWordBook(list)
  return valid.length
}

/* ==================== 词条解析工具（原 script.js parseWordTriples 等） ==================== */
const ZH_POS_RE = /^(短语|词组|名词|动词|形容词|副词|介词|连词|代词|数词|冠词|助动词|感叹词|及物动词|不及物动词)$/
const EN_STOP_WORDS = /^(add|adds|to|the|and|please|word|words|book|vocab|vocabulary|into|in|my|it|this|that|new|a|an|of|for|also|too|list)$/i
const POS_ZH = {
  n: '名词', v: '动词', adj: '形容词', adv: '副词',
  prep: '介词', conj: '连词', pron: '代词', art: '冠词',
  num: '数词', int: '感叹词', interj: '感叹词', aux: '助动词',
  vt: '及物动词', vi: '不及物动词', phr: '短语', phrase: '短语'
}
function toChinesePos(pos) {
  const p = String(pos || '').trim()
  if (!p) return ''
  return p.split(/\s*[\/、,，]\s*/).map((one) => {
    const key = one.replace(/\./g, '').trim().toLowerCase()
    return POS_ZH[key] || one.trim()
  }).filter((s) => s).join('、')
}

/** 从题目提取英文短语 */

export function extractEnglishPhrases(q, dropStopWords) {
  const chunks = String(q || '').match(/[A-Za-z][A-Za-z'’\-]*(?:\s+[A-Za-z][A-Za-z'’\-]*)*/g) || []
  const out = []
  chunks.forEach((chunk) => {
    const words = chunk.trim().split(/\s+/).filter((w) => w && (!dropStopWords || !EN_STOP_WORDS.test(w.replace(/[^A-Za-z'’\-]/g, ''))))
    if (words.length) out.push(words.join(' '))
  })
  return out.filter((w, i) => out.indexOf(w) === i)
}

/** 解析单词三词组 */

export function parseWordTriples(text) {
  const lines = String(text || '').split(/\r?\n/)
  const out = []
  function parseInline(line) {
    const parts = line.split(/[：:]/).map((s) => s.trim())
    if (parts.length < 2) return null
    let word = cleanWordText(parts[0])
    let rest = parts.slice(1)
    if (WORD_PLACEHOLDER_RE.test(word) && rest.length >= 2) {
      word = cleanWordText(rest[0]); rest = rest.slice(1)
    }
    if (!isValidWordEntry(word)) return null
    let pos = '', meaning = ''
    if (rest.length >= 2) { pos = toChinesePos(rest[0]); meaning = rest.slice(1).join('：') }
    else meaning = rest[0]
    meaning = String(meaning || '').replace(/^[\s：:]+|[\s：:]+$/g, '').trim()
    if (!meaning) return null
    return { word, pos, meaning }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = cleanWordText(lines[i])
    if (!line || /^(没有|无|请告诉|好的|已把)/.test(line)) continue
    const head = line.match(/^(.*?)\s*[（(]\s*([^）)]{0,10})\s*[）)]\s*[：:]?\s*$/)
    if (head) {
      const word = cleanWordText(head[1])
      const pos = toChinesePos(cleanWordText(head[2]))
      let j = i + 1
      while (j < lines.length && !cleanWordText(lines[j])) j++
      const meaning = String(lines[j] || '').replace(/^[\s：:]+|[\s：:]+$/g, '').trim()
      if (j < lines.length) i = j
      if (word && isValidWordEntry(word) && meaning) out.push({ word, pos, meaning })
      continue
    }
    const triple = parseInline(line)
    if (triple) out.push(triple)
  }
  return out
}

/* ==================== 错题本 ==================== */
export function loadMistakeList() {
  return loadJsonArray(STORAGE_KEYS.MISTAKE_BOOK)
}
export function saveMistakeList(list) {
  storageSet(STORAGE_KEYS.MISTAKE_BOOK, JSON.stringify(list))
}
/** 获取错题等级 */
export function mistakeLevel(m) { return m.level || '6' }
/** 获取错题类型（阅读/听力/写作/翻译） */
export function mistakeTypeOf(m) {
  if (m && (m.type === 'long' || m.type === 'careful' || m.type === 'listening')) return m.type
  return 'careful'
}
/** 获取错题听力子类型 */
export function mistakeListenTypeOf(m) { return (m && m.listenType) || '' }
/** 批量记录错题 */
export function addMistakes(items) {
  if (!items || !items.length) return 0
  const list = loadMistakeList()
  items.forEach((item) => {
    let idx = -1
    for (let i = 0; i < list.length; i++) {
      const m = list[i]
      if (mistakeLevel(m) === item.level && mistakeTypeOf(m) === mistakeTypeOf(item) &&
        m.exam === item.exam && m.passage === item.passage && Number(m.no) === Number(item.no)) {
        idx = i; break
      }
    }
    if (idx >= 0) list[idx] = item; else list.unshift(item)
  })
  saveMistakeList(list)
  return items.length
}
/** 生成当前题库标签 */
export function examLabel() {
  return `${state.currentExam.year}年${state.currentExam.month}月第${state.currentExam.set}套`
}
const PASSAGE_NAMES = ['Passage One', 'Passage Two', 'Passage Three']
/** 篇章 → 中文描述 */
export function passageToChinese(passage) {
  if (!passage) return ''
  const map = { one: '一', two: '二', three: '三', four: '四', five: '五' }
  const m = String(passage).match(/(\w+)$/)
  if (m) {
    const num = map[m[1].toLowerCase()]
    if (num) return `文章${num}`
  }
  return passage
}

/* ==================== 字体缩放 ==================== */
export function normalizeFontScale(raw) {
  let n = parseFloat(raw)
  if (!isFinite(n) || n <= 0) n = 1
  n = Math.min(1.6, Math.max(0.2, n))
  return Math.round(n * 100) / 100
}
/** 百分比字号 → fontScale 值 */
export function fontScaleFromPercent(percent) {
  let n = parseFloat(percent)
  if (!isFinite(n)) n = 100
  n = Math.min(160, Math.max(20, Math.round(n)))
  return { percent: n, scale: normalizeFontScale(n / 100) }
}

/* ==================== 导出的数据/密钥/备份工具 ==================== */
/** 两位补零：导出文件名里的月/日/时/分/秒都用它 */
export function pad2(n) {
  return String(n).padStart(2, '0')
}

export function backupStamp() {
  const now = new Date()
  return `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`
}
// 练习记录：只记录写作 / 翻译（与 HTML 原版一致，阅读 / 精翻 / 听力不记）
/** 追加练习记录（写作/翻译） */
export function addPracticeRecord(item) {
  if (!item || (item.mode !== 'writing' && item.mode !== 'translation')) return
  const list = loadJsonArray(STORAGE_KEYS.RECORDS)
  const now = new Date()
  list.unshift({
    ...item,
    id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
    at: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
  })
  if (list.length > 300) list.length = 300
  storageSet(STORAGE_KEYS.RECORDS, JSON.stringify(list))
}

/** 列出应用所有存储键 */

export function appStorageKeys() {
  const map = {}
  Object.keys(STORAGE_KEYS).forEach((k) => { map[STORAGE_KEYS[k]] = 1 })
  listStoreKeys().forEach((k) => { if (k && k.indexOf('__') !== 0) map[k] = 1 })
  return Object.keys(map).filter((k) => k.indexOf('__') !== 0 && !isAudioStoreKey(k))
}

/* ==================== 语音桥（包装成统一接口） ==================== */
export {
  speakText, stopSpeaking, startCallMode, stopCallMode, interruptSpeaking,
  resumeVoiceListening, isCallMode, isSpeaking, onVoiceState, onVoiceResult,
  callDeepSeek, callDeepSeekChat, stripMarkdownBold, compactLines, dropEnglishHeadline,
  saveTextFile, chooseTextFile, isAiScopeFull, levelName, teacherIntro, readingIntro,
  DATA, _listeningData as listeningData, _translationData as translationData, _writingData as writingData
}
