/**
 * 原生能力适配层：文件导出 / 导入
 * ---------------------------------------------------------------
 * 导出：写入系统公共 Download 目录（Android 10+ 用 MediaStore，Android 6-9 用 legacy + 权限）。
 * 导入：用系统文件选择器（SAF），可从任意位置选择文件。
 */

/**
 * 保存文本到手机下载目录，返回是否成功
 */
export function saveTextFile(content, filename) {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    const done = (ok) => {
      if (ok) {
        uni.showToast({ title: '已保存到下载目录', icon: 'none' })
      } else {
        uni.showToast({ title: '保存失败，请检查权限后重试', icon: 'none' })
      }
      resolve(ok)
    }
    // Android 10+ 用 MediaStore 写入公共 Download，无需存储权限
    if (getSdkInt() >= 29) {
      try {
        saveViaMediaStore(content, filename, done)
      } catch (e) {
        done(false)
      }
      return
    }
    // Android 6-9 需要 WRITE_EXTERNAL_STORAGE 权限后直接写入
    if (typeof plus.android.requestPermissions === 'function') {
      plus.android.requestPermissions(['android.permission.WRITE_EXTERNAL_STORAGE'], () => {
        try {
          saveViaLegacy(content, filename, done)
        } catch (e) {
          done(false)
        }
      }, () => done(false))
    } else {
      try {
        saveViaLegacy(content, filename, done)
      } catch (e) {
        done(false)
      }
    }
    return
    // #endif
    // #ifdef H5
    // H5 端用 Blob 下载
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      resolve(true)
    } catch (e) {
      resolve(false)
    }
    // #endif
  })
}

/**
 * 选择并读取一个文本文件（JSON 导入用）
 * 返回 { content, name } 或 null
 */
export function chooseTextFile() {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    // 直接打开系统文件管理器（SAF，定位到 Download），不再弹中间选择框
    chooseViaSystemPicker((result) => resolve(result))
    return
    // #endif
    // #ifdef H5
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = (e) => {
      const file = e.target.files && e.target.files[0]
      if (!file) { resolve(null); return }
      const reader = new FileReader()
      reader.onload = () => resolve({ content: reader.result, name: file.name })
      reader.onerror = () => resolve(null)
      reader.readAsText(file, 'utf-8')
    }
    input.click()
    // #endif
  })
}

/** 返回键处理：非主页时退回主页，主页再退出 */
export function setupBackHandler(onBackToHome) {
  // #ifdef APP-PLUS
  plus.key.addEventListener('backbutton', () => {
    onBackToHome()
  })
  // #endif
}

/** 沙盒（_doc）里的文件名 → 原生绝对路径；拿不到就返回空串 */
export function sandboxPath(name) {
  // #ifdef APP-PLUS
  try {
    const dir = plus.io.convertLocalFileSystemURL('_doc/')
    if (dir) return `${dir.replace(/[\\/]+$/, '')}/${name}`
  } catch (e) {}
  // #endif
  return ''
}

/**
 * 选择并打开一个文件（返回可随机分块读的句柄 + 大小）
 * App 端用系统 SAF 选择器；H5 用 input[type=file]
 * @returns {Promise<{name, size, absPath, read:(off,len)=>Promise<Uint8Array>, cleanup:()=>void}|null>}
 */
export function chooseFile(extension) {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    const ext = extension ? extension.replace(/^\./, '') : ''
    pickFileApp(ext ? [ext] : [], (entry, name, size, isMemory, isTemp) => {
      entry.file((file) => {
        resolve({
          name: name || '',
          size: size || file.size,
          // SAF 选中的文件会被复制进沙盒，真实绝对路径在这里（原生解压要用）
          absPath: isTemp && entry ? sandboxPath(entry.name) : '',
          read: (off, len) => readFileSlice(file, off, len, isMemory),
          // SAF 选中的文件会先复制到应用沙盒，导入完删掉，别占用户空间。
          // plus.io 的 entry.remove 实测删不掉（1.19GB 的临时包留在 doc 目录里），改用 Java File.delete。
          cleanup: () => {
            if (!isTemp || !entry) return
            // #ifdef APP-PLUS
            try {
              const abs = sandboxPath(entry.name)
              if (abs) {
                const File = plus.android.importClass('java.io.File')
                const f = new File(abs)
                const existed = f.exists()
                const ok = existed ? f.delete() : true
                console.log('[file.js] 清理临时包', abs, `存在=${existed}`, `删除=${ok}`)
                if (ok) return
              }
            } catch (e) {
              console.error('[file.js] 清理临时包失败:', e && e.message)
            }
            // #endif
            if (typeof entry.remove !== 'function') return
            try { entry.remove(() => {}, () => {}) } catch (e) {}
          }
        })
      }, () => resolve(null))
    }, () => resolve(null))
    return
    // #endif
    // #ifdef H5
    const input = document.createElement('input')
    input.type = 'file'
    if (extension) input.accept = extension
    input.onchange = (e) => {
      const f = e.target.files && e.target.files[0]
      if (!f) { resolve(null); return }
      resolve({
        name: f.name,
        size: f.size,
        absPath: '',
        read: (off, len) => f.slice(off, off + len).arrayBuffer().then((b) => new Uint8Array(b))
      })
    }
    input.click()
    // #endif
  })
}

