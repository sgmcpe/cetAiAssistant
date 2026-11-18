/**
 * 精听文本工具（精听页 / 听力做题页共用）
 * ---------------------------------------------------------------
 * - 切句：把一段听力原文按 . ! ? 切成句，用于逐句高亮
 * - 长对话：按 W: / M: 切行，一行一句
 * - 字幕：读同名 .srt（优先用随题库打包的内置字幕）并与原文句对齐
 * - 滚动：把当前高亮的那句滚到视野中间（App 端拿不到 DOM，走节点查询）
 */

import { audioGetText } from '@/utils/audio'
import { alignSentences } from '@/utils/listenSubs'
import { DATA } from '@/utils/exam'

// 称谓 / 缩写后的「.」不是句子边界（Mr.Somavia、U.S.Officials 这类）
const HONOR = /^(mr|mrs|ms|dr|prof|st|sr|jr|mt|ft|gen|capt|sgt|lt|col|rev|hon|pres|gov|sen|rep|no|vs)$/

/** 把一段文本按 . / ! / ? 切成句；保留句间空白（含换行），不破坏原排版 */
export function splitSentences(text) {
  const out = []
  let last = 0
  const s = String(text)
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i)
    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i + 1
      while (j < s.length && '.!?"\'”’'.indexOf(s.charAt(j)) >= 0) j++
      let brk = false
      if (j >= s.length || /\s/.test(s.charAt(j))) brk = true
      else if (ch === '.' && /[A-Z]/.test(s.charAt(j))) {
        // 原文常见句号后漏空格（decline.Older / love.We）：也算句子边界，
        // 排除称谓缩写和 U.S. 这类带点缩写，避免误拆
        const w = s.slice(Math.max(0, s.lastIndexOf(' ', i - 1) + 1), i).toLowerCase()
        if (w.length > 1 && w.indexOf('.') < 0 && !HONOR.test(w)) brk = true
      }
      if (brk) {
        out.push(s.slice(last, j)); last = j; i = j - 1
      }
    }
  }
  if (last < s.length) out.push(s.slice(last))
  return out
}

/** 长对话原文在 txt 里是 "W: ... M: ..." 连成一段的，按说话人切成一行一句 */
export function formatDialogue(text) {
  return String(text || '')
    .replace(/\s+([MW])\s*:\s*/g, '\n$1: ')
    .replace(/^\s+/, '')
    .trim()
}

/**
 * 每句一个 span 供字幕逐句高亮。
 * 长对话先按 W:/M: 拆行、行内再按句拆，行与行之间用换行符隔开
 * （原文容器是 white-space: pre-wrap，\n 就是换行）
 */
export function buildSentenceSpans(text, dialogue) {
  if (!dialogue) return splitSentences(text).filter((s) => String(s).trim())
  const out = []
  formatDialogue(text).split('\n').forEach((line, li) => {
    let first = true
    splitSentences(line).forEach((seg) => {
      if (!String(seg).trim()) return
      out.push(li > 0 && first ? `\n${seg}` : seg)
      first = false
    })
  })
  return out
}

/**
 * 取这一篇的字幕并与原文句对齐。
 * 优先用内置字幕（CET_SRT_BUILTIN，随题库一起打包），没有再用导入的同名 .srt。
 * @returns {Promise<{cues:Array, qCues:Array, fallbackStart:number}|null>}
 */
export async function loadListenCues(audioName, sentenceSpans) {
  if (!audioName) return null
  const srtName = String(audioName).replace(/\.mp3$/i, '.srt')
  let srtText = (DATA.CET_SRT_BUILTIN || {})[srtName] || ''
  if (!srtText) {
    try { srtText = await audioGetText(srtName) } catch (e) { srtText = '' }
  }
  if (!srtText) return null
  return alignSentences(sentenceSpans || [], srtText, srtName, (DATA.CET_Q_CUES || {})[srtName])
}

/** 时间轴二分：返回 <= t 的最后一条字幕下标，没有就 -1 */
export function findCueIndex(cues, t) {
  if (!cues || !cues.length) return -1
  let lo = 0, hi = cues.length - 1, idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (cues[mid].start <= t) { idx = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return idx
}

/**
 * 让正在读的那句保持大致居中。
 * App-vue 的页面 JS 跑在 service webview 里，拿不到渲染层的 document；
 * 用节点查询拿目标位置（App 端 selectViewport().scrollOffset() 不返回 height，
 * 视口高度改用 getSystemInfoSync），再 pageScrollTo 滚过去。
 * topInset：顶部被悬浮播放条挡住的像素高度，居中前先把它从可视区里扣掉，
 * 否则目标元素会被顶到悬浮条下面（精听页朗读定位到题目时尤其明显）。
 */
export function scrollIntoViewSafe(id, topInset = 0) {
  // #ifdef H5
  try {
    const el = document.getElementById(id)
    if (el) {
      try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
      catch (e) { try { el.scrollIntoView(true); return } catch (e2) {} }
    }
  } catch (e) {}
  // #endif
  const query = uni.createSelectorQuery()
  query.select(`#${id}`).boundingClientRect()
  query.selectViewport().scrollOffset()
  query.exec((res) => {
    const rect = res && res[0]
    const vp = res && res[1]
    if (!rect || !vp) return
    const vh = (vp.height > 0 ? vp.height : 0) || uni.getSystemInfoSync().windowHeight || 0
    const inset = Math.max(0, topInset || 0)
    const usable = Math.max(vh - inset, 120)
    // 元素比可视区还高时不能再居中，直接贴到悬浮条下方
    const offset = inset + Math.max(0, (usable - rect.height) / 2)
    const top = rect.top + vp.scrollTop - offset
    uni.pageScrollTo({ scrollTop: Math.max(0, top), duration: 300 })
  })
}
