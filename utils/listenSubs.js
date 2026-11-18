/**
 * 精听页字幕逐句对齐
 * ---------------------------------------------------------------
 * 移植自原版《四六级备考助手》practice.js 的 loadListenSubtitles / questionTimeline：
 * 给定「原文按句拆好的数组」和「同名字幕 SRT 文本」，把每条字幕 cue 对齐到原文句，
 * 输出按时间升序、逐句高亮的 subCues（{start,end,si0,si1}）。
 *
 * 这里是纯逻辑（不碰 DOM、不依赖框架），listen 页只负责喂数据 + 根据结果做高亮 / 滚动，
 * 所以同一套算法在 App / H5 / 小程序都能跑。
 */

/** 解析 SRT 文本 -> [{start, end, text}]（时间单位：秒，按 start 升序） */
export function parseSrt(text) {
  const cues = []
  String(text || '').replace(/^\uFEFF/, '').replace(/\r/g, '')
    .split(/\n{2,}/).forEach((block) => {
      let lines = block.split('\n').filter((l) => l.trim() !== '')
      if (!lines.length) return
      if (/^\d+$/.test(lines[0]) && lines.length >= 2 && lines[1].indexOf('-->') >= 0) lines = lines.slice(1)
      const m = lines[0].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/)
      if (!m) return
      const start = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000
      const end = (+m[5]) * 3600 + (+m[6]) * 60 + (+m[7]) + (+m[8]) / 1000
      const body = lines.slice(1).join(' ')
        .replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, '').trim()
      if (body) cues.push({ start, end, text: body })
    })
  cues.sort((a, b) => a.start - b.start)
  return cues
}

/**
 * 把字幕对齐到原文句。
 * @param {string[]} sentences 原文按句拆好的数组（与页面上渲染的句子一一对应）
 * @param {string} srtText 该篇字幕 SRT 文本
 * @param {string} srtName 字幕文件名（用于取内置题目播报时间点）
 * @param {Array} qCuesPre 预生成题目时间点 [[时间秒, 题号], ...]（没有则从字幕文本现算）
 * @returns {{cues:Array, qCues:Array, fallbackStart:number}|null} 无字幕/配对失败返回 null
 */