/**
 * 把二进制数据写进沙盒文件（绝对路径），成功返回 true。
 *
 * 起因：plus.io 的 FileWriter.write 文档里只支持字符串，传 ArrayBuffer 会写出 0 字节文件；
 * uni.getFileSystemManager 在 uni-app（js 引擎版）里又不支持（只有 uni-app x 有）。
 * 所以走 Java：数据先转 base64（纯 ASCII），Java 端 Base64.decode 拿回 byte[] 再落盘。
 *
 * 为什么用 base64 而不是「JS 数组 → byte[]」：
 * Native.js 往 Java 传 JS 数组时会先在 Java 侧拼字符串，元素一多就 OOM
 * （实测 1MB 的数组要分配 345MB，日志：OutOfMemoryError at StringBuffer.toString），
 * base64 每片只是一根 ASCII 字符串，安全得多。
 */
export function writeAppFile(absPath, u8) {
  // #ifdef APP-PLUS
  try {
    const File = plus.android.importClass('java.io.File')
    const FileOutputStream = plus.android.importClass('java.io.FileOutputStream')
    const Base64 = plus.android.importClass('android.util.Base64')
    const file = new File(absPath)
    const parent = file.getParentFile()
    if (parent && !parent.exists()) parent.mkdirs()
    const out = new FileOutputStream(absPath)
    if (!out) throw new Error('打开写入流失败')
    const CHUNK = 512 * 1024
    for (let off = 0; off < u8.length; off += CHUNK) {
      const end = Math.min(off + CHUNK, u8.length)
      const bytes = Base64.decode(bytesToBase64(u8, off, end), 0)
      if (bytes == null) throw new Error('base64 解码失败')
      out.write(bytes)
    }
    out.flush()
    out.close()
    return true
  } catch (e) {
    console.error('[file.js] 写文件失败:', e && e.message)
  }
  // #endif
  return false
}

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Uint8Array[from, to) → base64 字符串（自己算，不依赖运行时的 btoa） */
function bytesToBase64(u8, from, to) {
  let out = ''
  let buf = []
  let i = from
  for (; i + 2 < to; i += 3) {
    const n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2]
    buf.push(B64_CHARS[(n >> 18) & 63], B64_CHARS[(n >> 12) & 63], B64_CHARS[(n >> 6) & 63], B64_CHARS[n & 63])
    if (buf.length >= 8192) { out += buf.join(''); buf = [] }
  }
  const rem = to - i
  if (rem === 1) {
    const n = u8[i] << 16
    buf.push(B64_CHARS[(n >> 18) & 63], B64_CHARS[(n >> 12) & 63], '=', '=')
  } else if (rem === 2) {
    const n = (u8[i] << 16) | (u8[i + 1] << 8)
    buf.push(B64_CHARS[(n >> 18) & 63], B64_CHARS[(n >> 12) & 63], B64_CHARS[(n >> 6) & 63], '=')
  }
  return out + buf.join('')
}

/**
 * 读一段文件内容（App 端）：
 * 内存伪文件直接 slice；沙盒 / plus.io 的真 File 走下面的多种读法。
 *
 * 为什么搞这么麻烦：不同运行时的「能用的读法」不一样，
 * 5+ 文档里 FileReader 只有 readAsText / readAsDataURL 是真实现，
 * 实测某些基座上 readAsArrayBuffer 只是个空壳（调用了但 onloadend 永不触发），
 * 而 readAsDataURL 也有不回调的情况。所以这里按顺序试几种写法、每种带超时，
 * 一旦某种成功就记住它（后面每个分片直接用，避免反复试错拖慢导入）。
 */
