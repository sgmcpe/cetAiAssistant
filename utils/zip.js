/**
 * ZIP 音频包解析（纯 JS，无外部依赖）
 * ---------------------------------------------------------------
 * 从原 practice.js 完整搬过来：
 *   - 只读尾部中央目录（EOCD）+ 逐条读取，1.2GB 音频也不会撑爆内存
 *   - 中文文件名 UTF-8 / GBK 自动校正（用 CET_AUDIO_MANIFEST 已知名）
 *   - deflate 优先 DecompressionStream，旧环境回退纯 JS inflate
 *   - 只收 .mp3（音频）和 .srt（字幕，用于播放逐句高亮）
 *
 * App 端用 plus.io 分块随机读文件（file.slice 等价物是 plus.io FileReader + slice）。
 * 这里把「解析 + 解压」逻辑抽象出来，输入是「随机读函数」。
 */

import { writeAppFile } from '@/utils/file'

/* ---------- 基础工具 ---------- */
/** 小端 Uint16 */ function u16(dv, p) { return dv.getUint16(p, true) }
/** 小端 Uint32 */ function u32(dv, p) { return dv.getUint32(p, true) }

/**
 * 按字符集把字节解成字符串。
 * 不能直接用 TextDecoder：uni-app App 端的 JS 引擎没有这个全局对象
 * （原版跑在浏览器里没问题，移植到 App 后会报 "TextDecoder is not defined"）。
 * 所以按「TextDecoder → Java 解码 → 纯 JS UTF-8 → Latin-1」依次兜底。
 */
function decodeBytes(bytes, charset) {
  if (typeof TextDecoder === 'function') {
    try { return new TextDecoder(charset).decode(bytes) } catch (e) {}
  }
  const viaJava = javaDecode(bytes, charset)
  if (viaJava != null) return viaJava
  if (charset === 'utf-8') return utf8Decode(bytes)
  return latin1Decode(bytes)
}

/** 交给 Java 的 String(byte[], charset) 解码（Android 端一定能正确处理 GBK） */
function javaDecode(bytes, charset) {
  // #ifdef APP-PLUS
  try {
    const StringClz = plus.android.importClass('java.lang.String')
    // Native.js 会把 JS 数组按参数类型转成 Java 数组；byte 是有符号的，这里先转成 -128..127
    const arr = []
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i]
      arr.push(b > 127 ? b - 256 : b)
    }
    const s = new StringClz(arr, charset === 'gbk' ? 'GBK' : 'UTF-8')
    if (s == null) return null
    const out = String(s)
    return out && out !== 'undefined' ? out : null
  } catch (e) {
    return null
  }
  // #endif
  return null
}

/** 纯 JS UTF-8 解码（兜底；jse 引擎里没有 String.fromCodePoint，所以手拼代理对） */
function utf8Decode(bytes) {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) { out += String.fromCharCode(b); i++; continue }
    let n = 0
    let cp = 0
    if ((b & 0xe0) === 0xc0) { n = 1; cp = b & 0x1f }
    else if ((b & 0xf0) === 0xe0) { n = 2; cp = b & 0x0f }
    else if ((b & 0xf8) === 0xf0) { n = 3; cp = b & 0x07 }
    if (!n || i + n >= bytes.length) { out += '\ufffd'; i++; continue }
    let ok = true
    for (let k = 1; k <= n; k++) {
      const c = bytes[i + k]
      if ((c & 0xc0) !== 0x80) { ok = false; break }
      cp = (cp << 6) | (c & 0x3f)
    }
    if (!ok) { out += '\ufffd'; i++; continue }
    if (cp > 0xffff) {
      cp -= 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    } else {
      out += String.fromCharCode(cp)
    }
    i += n + 1
  }
  return out
}

