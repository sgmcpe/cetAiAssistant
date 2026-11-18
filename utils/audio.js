/**
 * 听力音频库（App 端 plus.io 文件系统存储）
 * ---------------------------------------------------------------
 * 原版用 IndexedDB 存 Blob；uni-app App 端无 IndexedDB，
 * 改用 plus.io 应用私有文档目录（_doc/audio/）存音频文件。
 * 音频不参与备份，清空只删文件目录。
 *
 * 存储结构：
 *   _doc/audio/<文件名>   （mp3 / srt）
 * 播放时用 file:// 路径挂到 <audio> 的 src 上。
 */

import { writeAppFile } from '@/utils/file'

const AUDIO_DIR = '_doc/audio/'

/** 音频目录的原生绝对路径（以 / 结尾）；非 App 端返回空串 */
export function audioDirAbs() {
  // #ifdef APP-PLUS
  try {
    const abs = plus.io.convertLocalFileSystemURL(AUDIO_DIR)
    if (abs) return `${abs.replace(/[\\/]+$/, '')}/`
  } catch (e) {}
  // #endif
  return ''
}

/** 确保音频目录存在，返回目录 entry（Promise） */
function ensureAudioDir() {
  return new Promise((resolve, reject) => {
    plus.io.resolveLocalFileSystemURL(AUDIO_DIR, (entry) => {
      resolve(entry)
    }, () => {
      // 不存在则创建
      plus.io.resolveLocalFileSystemURL('_doc/', (root) => {
        root.getDirectory('audio', { create: true }, (dir) => resolve(dir), reject)
      }, reject)
    })
  })
}

/**
 * 写入一个音频/字幕文件
 * @param {string} name 文件名
 * @param {ArrayBuffer|Uint8Array} data 文件内容
 * @param {string} type mime 类型（mp3 / srt）
 */
export async function audioPut(name, data, type) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data)
  // #ifdef APP-PLUS
  // plus.io 的 FileWriter 写不了二进制（ArrayBuffer 会写成 0 字节），改走 Java 落盘
  const absDir = plus.io.convertLocalFileSystemURL(AUDIO_DIR)
  if (absDir) {
    const absPath = `${absDir.replace(/[\\/]+$/, '')}/${name}`
    if (writeAppFile(absPath, u8)) return
  }
  // #endif
  const dir = await ensureAudioDir()
  return new Promise((resolve, reject) => {
    dir.getFile(name, { create: true }, (fileEntry) => {
      fileEntry.createWriter((writer) => {
        writer.onwrite = () => resolve()
        writer.onerror = () => reject(new Error('写音频文件失败'))
        // 把 Uint8Array/ArrayBuffer 转成 blob 写
        const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        writer.write(buf)
      }, () => reject(new Error('创建写句柄失败')))
    }, () => reject(new Error('创建文件失败')))
  })
}

/**
 * 读取音频文件的 file:// 路径（播放用）
 */
export async function audioUrl(name) {
  const dir = await ensureAudioDir()
  return new Promise((resolve, reject) => {
    dir.getFile(name, {}, (fileEntry) => {
      // fileEntry.toLocalURL() / toRemoteURL()
      const url = fileEntry.toLocalURL ? fileEntry.toLocalURL() : (fileEntry.toURL ? fileEntry.toURL() : null)
      resolve(url)
    }, () => resolve(null))
  })
}

/**
 * 列出所有已导入的音频/字幕文件名
 */
export async function audioNames() {
  const dir = await ensureAudioDir()
  return new Promise((resolve) => {
    const names = []
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(names)
    }
    // plus.io 的 readEntries 在目录里文件多的时候偶尔不回调（实测会把导入流程一直卡住），
    // 加个兜底：超时就返回已经读到的部分，不能让调用方永远等下去
    const timer = setTimeout(finish, 4000)
    const reader = dir.createReader()
    function readEntries() {
      if (settled) return
      reader.readEntries((entries) => {
        if (settled) return
        if (!entries.length) { finish(); return }
        entries.forEach((e) => {
          if (e.isFile) names.push(e.name)
        })
        readEntries()
      }, finish)
    }
    readEntries()
  })
}

/**
 * 读取字幕文件的文本内容
 */
export async function audioGetText(name) {
  const dir = await ensureAudioDir()
  return new Promise((resolve, reject) => {
    dir.getFile(name, {}, (fileEntry) => {
      fileEntry.file((file) => {
        const fr = new plus.io.FileReader()
        fr.onloadend = (e) => resolve(e.target.result)
        fr.onerror = () => reject(new Error('读字幕失败'))
        fr.readAsText(file, 'utf-8')
      }, reject)
    }, () => resolve(null))
  })
}

/**
 * 清空音频库（删除 audio 目录下所有文件）
 */
export async function audioClear() {
  const dir = await ensureAudioDir()
  return new Promise((resolve) => {
    const reader = dir.createReader()
    const entries = []
    function readEntries() {
      reader.readEntries((ents) => {
        if (!ents.length) {
          // 逐个删除
          entries.forEach((e) => {
            try {
              if (e.isFile) e.remove(() => {}, () => {})
              else e.removeRecursively(() => {}, () => {})
            } catch (err) {}
          })
          resolve()
          return
        }
        entries.push(...ents)
        readEntries()
      }, () => resolve())
    }
    readEntries()
  })
}