function readFileSlice(file, off, len, isMemory) {
  let sliced
  try {
    sliced = file.slice(off, off + len)
  } catch (e) {
    return Promise.reject(e)
  }
  // 内存伪文件：slice 返回 Uint8Array（或 ArrayBuffer），直接转
  if (isMemory) {
    return Promise.resolve(sliced instanceof Uint8Array ? sliced : new Uint8Array(sliced))
  }

  const tries = [
    () => plusReader('readAsDataURL', sliced),
    () => plusReader('readAsArrayBuffer', sliced),
    () => standardReader(sliced),
    () => (sliced && typeof sliced.arrayBuffer === 'function'
      ? sliced.arrayBuffer().then(toBytes)
      : Promise.reject(new Error('没有 arrayBuffer()')))
  ]
  // 把上次成功的那种排到最前面
  const order = tries.map((fn, idx) => idx)
  if (sliceReaderIndex >= 0) {
    order.sort((a, b) => (a === sliceReaderIndex ? -1 : b === sliceReaderIndex ? 1 : 0))
  }

  let i = 0
  const next = () => {
    if (i >= order.length) return Promise.reject(new Error('读取文件失败'))
    const idx = order[i++]
    // 还没确定可用读法时给短超时，确定之后放宽（大分片 base64 解码要时间）
    const ms = sliceReaderIndex >= 0 ? 30000 : 3000
    return withTimeout(tries[idx](), ms, `读取方式${idx + 1}`)
      .then((bytes) => {
        if (sliceReaderIndex !== idx) {
          sliceReaderIndex = idx
          console.log(`[file.js] 文件分片读法确定为方式${idx + 1}`)
        }
        return bytes
      })
      .catch(next)
  }
  return next()
}

/** 上一次成功的分片读法下标（-1 表示还没确定） */
let sliceReaderIndex = -1

/** 5+ 的 FileReader */
function plusReader(method, sliced) {
  return new Promise((res, rej) => {
    const fr = new plus.io.FileReader()
    if (typeof fr[method] !== 'function') { rej(new Error(`不支持 ${method}`)); return }
    fr.onloadend = (e) => {
      // 不同基座上结果挂的位置不一样：有的在 e.target.result，有的在 e.result / reader.result
      const r = pickResult(e, fr)
      if (r == null) {
        rej(new Error(`${method} 没有返回内容`))
        return
      }
      try {
        res(toBytes(r))
      } catch (err) {
        rej(err)
      }
    }
    fr.onerror = () => rej(new Error(`${method} 失败`))
    fr[method](sliced)
  })
}

/** 从 FileReader 的事件 / 实例里取读到的内容 */
function pickResult(e, fr) {
  if (e) {
    if (e.target && e.target.result != null) return e.target.result
    if (e.result != null) return e.result
  }
  if (fr && fr.result != null) return fr.result
  return null
}

/** WebView 自带的标准 FileReader（个别基座上 entry.file() 给的是 Blob 兼容对象） */
function standardReader(sliced) {
  return new Promise((res, rej) => {
    try {
      if (typeof FileReader !== 'function') { rej(new Error('没有标准 FileReader')); return }
      const fr = new FileReader()
      fr.onload = () => res(toBytes(fr.result))
      fr.onerror = () => rej(new Error('标准 FileReader 失败'))
      fr.readAsArrayBuffer(sliced)
    } catch (e) {
      rej(e)
    }
  })
}

/** 给 Promise 加超时：原生读法不回调时也要能失败，不能把导入流程挂死 */
function withTimeout(promise, ms, label) {
  return new Promise((res, rej) => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      console.error(`[file.js] ${label} 超时`)
      rej(new Error(`${label}超时`))
    }, ms)
    promise.then((v) => {
      if (done) return
      done = true
      clearTimeout(timer)
      res(v)
    }, (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      rej(e)
    })
  })
}

