/**
 * 题库加载与解析
 * ---------------------------------------------------------------
 * 聚合 data/ 下的全部数据文件，提供统一接口。
 * 与原版 script.js 的 resolveExam / loadExamIntoState / ensureSelection 等价。
 */
import { CET4_READING_DATA } from '@/data/cet4_reading_data.js'
import { CET6_READING_DATA } from '@/data/cet6_reading_data.js'
import { CET4_QUESTIONS, CET6_QUESTIONS } from '@/data/questions_data.js'
import {
  CET4_LONG_READING, CET4_LONG_QUESTIONS,
  CET6_LONG_READING, CET6_LONG_QUESTIONS
} from '@/data/long_reading_data.js'
import {
  CET_LISTENING_4, CET_LISTENING_6,
  CET_TRANSLATION_4, CET_TRANSLATION_6,
  CET_WRITING_4, CET_WRITING_6,
  CET_LISTENING_TYPES, CET_AUDIO_MANIFEST
} from '@/data/extra_data.js'
import { CET_SRT_BUILTIN, CET_Q_CUES } from '@/data/listen_subs_data.js'

export const DATA = {
  CET4_READING_DATA,
  CET6_READING_DATA,
  CET4_QUESTIONS,
  CET6_QUESTIONS,
  CET4_LONG_READING,
  CET4_LONG_QUESTIONS,
  CET6_LONG_READING,
  CET6_LONG_QUESTIONS,
  CET_LISTENING_4,
  CET_LISTENING_6,
  CET_TRANSLATION_4,
  CET_TRANSLATION_6,
  CET_WRITING_4,
  CET_WRITING_6,
  CET_LISTENING_TYPES,
  CET_AUDIO_MANIFEST,
  CET_SRT_BUILTIN,
  CET_Q_CUES
}

/** 仔细阅读题库：按 级别 -> 年份 -> 月份 -> 套 -> 篇 */
export function readingData(level) {
  return level === '4' ? CET4_READING_DATA : CET6_READING_DATA
}

/** 仔细阅读题目：按 级别 -> 年份 -> 月份 -> 套 */
export function questionData(level) {
  return level === '4' ? CET4_QUESTIONS : CET6_QUESTIONS
}

/** 长篇阅读（段落匹配）原文 */
export function longReadingData(level) {
  return level === '4' ? CET4_LONG_READING : CET6_LONG_READING
}

/** 长篇阅读题目 */
export function longQuestionData(level) {
  return level === '4' ? CET4_LONG_QUESTIONS : CET6_LONG_QUESTIONS
}

/** 听力题库 */
export function listeningData(level) {
  return level === '4' ? CET_LISTENING_4 : CET_LISTENING_6
}

/** 翻译题库 */
export function translationData(level) {
  return level === '4' ? CET_TRANSLATION_4 : CET_TRANSLATION_6
}

/** 写作题库 */
export function writingData(level) {
  return level === '4' ? CET_WRITING_4 : CET_WRITING_6
}

/** 列出某题库某维度下的可选键（年份/月份/套/篇），用于题库清单 */
export function listKeys(data, key) {
  if (!data) return []
  return Object.keys(data[key] || {}).sort()
}

/**
 * 解析套题选择 {level, year, month, set, passage}
 * 返回可渲染的套题数据，找不到返回 null
 */
export function resolveExam(level, examType, selection) {
  if (!selection) return null
  const { year, month, set, passage } = selection
  if (!year || !month || !set) return null

  if (examType === 'long') {
    // 长篇阅读：原文 + 题目分开
    const reading = longReadingData(level)
    const questions = longQuestionData(level)
    const passageText = reading && reading[year] && reading[year][month] && reading[year][month][set]
    const qs = questions && questions[year] && questions[year][month] && questions[year][month][set]
    if (passageText == null && qs == null) return null
    return {
      level, examType, year, month, set,
      passage: passageText,
      questions: qs || [],
      article: passageText
    }
  }

  // 仔细阅读
  const data = readingData(level)
  const qData = questionData(level)
  const passageText = data && data[year] && data[year][month] && data[year][month][set] && data[year][month][set][passage]
  const qs = qData && qData[year] && qData[year][month] && qData[year][month][set]
  if (passageText == null && qs == null) return null
  return {
    level, examType, year, month, set, passage,
    passageText,
    questions: qs || []
  }
}