/** 最末兜底：逐字节映射（GBK 解不了时至少英文名可用） */
function latin1Decode(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

/**
 * 解码 zip 文件名（按 UTF-8 flag 或 GBK 兜底）
 * @param {Uint8Array} bytes 文件名原始字节
 * @param {boolean} utf8 是否按 UTF-8 解码
 * @returns {string}
 */
function decodeZipName(bytes, utf8) {
  return decodeBytes(bytes, utf8 ? 'utf-8' : 'gbk')
}

/** 取路径最后一段文件名 */
function baseName(name) {
  const parts = String(name).split(/[\\/]/)
  return parts[parts.length - 1]
}

// 已知音频文件名（用于编码校正）
const KNOWN_AUDIO_NAMES = {}
/**
 * 初始化已知文件名表（来自题库 manifest），用于 GBK/UTF-8 歧义校正
 * @param {Object} manifest CET_AUDIO_MANIFEST 对象
 */
export function initKnownNames(manifest) {
  Object.keys(manifest || {}).forEach((k) => {
    (manifest[k] || []).forEach((f) => { KNOWN_AUDIO_NAMES[f.name] = true })
  })
}

/**
 * 按 UTF-8 flag + 已知名表选出最佳文件名解码
 * @param {Uint8Array} bytes
 * @param {number} flags
 * @returns {string}
 */
function pickZipName(bytes, flags) {
  const a = decodeZipName(bytes, !!(flags & 0x800))
  if (KNOWN_AUDIO_NAMES[baseName(a)]) return a
  const b = decodeZipName(bytes, !(flags & 0x800))
  if (KNOWN_AUDIO_NAMES[baseName(b)]) return b
  return a
}

/* ---------- 纯 JS raw DEFLATE 解码（旧环境无 DecompressionStream 时兜底） ---------- */
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

/**
 * 纯 JS raw DEFLATE 解码（无 DecompressionStream 时的兜底）
 * @param {Uint8Array} src 压缩数据
 * @returns {Uint8Array} 解压后的数据
 */
function inflateJS(src) {
  const input = src instanceof Uint8Array ? src : new Uint8Array(src)
  let pos = 0, bitBuf = 0, bitCnt = 0
  let out = new Uint8Array(Math.max(4096, input.length * 3))
  let outLen = 0

  function bits(n) {
    while (bitCnt < n) {
      if (pos >= input.length) throw new Error('音频数据不完整')
      bitBuf |= input[pos++] << bitCnt
      bitCnt += 8
    }
    const v = bitBuf & ((1 << n) - 1)
    bitBuf >>>= n
    bitCnt -= n
    return v
  }
  function push(b) {
    if (outLen >= out.length) {
      const bigger = new Uint8Array(out.length * 2)
      bigger.set(out)
      out = bigger
    }
    out[outLen++] = b
  }
  function buildHuff(lengths) {
    const count = new Array(16).fill(0)
    let len, s
    for (s = 0; s < lengths.length; s++) if (lengths[s]) count[lengths[s]]++
    const offs = new Array(17).fill(0)
    for (len = 1; len <= 15; len++) offs[len + 1] = offs[len] + count[len]
    const symbol = new Array(lengths.length).fill(0)
    for (s = 0; s < lengths.length; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s
    return { count, symbol }
  }
  function decode(h) {
    let code = 0, first = 0, index = 0, len, cnt
    for (len = 1; len <= 15; len++) {
      code |= bits(1)
      cnt = h.count[len]
      if (code - cnt < first) return h.symbol[index + (code - first)]
      index += cnt
      first = (first + cnt) << 1
      code <<= 1
    }
    throw new Error('压缩数据损坏')
  }
  function fixedTables() {
    const lit = []
    let i
    for (i = 0; i < 144; i++) lit.push(8)
    for (i = 0; i < 112; i++) lit.push(9)
    for (i = 0; i < 24; i++) lit.push(7)
    for (i = 0; i < 8; i++) lit.push(8)
    const dist = []
    for (i = 0; i < 32; i++) dist.push(5)
    return { lit: buildHuff(lit), dist: buildHuff(dist) }
  }
  function dynamicTables() {
    const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4
    const cl = new Array(19).fill(0)
    let i
    for (i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3)
    const clH = buildHuff(cl)
    const lens = []
    let sym, repeat, val
    while (lens.length < hlit + hdist) {
      sym = decode(clH)
      if (sym < 16) lens.push(sym)
      else if (sym === 16) {
        if (!lens.length) throw new Error('压缩数据损坏')
        val = lens[lens.length - 1]
        repeat = 3 + bits(2)
        while (repeat--) lens.push(val)
      } else if (sym === 17) {
        repeat = 3 + bits(3)
        while (repeat--) lens.push(0)
      } else {
        repeat = 11 + bits(7)
        while (repeat--) lens.push(0)
      }
    }
    return {
      lit: buildHuff(lens.slice(0, hlit)),
      dist: buildHuff(lens.slice(hlit, hlit + hdist))
    }
  }

  let tables = null, last = 0
  do {
    last = bits(1)
    const type = bits(2)
    if (type === 0) {
      bitBuf = 0; bitCnt = 0
      if (pos + 4 > input.length) throw new Error('压缩数据损坏')
      const n = input[pos] | (input[pos + 1] << 8)
      pos += 4
      for (let i = 0; i < n; i++) push(input[pos++])
    } else {
      if (type === 1) tables = fixedTables()
      else if (type === 2) tables = dynamicTables()
      else throw new Error('不支持的压缩方式')
      for (;;) {
        const s = decode(tables.lit)
        if (s < 256) { push(s); continue }
        if (s === 256) break
        const li = s - 257
        if (li >= 29) throw new Error('压缩数据损坏')
        const length = LEN_BASE[li] + bits(LEN_EXTRA[li])
        const ds = decode(tables.dist)
        const distance = DIST_BASE[ds] + bits(DIST_EXTRA[ds])
        if (distance > outLen) throw new Error('压缩数据损坏')
        for (let k = 0; k < length; k++) push(out[outLen - distance])
      }
    }
  } while (!last)
  return out.subarray(0, outLen)
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'function' && typeof Response === 'function' && typeof Blob === 'function') {
    try {
      const ds = new DecompressionStream('deflate-raw')
      const stream = new Blob([bytes]).stream().pipeThrough(ds)
      const buf = await new Response(stream).arrayBuffer()
      return new Uint8Array(buf)
    } catch (e) { /* 回退纯 JS */ }
  }
  return inflateJS(bytes)
}

/**
 * 只解析中央目录，得到待解出的 mp3/srt 清单（不解压数据）。
 * entries[].index 是它在中央目录里的序号，用来和 Java ZipFile 枚举出的条目一一对应。
 * @param {Function} read 随机读函数：(offset, length) => Promise<Uint8Array>
 * @param {number} size 文件总大小
 * @returns {Promise<{count:number, entries:Array}>}
 */
export async function parseZipIndex(read, size) {
  // 1. 读尾部找 EOCD
  const tailLen = Math.min(size, 66000)
  const tail = await read(size - tailLen, tailLen)
  const tdv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (u32(tdv, i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 文件')

  const count = u16(tdv, eocd + 10)
  const cdSize = u32(tdv, eocd + 12)
  const cdOff = u32(tdv, eocd + 16)

  // 2. 读中央目录
  const cd = await read(cdOff, cdSize)
  const cdv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
  const entries = []
  let p = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || u32(cdv, p) !== 0x02014b50) break
    const flags = u16(cdv, p + 8)
    const method = u16(cdv, p + 10)
    const compSize = u32(cdv, p + 20)
    const nameLen = u16(cdv, p + 28)
    const extraLen = u16(cdv, p + 30)
    const commentLen = u16(cdv, p + 32)
    const localOff = u32(cdv, p + 42)
    const name = pickZipName(cd.subarray(p + 46, p + 46 + nameLen), flags)
    p += 46 + nameLen + extraLen + commentLen
    if (!/\.mp3$/i.test(name) && !/\.srt$/i.test(name)) continue
    entries.push({ index: n, name: baseName(name), method, compSize, localOff })
  }
  if (!entries.length) throw new Error('压缩包里没有找到 mp3 音频或 srt 字幕')
  console.log(`[zip] 共 ${entries.length} 条，示例：${entries.slice(0, 3).map((e) => e.name).join(' / ')}`)
  return { count, entries }
}

/**
 * 解析 ZIP 并解压出 mp3/srt 文件（纯 JS，H5 用）
 * @param {Function} read 随机读函数：(offset, length) => Promise<Uint8Array>
 * @param {number} size 文件总大小
 * @param {Function} onProgress 进度回调 (done, total)
 * @param {Function} onFile 每解出一个文件回调 (name, data, type)
 * @returns {Promise<{done:number, failed:number, total:number}>}
 */
export async function extractAudioZip(read, size, onProgress, onFile) {
  const { entries } = await parseZipIndex(read, size)

  // 逐条读取 + 解压
  let done = 0, failed = 0
  const total = entries.length
  for (let j = 0; j < total; j++) {
    const en = entries[j]
    try {
      const lh = await read(en.localOff, 30)
      const ldv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength)
      const dataStart = en.localOff + 30 + u16(ldv, 26) + u16(ldv, 28)
      const packed = await read(dataStart, en.compSize)
      const plain = en.method === 0 ? packed : (en.method === 8 ? await inflateRaw(packed) : null)
      if (!plain) { failed++; continue }
      const ftype = /\.srt$/i.test(en.name) ? 'text/plain' : 'audio/mpeg'
      await onFile(en.name, plain, ftype)
      done++
    } catch (err) { failed++ }
    if (onProgress) {
      const finished = done + failed
      if (finished % 10 === 0 || finished === total) onProgress(finished, total)
    }
  }
  return { done, failed, total }
}