/** 把 FileReader 的结果（ArrayBuffer / dataURL / base64）统一转成 Uint8Array */
function toBytes(result) {
  if (result == null) throw new Error('读取结果为空')
  if (result instanceof Uint8Array) return result
  if (result instanceof ArrayBuffer) return new Uint8Array(result)
  const text = String(result)
  const comma = text.indexOf(',')
  const b64 = comma >= 0 ? text.slice(comma + 1) : text
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/* ==================== App 端统一文件选择（直接走系统 SAF 文件管理器） ==================== */

/**
 * 让 SAF 文件管理器尽量定位到系统 Download 目录。
 * 用 DocumentsContract.EXTRA_INITIAL_URI（字符串常量 'android.provider.extra.INITIAL_URI'）
 * + MediaStore 的 external/downloads 集合 uri。个别 ROM 不认这个 uri 也不影响打开，
 * 只是回到默认目录而已，所以整段包 try/catch。
 */
function addDownloadHint(intent) {
  // #ifdef APP-PLUS
  try {
    const Uri = plus.android.importClass('android.net.Uri')
    intent.putExtra(
      'android.provider.extra.INITIAL_URI',
      Uri.parse('content://media/external/downloads')
    )
  } catch (e) {}
  // #endif
}

/**
 * 统一的 App 端文件选择入口：直接打开系统 SAF 文件管理器（返回带读权限的 content:// URI）。
 * 成功回调 (fileEntry, name, size)
 *
 * 不再使用 plus.io.chooseFile 兜底：它在部分机型上会弹出「选择文件 / 未选择文件 / 取消 / 确定」
 * 这种简陋原生框，用户明确要求去掉，改为直接进系统文件管理器 Download 目录选择。
 */
function pickFileApp(filetypes, onOk, onFail) {
  // #ifdef APP-PLUS
  pickViaSaf((uri, launched) => {
    if (uri) { resolveEntryFromUri(uri, onOk, onFail); return }
    // SAF 没启动起来（个别机型 onActivityResult 被占用等）直接失败，不再弹旧的「选择文件」框
    if (!launched) console.error('[file.js] SAF 文件管理器未能启动')
    onFail()
  })
  // #endif
}

/** 兜底：plus.io.chooseFile（仅当 SAF 无法启动时使用） */
function pickViaPlusIo(filetypes, onOk, onFail) {
  // #ifdef APP-PLUS
  if (typeof plus.io !== 'undefined' && typeof plus.io.chooseFile === 'function') {
    try {
      plus.io.chooseFile({
        title: '选择文件',
        filetypes: filetypes && filetypes.length ? filetypes : [],
        multiple: false
      }, (res) => {
        const picked = extractPicked(res)
        if (!picked) { onFail(); return }
        // picked.path 可能是绝对路径或 content:// URI
        resolveToEntry(picked, onOk, onFail)
      }, () => onFail())
      return
    } catch (e) {}
  }
  onFail()
  // #endif
}

/** 从 plus.io.chooseFile 的返回里稳健地提取文件信息 */
function extractPicked(res) {
  if (!res) return null
  // 兼容 tempFilePaths（字符串数组）
  if (Array.isArray(res.tempFilePaths) && res.tempFilePaths.length) {
    return { path: res.tempFilePaths[0], name: '', size: 0, entry: null }
  }
  // 兼容 tempFiles（对象数组）
  if (Array.isArray(res.tempFiles) && res.tempFiles.length) {
    const f = res.tempFiles[0]
    return { path: f.path || f.fullPath || f.name, name: f.name || '', size: f.size || 0, entry: (f.file && typeof f.file === 'function') ? f : null }
  }
  // 兼容 files（FileEntry 数组或路径字符串数组）
  if (Array.isArray(res.files) && res.files.length) {
    const f = res.files[0]
    if (typeof f === 'string') return { path: f, name: '', size: 0, entry: null }
    // FileEntry 对象：优先直接用它的 .file()
    if (f.file && typeof f.file === 'function') {
      return { path: f.path || f.fullPath || f.name, name: f.name || '', size: f.size || 0, entry: f }
    }
    return { path: f.path || f.fullPath || f.name, name: f.name || '', size: f.size || 0, entry: null }
  }
  return null
}

/** 把路径解析成 FileEntry，回调 (entry, name, size, isMemory, isTemp) */
function resolveToEntry(picked, onOk, onFail) {
  // 若本身就是 FileEntry 对象，直接用
  if (picked.entry) {
    onOk(picked.entry, picked.name, picked.size, false, false)
    return
  }
  const path = picked.path
  if (!path) { onFail(); return }

  // content:// URI：走 SAF 读取
  if (path.indexOf('content://') === 0) {
    resolveEntryFromUri(path, onOk, onFail)
    return
  }

  // 原生绝对路径（/storage/、/sdcard/、/mnt/、/data/ 等开头）：直接用 plus.android 读，
  // 不要先试 plus.io.resolveLocalFileSystemURL（它对绝对路径会卡住不回调）
  if (isNativeAbsolutePath(path)) {
    resolveEntryFromNativePath(path, onOk, onFail)
    return
  }

  // plus.io 沙箱相对路径（_doc、_www、_downloads 等）：走 plus.io
  plus.io.resolveLocalFileSystemURL(path, (entry) => {
    onOk(entry, picked.name || entry.name || '', picked.size || 0, false, false)
  }, () => onFail())
}

/** 判断是否为原生绝对路径（/storage/、/sdcard/、/mnt/、/data/ 等） */
function isNativeAbsolutePath(path) {
  if (!path) return false
  // file:// 开头也是绝对路径
  if (path.indexOf('file://') === 0) return true
  // 以 / 开头但不是 plus.io 沙箱路径（_doc/_www/_downloads/_documents 等）
  if (path.charAt(0) === '/') return true
  return false
}

/** 从路径字符串提取文件名 */
function pathName(path) {
  if (!path) return ''
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return idx >= 0 ? path.slice(idx + 1) : path
}

/**
 * 把一段音频流复制到应用私有 doc 目录，回调 (FileEntry, 沙盒文件名)。
 *
 * 为什么不直接读进内存：听力 ZIP 常有上百 MB，整包读进 JS 必然爆内存；
 * ZIP 解析本身也是「读尾部中央目录 → 按偏移读每个条目」的随机访问模式，
 * 所以先流式落盘，再用 plus.io File.slice() 按需分块读最合适。
 *
 * 为什么不能用 byte[] 缓冲：Native.js 没法把 JS 的 ArrayBuffer 当 Java 的 byte[]
 * 传参（日志里就是 InvProxy: NativeObject.execMethod read method ; params=[{}]），
 * 所以复制只能靠「流对流」的几种原生写法，见 copyStream()。
 */
function copyStreamToDocEntry(input, ext, onOk, onFail) {
  // #ifdef APP-PLUS
  const fail = (msg) => {
    try { if (input) input.close() } catch (e) {}
    if (msg) console.error(`[file.js] ${msg}`)
    onFail()
  }
  if (!input) { fail('无法打开文件流'); return }

  plus.io.requestFileSystem(plus.io.PRIVATE_DOC, () => {
    const name = `cet-import-${Date.now()}${ext || ''}`
    try {
      // 私有目录的绝对路径（_doc → /data/data/<pkg>/apps/<appid>/doc）
      const docDir = plus.io.convertLocalFileSystemURL('_doc/')
      if (!docDir) { fail('找不到应用私有目录'); return }
      const dir = docDir.replace(/[\\/]+$/, '')
      const absPath = `${dir}/${name}`
      const File = plus.android.importClass('java.io.File')
      const FileOutputStream = plus.android.importClass('java.io.FileOutputStream')
      new File(dir).mkdirs()
      const out = new FileOutputStream(absPath)
      if (!out) { fail('无法创建沙盒临时文件'); return }
      const how = copyStream(input, out)
      console.log('[file.js] 导入文件复制方式:', how)
      out.flush()
      out.close()
      input.close()
    } catch (e) {
      fail(`复制文件到沙盒失败: ${e && e.message}`)
      return
    }
    plus.io.resolveLocalFileSystemURL(`_doc/${name}`, (entry) => {
      onOk(entry, name)
    }, () => fail('沙盒临时文件解析失败'))
  }, () => fail('无法访问应用私有目录'))
  // #endif
}

/**
 * 把输入流的全部内容写进输出流。
 *
 * 关键点：Native.js 只给「已经 importClass 的类」的方法生成 JS 代理，
 * openInputStream / new FileInputStream 返回的流实例在 JS 里默认连 read 都没有
 * （日志表现为 "input.read is not a function"），所以这里先补上流的 importClass。
 * 另外实例代理只认「类自己声明的方法」：AutoCloseInputStream 没声明 transferTo，
 * 所以下面按可靠性依次尝试几种原生写法，谁成功会打到 console 里。
 */
function copyStream(input, out) {
  // #ifdef APP-PLUS
  plus.android.importClass('java.io.InputStream')
  plus.android.importClass('java.io.OutputStream')
  // 写法一：InputStream.transferTo(OutputStream)（Android 8+）
  if (typeof input.transferTo === 'function') {
    input.transferTo(out)
    return 'transferTo'
  }
  // 写法二：android.os.FileUtils.copy(InputStream, OutputStream)（Android 10+ 静态方法）
  try {
    const n = plus.android.invoke('android.os.FileUtils', 'copy', input, out)
    if (n !== undefined && n !== null) return 'FileUtils.copy'
  } catch (e) {}
  // 写法三：用 invoke 反射调用 transferTo（部分运行时不往实例上挂方法）
  try {
    const n = plus.android.invoke(input, 'transferTo', out)
    if (n !== undefined && n !== null) return 'invoke transferTo'
  } catch (e) {}
  // 写法四：FileChannel.transferFrom(ReadableByteChannel, long, long)
  try {
    const Channels = plus.android.importClass('java.nio.channels.Channels')
    const src = Channels.newChannel(input)
    const channel = out.getChannel()
    if (src && channel) {
      let pos = 0
      for (let i = 0; i < 100000; i++) {
        const n = Number(channel.transferFrom(src, pos, 64 * 1024 * 1024))
        if (!n || n < 0) break
        pos += n
      }
      if (pos > 0) return 'transferFrom'
    }
  } catch (e) {}
  throw new Error('当前运行时不支持流式复制')
  // #endif
}

/* ---------- plus.android SAF 兜底 ---------- */
function pickViaSaf(cb) {
  // #ifdef APP-PLUS
  let launched = false
  try {
    const main = plus.android.runtimeMainActivity()
    const Intent = plus.android.importClass('android.content.Intent')
    const intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.setType('*/*')
    intent.addFlags(1) // FLAG_GRANT_READ_URI_PERMISSION，保证能读选中的文件
    addDownloadHint(intent)
    const reqCode = 0x5A46

    // Native.js 传回的 requestCode / resultCode 可能是 Java 数字对象，用 Number() 转。
    // 个别机型 requestCode 会不一致，所以只要带回了选中的 URI 也照样处理；
    // 完全不相干的结果（既不是我们的请求、也没有数据）直接忽略，千万别清回调。
    main.onActivityResult = function (requestCode, resultCode, data) {
      const matched = Number(requestCode) === reqCode
      const picked = Number(resultCode) === -1 && !!data
      if (!matched && !picked) return

      main.onActivityResult = null
      if (!picked) { cb(null, launched); return }
      try {
        const uri = data.getData()
        cb(uri ? String(uri.toString()) : null, launched)
      } catch (e) {
        cb(null, launched)
      }
    }

    main.startActivityForResult(intent, reqCode)
    launched = true
  } catch (e) {
    console.error('[file.js] 打开系统文件选择器失败:', e && e.message)
    cb(null, false)
  }
  // #endif
}

/** 从 content:// URI 读取，回调 (entry, name, size, isMemory, isTemp) */
function resolveEntryFromUri(uri, onOk, onFail) {
  // #ifdef APP-PLUS
  const main = plus.android.runtimeMainActivity()
  const Uri = plus.android.importClass('android.net.Uri')
  let name = ''
  let size = 0
  try {
    name = queryDisplayName(main, Uri.parse(uri))
    size = querySize(main, Uri.parse(uri))
  } catch (e) {}
  try {
    // 先 importClass，openInputStream 返回的流在 JS 里才会带方法代理
    plus.android.importClass('java.io.InputStream')
    const input = contentResolver().openInputStream(Uri.parse(uri))
    if (!input) { onFail(); return }
    // 保留原扩展名，方便排查沙盒里的临时文件
    const dot = name.lastIndexOf('.')
    copyStreamToDocEntry(input, dot > 0 ? name.slice(dot) : '', (entry, localName) => {
      onOk(entry, name || localName, size, false, true)
    }, onFail)
  } catch (e) {
    console.error('[file.js] 读取 content:// 失败:', e && e.message)
    onFail()
  }
  // #endif
}

/** 用 plus.android 读取原生绝对路径，回调 (entry, name, size, isMemory, isTemp) */
function resolveEntryFromNativePath(path, onOk, onFail) {
  // #ifdef APP-PLUS
  // 优先尝试 plus.io 的多种路径格式（带 file:// 前缀等），
  // 因为 plus.io 内部通过 ContentResolver 能拿到 Android 10+ 沙盒下的一次性读取权
  tryReadViaPlusIO(path, onOk, () => {
    // plus.io 全部失败，最后 fallback 到 java.io 流式复制到沙盒再读
    tryReadViaJavaIO(path, onOk, onFail)
  })
  // #endif
}

/** 尝试用 plus.io 的多种路径格式读取 */
function tryReadViaPlusIO(path, onOk, onFail) {
  // #ifdef APP-PLUS
  const candidates = []
  if (path.indexOf('file://') !== 0) {
    candidates.push(`file://${path}`)  // file:///storage/...
  }
  candidates.push(path)  // 原始路径

  let idx = 0
  /** 依次尝试候选路径（带 1.5s 超时保护） */
  function tryNext() {
    if (idx >= candidates.length) { onFail(); return }
    const p = candidates[idx++]
    let settled = false
    // 超时保护：plus.io 可能卡住不回调
    const timer = setTimeout(() => {
      if (!settled) { settled = true; tryNext() }
    }, 1500)
    plus.io.resolveLocalFileSystemURL(p, (entry) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      onOk(entry, entry.name || pathName(path), 0, false, false)
    }, (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      tryNext()
    })
  }
  tryNext()
  // #endif
}