export function alignSentences(sentences, srtText, srtName, qCuesPre) {
  const cues = parseSrt(srtText)
  if (!cues.length) return null
  const texts = (sentences || []).map((s) => String(s == null ? '' : s))
  if (!texts.length) return null

  // ==================== 题目播报时间点 ====================
  // 优先用生成好的独立时间点（CET_Q_CUES），它不混在字幕里，原文逐句高亮完全不受影响；
  // 没这份数据时才从字幕文本里现算。
  let qCues = []
  if (qCuesPre && qCuesPre.length >= 2) {
    qCues = qCuesPre.map((x) => ({ start: x[0], no: x[1] }))
  } else {
    const re = /\bquestions?\s*(\d{1,2})\b|\bq\s*(\d{1,2})\s*[:.]/gi
    const marks = []
    cues.forEach((cue) => {
      const raw = cue.text
      const dur = cue.end - cue.start
      let m
      re.lastIndex = 0
      while ((m = re.exec(raw))) {
        const no = parseInt(m[1] || m[2], 10)
        if (!no || no > 40) continue
        marks.push({ start: cue.start + (m.index / Math.max(1, raw.length)) * dur, no })
      }
    })
    marks.sort((a, b) => a.start - b.start)
    // 「Questions 12-15 ...」和紧跟着的「Question 12.」是同一题，只留最早的时间点
    const out = []
    marks.forEach((mk) => {
      const prev = out[out.length - 1]
      if (prev && prev.no === mk.no && mk.start - prev.start < 30) return
      out.push(mk)
    })
    qCues = out
  }

  // 归一化保留空格（词级模糊对齐需要），缩写统一展开 + 数字词统一成数字
  function normX(s) {
    let t = String(s).toLowerCase().replace(/[\u2019]/g, "'")
    t = t.replace(/\bi'm\b/g, 'i am').replace(/\bi've\b/g, 'i have')
      .replace(/\bi'd\b/g, 'i would').replace(/\bi'll\b/g, 'i will')
      .replace(/\b(we|you|they)'ve\b/g, '$1 have')
      .replace(/\b(we|you|they)'re\b/g, '$1 are')
      .replace(/\b(we|you|they|he|she|it|that|there)'ll\b/g, '$1 will')
      .replace(/\b(we|you|they|he|she|it|that|there)'d\b/g, '$1 would')
      .replace(/\b(he|she|it|that|there|what|who)'s\b/g, '$1 is')
      .replace(/\blet's\b/g, 'let us')
      .replace(/\b(can|do|does|did|is|are|was|were|have|has|had|would|should|could|must)'t\b/g, '$1 not')
      .replace(/\bwon't\b/g, 'will not').replace(/\bcan't\b/g, 'cannot')
      .replace(/\bok\b/g, 'okay')
      // U.S. 字幕侧常写成 US；点号归一会把原文拆成 "u s" 两个词，提前并成一个
      .replace(/\bu\.s\./g, 'us')
      .replace(/\btwelve\b/g, '12').replace(/\beleven\b/g, '11')
      .replace(/\bten\b/g, '10').replace(/\bnine\b/g, '9')
      .replace(/\beight\b/g, '8').replace(/\bseven\b/g, '7')
      .replace(/\bsix\b/g, '6').replace(/\bfive\b/g, '5')
      .replace(/\bfour\b/g, '4').replace(/\bthree\b/g, '3')
      .replace(/\btwo\b/g, '2').replace(/\bone\b/g, '1')
    const r = t.replace(/[^a-z0-9]+/g, ' ').trim()
    return r.replace(/^(w|m)\s+/, '')   // 长对话 W:/M: 说话人前缀剥掉
  }
  // 词近似匹配：完全相等或前 4 字符相同（处理 happens/happened 这类）
  function wordEq(a, b) {
    return a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, 4) === b.slice(0, 4))
  }

  // 全文归一化 + 每句区间 + 词表（含每个词在全文中的起点）
  let full = ''
  const spans = []
  const toks = []
  const tokOff = []
  texts.forEach((txt, si) => {
    if (full) full += ' '
    const n = normX(txt)
    const off = full.length
    spans.push({ s: off, e: off + n.length })
    full += n
    let o = off
    n.split(' ').forEach((w) => {
      if (!w) return
      toks.push(w); tokOff.push(o); o += w.length + 1
    })
  })
  // 第一个结束位置 > p 的词下标
  function tokAt(p) {
    let lo = 0, hi = toks.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (tokOff[mid] + toks[mid].length <= p) lo = mid + 1
      else hi = mid - 1
    }
    return lo
  }

  let pos = 0
  // 词级模糊对齐兜底：字幕和原文常见 happens/happened、we have/we've 的细微出入
  function fuzzyAlign(ctoks) {
    const n = ctoks.length
    const st0 = tokAt(pos)
    const need = Math.max(2, Math.ceil(n * 0.6))
    let best = null
    for (let st = st0; st + n - 1 < toks.length && st - st0 <= 40; st++) {
      let score = 0, fi = st, ci = 0, skips = 0, lastFi = st
      while (ci < n && fi < toks.length && skips <= 3) {
        if (wordEq(toks[fi], ctoks[ci])) { score++; fi++; ci++; lastFi = fi }
        else if (fi + 1 < toks.length && wordEq(toks[fi + 1], ctoks[ci])) { fi++; skips++ }
        else if (ci + 1 < n && wordEq(toks[fi], ctoks[ci + 1])) { ci++; skips++ }
        else { fi++; ci++; skips++ }
      }
      if (score >= need && (!best || score > best.score)) best = { st, lastFi, score }
    }
    if (!best) return null
    return {
      idx: tokOff[best.st],
      end: tokOff[best.lastFi - 1] + toks[best.lastFi - 1].length,
      score: best.score
    }
  }
  // 从已确认的起点把 cue 剩余部分按词继续往后对齐：很多 cue 一条念好几句话，
  // 全文精确匹配失败后只命中前缀 / 去词候选时，把整个 cue 的词走完，能盖多远盖多远
  function extendEnd(mtoks, stTok) {
    let fi = stTok, ci = 0, lastFi = stTok, miss = 0
    while (ci < mtoks.length && fi < toks.length) {
      if (wordEq(toks[fi], mtoks[ci])) { fi++; ci++; lastFi = fi; miss = 0 }
      else if (fi + 1 < toks.length && wordEq(toks[fi + 1], mtoks[ci])) { fi += 2; ci++; miss++ }
      else if (ci + 1 < mtoks.length && wordEq(toks[fi], mtoks[ci + 1])) { ci++; miss++ }
      else { fi++; ci++; miss++ }
      if (miss > 10) break
    }
    return lastFi
  }

  let subCues = []
  cues.forEach((cue) => {
    const t = normX(cue.text)
    if (!t) return
    const ctoks = t.split(' ')
    const cand = [t]
    const candToks = [ctoks]
    if (t.length > 40) { cand.push(t.slice(0, 40)); candToks.push(ctoks) }
    // 首条字幕常把播报语（News report 1. / Question 16. 等）和正文合在一起，
    // App 原文里没有这个前缀，整条就对不上、第一句不亮——逐个去掉开头词再试。
    const words = cue.text.split(/\s+/)
    const drops = []
    for (let d = 1; d <= 5; d++) {
      if (words.length <= d) break
      const tn = normX(words.slice(d).join(' '))
      if (tn && tn.length >= 20) { cand.push(tn); candToks.push(tn.split(' ')); drops.push(tn) }
    }
    let mStart = -1, mEnd = -1, mtoks = ctoks
    for (let c = 0; c < cand.length && mStart < 0; c++) {
      const k = full.indexOf(cand[c], pos)
      if (k >= 0) { mStart = k; mEnd = k + cand[c].length; mtoks = candToks[c] }
    }
    // 精确匹配失败时退到词级模糊对齐；Question 开头的是题目播报，正文里没有，跳过
    if (mStart < 0 && !/^question\b/i.test(cue.text)) {
      const fCands = []
      if (/^(news report|conversation|passage|recording|lecture|section)\b/i.test(cue.text) && drops.length) {
        drops.forEach((dc) => fCands.push(dc.split(' ')))
      }
      fCands.push(ctoks)
      let fBest = null
      fCands.forEach((ft) => {
        if (ft.length < 4) return
        const fr = fuzzyAlign(ft)
        if (fr && (!fBest || fr.score > fBest.score)) { fBest = fr; fBest.toks = ft }
      })
      if (fBest) { mStart = fBest.idx; mEnd = fBest.end; mtoks = fBest.toks }
    }
    if (mStart < 0) return
    let end = mEnd
    // 不是全文精确命中的（前缀 / 去词 / 模糊），把剩余词继续对齐，扩大覆盖范围
    if (mEnd - mStart < t.length - 2 && toks.length) {
      const stTok = tokAt(mStart)
      const extFi = extendEnd(mtoks, stTok)
      if (extFi > stTok) {
        const extEnd = tokOff[extFi - 1] + toks[extFi - 1].length
        if (extEnd > end) end = extEnd
      }
    }
    let si0 = -1, si1 = -1
    spans.forEach((sp, i) => {
      if (sp.e > mStart && sp.s < end) { if (si0 < 0) si0 = i; si1 = i }
    })
    if (si0 < 0) return
    if (si1 > si0 && cue.end > cue.start && end > mStart) {
      // 这条 cue 念了好几句：按每句在匹配区间里的字符占比把时间切开，
      // 高亮就能在 cue 内部一句句往前走，而不是整块一起亮十几秒
      for (let k = si0; k <= si1; k++) {
        const os = Math.max(mStart, spans[k].s)
        const oe = Math.min(end, spans[k].e)
        if (oe <= os) continue
        const f0 = (os - mStart) / (end - mStart)
        const f1 = (oe - mStart) / (end - mStart)
        subCues.push({
          start: cue.start + f0 * (cue.end - cue.start),
          end: cue.start + f1 * (cue.end - cue.start),
          si0: k, si1: k
        })
      }
    } else {
      subCues.push({ start: cue.start, end: cue.end, si0, si1 })
    }
    if (end > pos) pos = end
  })

  // 兜底：对「前后都已覆盖」的内部空洞，从后一条 subCue 借一小段时间补亮，
  // 保证逐句高亮不断档；开头 / 结尾的空缺不补（多为题目播报）
  if (subCues.length >= 2) {
    const out = [subCues[0]]
    for (let i = 1; i < subCues.length; i++) {
      const prev = out[out.length - 1]
      let cur = subCues[i]
      if (cur.si0 > prev.si1 + 1 && cur.end > cur.start) {
        const holes = []
        let total = 0
        for (let k = prev.si1 + 1; k < cur.si0; k++) {
          holes.push(k)
          total += Math.max(1, spans[k] ? spans[k].e - spans[k].s : 1)
        }
        const borrow = Math.min(holes.length * 1.1, (cur.end - cur.start) * 0.45)
        if (borrow > 0.2) {
          let t0 = Math.max(prev.end, cur.start)
          holes.forEach((si) => {
            const w = Math.max(1, spans[si] ? spans[si].e - spans[si].s : 1)
            const dur = borrow * w / total
            out.push({ start: t0, end: t0 + dur, si0: si, si1: si })
            t0 += dur
          })
          cur = { start: Math.max(cur.start, t0), end: cur.end, si0: cur.si0, si1: cur.si1 }
          if (cur.end <= cur.start) continue
        }
      }
      out.push(cur)
    }
    subCues = out
  }
  // 相邻 cue 之间常留 0.1~0.2s 的尾巴重叠，把前一条终点压到后一条起点，时间线严格单调
  for (let i = 0; i < subCues.length - 1; i++) {
    if (subCues[i].end > subCues[i + 1].start) subCues[i].end = subCues[i + 1].start
  }
  subCues = subCues.filter((c) => c.end > c.start)

  // 原文念完的时间：题目时间点不够时用音频尾段按题目数量均分兜底
  let lastTextEnd = -1
  cues.forEach((c) => {
    if (/\bquestions?\s*\d{1,2}\b/i.test(c.text)) return
    if (c.end > lastTextEnd) lastTextEnd = c.end
  })
  const fallbackStart = subCues.length ? subCues[subCues.length - 1].end : lastTextEnd
  qCues = qCues.filter((q) => q.start >= fallbackStart - 3)
  if (qCues.length < 2) qCues = []

  return { cues: subCues, qCues, fallbackStart }
}

/**
 * 「每道题开始念」的时间线，长度恒等于题目数量（原版 questionTimeline）：
 * 有精确题目播报就用它，不足的按平均间隔外推；完全没有就把音频尾段均分兜底。
 * @param {Array} qCues [{start,no}]
 * @param {number} fallbackStart 原文念完的时间点
 * @param {number} n 题目数量
 * @param {number} duration 音频总时长（秒，取不到就按每题 15s 估）
 * @param {number[]} [qNos] 本篇各题题号（与页面上题目顺序一致）
 */
export function questionTimeline(qCues, fallbackStart, n, duration, qNos) {
  const q = qCues || []
  const times = []

  // 字幕里偶尔漏掉某题的播报（尤其新套题），此时 qCues 比题目少，
  // 缺的又可能在开头或中间。传了 qNos 就按题号归位，避免整体前移造成跳题 / 重复高亮。
  let slots = null
  if (qNos && qNos.length && q.length) {
    slots = new Array(n).fill(null)
    q.forEach((c) => {
      const i = qNos.indexOf(c.no)
      if (i >= 0 && i < n && slots[i] == null) slots[i] = c.start
    })
    if (slots.every((v) => v == null)) slots = null
  }

  if (slots) {
    const known = []
    for (let i = 0; i < n; i++) if (slots[i] != null) known.push(i)
    let gaps = 0
    for (let k = 1; k < known.length; k++) gaps += slots[known[k]] - slots[known[k - 1]]
    let d = known.length > 1 ? gaps / (known.length - 1) : 15
    d = Math.max(8, Math.min(30, d))
    for (let i = 0; i < n; i++) {
      if (slots[i] != null) { times.push(slots[i]); continue }
      let prev = -1, next = -1
      for (let j = i - 1; j >= 0; j--) if (slots[j] != null) { prev = j; break }
      for (let j = i + 1; j < n; j++) if (slots[j] != null) { next = j; break }
      if (prev >= 0 && next >= 0) {
        // 中间缺失：左右已知点之间线性插值
        times.push(slots[prev] + (slots[next] - slots[prev]) * (i - prev) / (next - prev))
      } else if (prev >= 0) {
        times.push(slots[prev] + d * (i - prev))
      } else {
        times.push(Math.max(0, slots[next] - d * (next - i)))
      }
    }
    return times
  }

  if (q.length >= 2) {
    for (let i = 0; i < Math.min(n, q.length); i++) times.push(q[i].start)
    if (times.length < n) {
      let gaps = 0
      for (let j = 1; j < q.length; j++) gaps += q[j].start - q[j - 1].start
      let d = q.length > 1 ? gaps / (q.length - 1) : 15
      d = Math.max(8, Math.min(30, d))
      while (times.length < n) times.push(times[times.length - 1] + d)
    }
  } else if (fallbackStart >= 0) {
    let dur = duration
    if (!(dur > fallbackStart) || !isFinite(dur)) dur = fallbackStart + n * 15
    for (let k = 0; k < n; k++) times.push(fallbackStart + (dur - fallbackStart) * k / n)
  }
  return times
}