/**
 * 把输入流整个倒进输出流（App 端）。
 *
 * 关键：**不要用 plus.android.invoke**。Native.js 的 invoke 会先把参数拼成调试字符串
 * （String.format → StringBuilder），遇到这俩流会分配 345MB 直接 OutOfMemoryError，
 * 而且 Java 侧真抛异常时 invoke 只是打日志、不往 JS 抛（表现为「写出 0 字节」却没有任何报错）。
 * 所以优先用直接方法代理：InputStream.transferTo（Android 8+）。
 *
 * @returns {string} 实际生效的方式，空串表示一个字节都没写出来
 */
function pumpStream(src, out, targetPath) {
  // #ifdef APP-PLUS
  const File = plus.android.importClass('java.io.File')
  const sizeOf = () => {
    try { out.flush() } catch (e) {}
    try { return new File(targetPath).length() || 0 } catch (e) { return 0 }
  }
  // 写法一：InputStream.transferTo(OutputStream)（Android 8+）
  if (typeof src.transferTo === 'function') {
    try { src.transferTo(out) } catch (e) {}
    if (sizeOf() > 0) return 'transferTo'
  }
  // 写法二：通道对通道 transferFrom（纯直接方法代理，同样不经过 invoke）
  try {
    const Channels = plus.android.importClass('java.nio.channels.Channels')
    const srcCh = Channels.newChannel(src)
    const dstCh = out.getChannel()
    let pos = 0
    for (let k = 0; k < 1000000; k++) {
      const n = dstCh.transferFrom(srcCh, pos, 1 << 20)
      if (!n || n <= 0) break
      pos += n
    }
    try { srcCh.close() } catch (e) {}
    if (sizeOf() > 0) return 'transferFrom'
  } catch (e) {}
  // 写法三：android.os.FileUtils.copy（静态方法只能用 invoke，放最后）
  try { plus.android.invoke('android.os.FileUtils', 'copy', src, out) } catch (e) {}
  if (sizeOf() > 0) return 'FileUtils.copy'
  return ''
  // #endif
  return ''
}