/** fallback：用 java.io 打开后复制到沙盒（分块读、不进 JS 内存） */
function tryReadViaJavaIO(path, onOk, onFail) {
  // #ifdef APP-PLUS
  try {
    const File = plus.android.importClass('java.io.File')
    const FileInputStream = plus.android.importClass('java.io.FileInputStream')
    plus.android.importClass('java.io.InputStream')
    const input = new FileInputStream(new File(path))
    if (!input) throw new Error(`无法打开文件（路径不可读或没有权限）: ${path}`)
    copyStreamToDocEntry(input, '', (entry, localName) => {
      onOk(entry, pathName(path) || localName, 0, false, true)
    }, onFail)
  } catch (e) {
    console.error('[file.js] java.io 读取失败:', e && e.message)
    onFail()
  }
  // #endif
}

/* ---------- plus.android 底层辅助 ---------- */

function queryDisplayName(main, uri) {
  try {
    const Uri = plus.android.importClass('android.net.Uri')
    plus.android.importClass('android.database.Cursor')
    const u = typeof uri === 'string' ? Uri.parse(uri) : uri
    const resolver = contentResolver()
    const cursor = resolver.query(u, null, null, null, null)
    if (cursor && cursor.moveToFirst()) {
      const idx = cursor.getColumnIndex('_display_name')
      const name = idx >= 0 ? String(cursor.getString(idx)) : ''
      cursor.close()
      return name
    }
    if (cursor) cursor.close()
  } catch (e) {}
  return ''
}

/** 从 SAF content:// URI 查询文件大小 */
function querySize(main, uri) {
  try {
    plus.android.importClass('android.database.Cursor')
    const resolver = contentResolver()
    const cursor = resolver.query(uri, null, null, null, null)
    if (cursor && cursor.moveToFirst()) {
      const idx = cursor.getColumnIndex('_size')
      if (idx >= 0) {
        const size = cursor.getLong(idx)
        cursor.close()
        return Number(size)
      }
      cursor.close()
    }
  } catch (e) {}
  return 0
}

/* ==================== 导出到公共 Download（MediaStore / legacy） ==================== */

/** 获取 Android SDK 版本号 */
function getSdkInt() {
  // #ifdef APP-PLUS
  try {
    const Build = plus.android.importClass('android.os.Build')
    const v = Build.VERSION.SDK_INT
    if (v != null) return Number(v)
  } catch (e) {}
  // #endif
  return 0
}

/**
 * 获取 ContentResolver。
 * Native.js 不会自动反射实例方法，必须先 importClass 导入类，
 * 否则会出现 resolver.openInputStream is not a function。
 */
function contentResolver() {
  // #ifdef APP-PLUS
  const main = plus.android.runtimeMainActivity()
  plus.android.importClass('android.content.ContentResolver')
  return main.getContentResolver()
  // #endif
  return null
}