/**
 * 把 ZIP 里某一条目的数据段解出来写到目标文件（App 端，全程走 Java，不经 JS）。
 *
 * 为什么不用 ZipFile / ZipInputStream：
 * 它们的「枚举」接口返回的是 Java 对象（Enumeration / ZipEntry），实测 Native.js
 * 跨语言回传这类对象时拿不到（hasMoreElements is not a function / getNextEntry 返回空），
 * 所以改成最笨但最稳的办法：我们自己在 JS 里解析中央目录拿到
 * 「本地头偏移 + 压缩方式 + 压缩后长度」，再按字节区间让 Java 搬运。
 *
 * 存储型（method 0，音频基本都是）：FileChannel.transferTo 直接搬这一段字节；
 * deflate 型（method 8）：跳到数据起点后用 InflaterInputStream 解压。
 *
 * @returns {string} 使用的方式，便于排查
 */
function copyZipEntryNative(zipPath, dataStart, entry, targetPath) {
  // #ifdef APP-PLUS
  plus.android.importClass('java.io.InputStream')
  plus.android.importClass('java.io.OutputStream')
  const FileOutputStream = plus.android.importClass('java.io.FileOutputStream')
  const out = new FileOutputStream(targetPath)
  try {
    if (entry.method === 0) {
      const RandomAccessFile = plus.android.importClass('java.io.RandomAccessFile')
      const raf = new RandomAccessFile(zipPath, 'r')
      const src = raf.getChannel()
      const dst = out.getChannel()
      let pos = dataStart
      let left = entry.compSize
      while (left > 0) {
        const n = src.transferTo(pos, left, dst)
        if (!n || n <= 0) throw new Error('复制中断')
        pos += n
        left -= n
      }
      try { dst.close() } catch (e) {}
      try { src.close() } catch (e) {}
      try { raf.close() } catch (e) {}
      return 'transferTo'
    }
    if (entry.method === 8) {
      const FileInputStream = plus.android.importClass('java.io.FileInputStream')
      const Inflater = plus.android.importClass('java.util.zip.Inflater')
      const InflaterInputStream = plus.android.importClass('java.util.zip.InflaterInputStream')
      const fis = new FileInputStream(zipPath)
      let skipped = 0
      while (skipped < dataStart) {
        const n = fis.skip(dataStart - skipped)
        if (!n || n <= 0) throw new Error('定位数据起点失败')
        skipped += n
      }
      // ZIP 里放的是裸 deflate 流（没有 zlib 头），必须 nowrap=true，否则报 incorrect header check
      let inf = null
      try { inf = new InflaterInputStream(fis, new Inflater(true)) } catch (e) {}
      if (!inf) inf = new InflaterInputStream(fis)
      const how = pumpStream(inf, out, targetPath)
      try { inf.close() } catch (e) {}
      try { fis.close() } catch (e) {}
      if (!how) throw new Error('解压后没有数据')
      return `inflate:${how}`
    }
    throw new Error(`不支持的压缩方式 ${entry.method}`)
  } finally {
    try { out.close() } catch (e) {}
  }
  // #endif
  throw new Error('原生解压仅支持 App 端')
}