/** Android 10+：通过 MediaStore 写入公共 Download 目录，无需存储权限 */
function saveViaMediaStore(content, filename, cb) {
  // #ifdef APP-PLUS
  const ContentValues = plus.android.importClass('android.content.ContentValues')
  const Uri = plus.android.importClass('android.net.Uri')
  const OutputStreamWriter = plus.android.importClass('java.io.OutputStreamWriter')
  const resolver = contentResolver()
  const values = new ContentValues()
  values.put('_display_name', filename)
  values.put('mime_type', 'application/json')
  values.put('relative_path', 'Download/')
  const uri = resolver.insert(Uri.parse('content://media/external/downloads'), values)
  if (!uri) { cb(false); return }
  const os = resolver.openOutputStream(uri)
  const writer = new OutputStreamWriter(os, 'UTF-8')
  writer.write(content)
  writer.close()
  cb(true)
  // #endif
}

/** Android 6-9：直接写入公共 Download，需要 WRITE_EXTERNAL_STORAGE 权限 */
function saveViaLegacy(content, filename, cb) {
  // #ifdef APP-PLUS
  const Environment = plus.android.importClass('android.os.Environment')
  const File = plus.android.importClass('java.io.File')
  const FileOutputStream = plus.android.importClass('java.io.FileOutputStream')
  const OutputStreamWriter = plus.android.importClass('java.io.OutputStreamWriter')
  const dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
  if (!dir) { cb(false); return }
  const file = new File(dir, filename)
  const fos = new FileOutputStream(file)
  const writer = new OutputStreamWriter(fos, 'UTF-8')
  writer.write(content)
  writer.close()
  cb(true)
  // #endif
}

/* ==================== 导入：选择并读取 JSON 文件 ==================== */

/**
 * App 端选择文本文件：
 * 先列出「手机 Download 目录」里的 JSON 备份，直接点选（最稳，不依赖系统回调）；
 * 第一项固定是「从手机文件中选择…」，可以走系统文件管理器导入任意位置的文件。
 */
function pickTextFileForImport(cb) {
  // #ifdef APP-PLUS
  const backups = listDownloadJsonFiles()
  if (!backups.length) {
    // 没找到备份文件，直接打开系统文件管理器
    chooseViaSystemPicker(cb)
    return
  }
  // 系统菜单最多显示 6 项：1 个「从手机文件中选择」+ 5 个最新备份
  const names = backups.slice(0, 5).map((f) => f.name)
  uni.showActionSheet({
    itemList: ['从手机文件中选择…'].concat(names),
    success: (res) => {
      if (res.tapIndex === 0) {
        chooseViaSystemPicker(cb)
        return
      }
      const target = backups[res.tapIndex - 1]
      const file = readTextByUri(target.uri, target.path)
      if (!file) {
        uni.showToast({ title: '文件读取失败', icon: 'none' })
        cb(null)
        return
      }
      cb({ content: cleanBom(file.content), name: file.name || target.name })
    },
    fail: () => cb(null)
  })
  // #endif
}

/** 打开系统文件管理器（SAF）选择任意位置的文件 */
function chooseViaSystemPicker(cb) {
  // #ifdef APP-PLUS
  pickFileViaSaf((uri) => {
    if (!uri) {
      uni.showToast({ title: '未选择文件', icon: 'none' })
      cb(null)
      return
    }
    const file = readTextByUri(uri, '')
    if (!file) {
      uni.showToast({ title: '文件读取失败', icon: 'none' })
      cb(null)
      return
    }
    cb({ content: cleanBom(file.content), name: file.name })
  })
  // #endif
}

/** 去掉记事本等编辑器加在开头的 BOM，否则 JSON.parse 会失败 */
function cleanBom(text) {
  return String(text).replace(/^\uFEFF/, '').trim()
}

/** 列出 Download 目录里的 JSON 文件（Android 10+ 走 MediaStore，老系统直接读目录） */
function listDownloadJsonFiles() {
  // #ifdef APP-PLUS
  const list = []
  if (getSdkInt() >= 29) {
    try {
      const Uri = plus.android.importClass('android.net.Uri')
      plus.android.importClass('android.database.Cursor')
      const resolver = contentResolver()
      const collection = Uri.parse('content://media/external/downloads')
      // projection / selection 传 null，避免 Native.js 数组参数转换出问题，取回后在 JS 里筛 .json
      const cursor = resolver.query(collection, null, null, null, '_id DESC')
      if (cursor) {
        const idIndex = cursor.getColumnIndex('_id')
        const nameIndex = cursor.getColumnIndex('_display_name')
        while (cursor.moveToNext()) {
          const name = String(cursor.getString(nameIndex))
          if (!/\.json$/i.test(name)) continue
          const id = String(cursor.getString(idIndex))
          list.push({ name: name, uri: `content://media/external/downloads/${id}` })
        }
        cursor.close()
      }
    } catch (e) {
      console.error('[file.js] 查询 Download 目录失败:', e && e.message)
    }
    return list
  }
  // Android 6-9：直接读公共 Download 目录
  try {
    const Environment = plus.android.importClass('android.os.Environment')
    const dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    if (!dir) return list
    const files = dir.listFiles()
    if (!files) return list
    for (let i = files.length - 1; i >= 0; i--) {
      const name = String(files[i].getName())
      if (/\.json$/i.test(name)) {
        list.push({ name: name, path: String(files[i].getAbsolutePath()) })
      }
    }
  } catch (e) {
    console.error('[file.js] 读取 Download 目录失败:', e && e.message)
  }
  return list
  // #endif
}

/**
 * 读取文本文件：优先用 content:// uri（MediaStore），否则用本地绝对路径
 * 返回 { name, content }，失败返回 null
 */
function readTextByUri(uri, filePath) {
  // #ifdef APP-PLUS
  try {
    if (uri) {
      const main = plus.android.runtimeMainActivity()
      const Uri = plus.android.importClass('android.net.Uri')
      const resolver = contentResolver()
      const u = Uri.parse(uri)
      const name = queryDisplayName(main, u)
      const stream = resolver.openInputStream(u)
      const text = readStreamText(stream)
      return { name: name, content: text }
    }
    if (filePath) {
      const FileInputStream = plus.android.importClass('java.io.FileInputStream')
      const stream = new FileInputStream(filePath)
      const text = readStreamText(stream)
      const name = filePath.substring(filePath.lastIndexOf('/') + 1)
      return { name: name, content: text }
    }
  } catch (e) {
    console.error('[file.js] 读取文件失败:', e && e.message)
  }
  return null
  // #endif
}

/** 把 Java 输入流转成字符串，调用后自动关闭流 */
function readStreamText(stream) {
  // #ifdef APP-PLUS
  const InputStreamReader = plus.android.importClass('java.io.InputStreamReader')
  const BufferedReader = plus.android.importClass('java.io.BufferedReader')
  const reader = new BufferedReader(new InputStreamReader(stream, 'UTF-8'))
  let out = ''
  let line
  while ((line = reader.readLine()) !== null) {
    out += `${line}\n`
  }
  reader.close()
  return out
  // #endif
}

/* ==================== SAF 系统文件选择器 ==================== */

/** 用 SAF 打开系统文件选择器，选中后回调 content:// URI */
function pickFileViaSaf(cb) {
  // #ifdef APP-PLUS
  try {
    const main = plus.android.runtimeMainActivity()
    const Intent = plus.android.importClass('android.content.Intent')
    const intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
    intent.addCategory(Intent.CATEGORY_OPENABLE)
    intent.setType('*/*')
    intent.addFlags(1) // FLAG_GRANT_READ_URI_PERMISSION，保证能读选中的文件
    addDownloadHint(intent)
    const reqCode = 0x5A46

    // 回调判定规则与上面的 pickViaSaf 相同，这里不再重复说明
    main.onActivityResult = function (requestCode, resultCode, data) {
      const matched = Number(requestCode) === reqCode
      const picked = Number(resultCode) === -1 && !!data
      if (!matched && !picked) return

      main.onActivityResult = null
      if (!picked) { cb(null); return }
      try {
        const uri = data.getData()
        cb(uri ? String(uri.toString()) : null)
      } catch (e) {
        console.error('[file.js] 读取选择结果失败:', e && e.message)
        cb(null)
      }
    }

    main.startActivityForResult(intent, reqCode)
  } catch (e) {
    console.error('[file.js] 打开系统文件选择器失败:', e && e.message)
    cb(null)
  }
  // #endif
}