/**
 * App 端原生解压：ZIP 条目逐条交给 Java 搬运/解压（见 copyZipEntryNative）。
 *
 * 为什么不用上面的纯 JS 版：
 * WebView 的 JS 引擎没有 TextDecoder、FileReader 也只实现了 readAsDataURL，
 * 读二进制必须经过 base64 字符串。单条几十 MB 时 = base64 串(2 倍) + atob 结果 + Uint8Array，
 * 实测 1.19GB 音频包直接 OutOfMemoryError（表现为「base64 解码失败」）。
 *
 * @param {string} zipPath 沙盒里的 ZIP 绝对路径
 * @param {Function} read 随机读函数（只用来读每条 30 字节本地头 + 解析中央目录）
 * @param {number} size 文件总大小
 * @param {string} targetDir 目标目录绝对路径（以 / 结尾）
 * @param {Function} onProgress 进度回调 (done, total)
 * @returns {Promise<{done:number, failed:number, total:number}>}
 */
export async function extractAudioZipNative(zipPath, read, size, targetDir, onProgress) {
  // #ifdef APP-PLUS
  if (!zipPath) throw new Error('找不到压缩包路径')
  const { entries } = await parseZipIndex(read, size)
  const total = entries.length

  const File = plus.android.importClass('java.io.File')
  const dir = new File(targetDir)
  if (!dir.exists()) dir.mkdirs()

  let done = 0, failed = 0, mp3 = 0
  for (let j = 0; j < total; j++) {
    const it = entries[j]
    try {
      // 本地头的额外字段长度可能和中央目录不同，数据起点必须按本地头算
      const lh = await read(it.localOff, 30)
      const ldv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength)
      const dataStart = it.localOff + 30 + u16(ldv, 26) + u16(ldv, 28)
      const how = copyZipEntryNative(zipPath, dataStart, it, targetDir + it.name)
      // Native.js 调 Java 失败时只是打日志、不抛异常，所以这里必须自己核对落地字节数
      const written = new File(targetDir + it.name).length()
      if (written <= 0) throw new Error(`${how} 写出 0 字节`)
      done++
      if (/\.mp3$/i.test(it.name)) mp3++
    } catch (err) {
      // 原生失败时，小文件（基本都是 srt 字幕）退回 JS 分片读写，几十 KB 不会爆内存
      let ok = false
      if (it.compSize > 0 && it.compSize <= 4 * 1024 * 1024) {
        try {
          const lh = await read(it.localOff, 30)
          const ldv = new DataView(lh.buffer, lh.byteOffset, lh.byteLength)
          const packed = await read(it.localOff + 30 + u16(ldv, 26) + u16(ldv, 28), it.compSize)
          const plain = it.method === 0 ? packed : (it.method === 8 ? await inflateRaw(packed) : null)
          ok = !!(plain && writeAppFile(targetDir + it.name, plain))
        } catch (e2) {}
      }
      if (ok) {
        done++
        if (/\.mp3$/i.test(it.name)) mp3++
      } else {
        failed++
        console.error(`[zip] 解出失败：${it.name} ${err && err.message ? err.message : err}`)
      }
    }
    if (onProgress) {
      const finished = done + failed
      if (finished % 10 === 0 || finished === total) onProgress(finished, total)
    }
  }
  console.log(`[zip] 原生解压完成：${done} / ${failed} / ${total}`)
  return { done, failed, total, mp3 }
  // #endif
  // #ifndef APP-PLUS
  throw new Error('原生解压仅支持 App 端')
  // #endif
}
