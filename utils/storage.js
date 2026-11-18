/**
 * 原生能力适配层：存储
 * ---------------------------------------------------------------
 * 原版用 AndroidShell 桥 + SharedPreferences/SQLite 存取数据。
 * uni-app 里统一改用 uni.getStorageSync / uni.setStorageSync：
 *   - 小配置和大 JSON 都走 uni storage（App 端底层为系统存储，无 5MB 配额限制）
 *   - 备份/恢复需要枚举全部键，用 uni.getStorageInfoSync
 * 保持与原版 storageSet / storageGet / removeStore / listStoreKeys 完全等价的语义。
 */

const NATIVE_STORE_FLAG = '__native_store_v1'

/** 写：空值 = 删除；失败兜底不抛异常 */
export function storageSet(key, value) {
  const v = value == null ? '' : String(value)
  if (v === '') {
    try {
      uni.removeStorageSync(key)
    } catch (e) {}
    return
  }
  try {
    uni.setStorageSync(key, v)
  } catch (e) {
    // 存储空间不足等：提示用户
    try {
      uni.showToast({ title: '存储空间不足，请先备份数据', icon: 'none' })
    } catch (e2) {}
  }
}

/** 读：不存在返回 null */
export function storageGet(key) {
  try {
    const v = uni.getStorageSync(key)
    return v === '' || v == null ? null : v
  } catch (e) {
    return null
  }
}

/** 删除 */
export function removeStore(key) {
  try {
    uni.removeStorageSync(key)
  } catch (e) {}
}

/** 枚举全部键（备份用），过滤内部键 */
export function listStoreKeys() {
  try {
    const info = uni.getStorageInfoSync()
    return (info.keys || []).filter((k) => k.indexOf('__') !== 0)
  } catch (e) {
    return []
  }
}

/** 迁移旧 localStorage 数据到 uni storage（首次升级时调用） */
export function migrateLegacyStorage() {
  try {
    let flag = storageGet(NATIVE_STORE_FLAG)
    if (flag === '1') return
    // #ifdef H5
    if (window.localStorage) {
      const keys = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (k) keys.push(k)
      }
      let moved = 0
      keys.forEach((k) => {
        if (k.indexOf('__') === 0) return
        let v = null
        try { v = window.localStorage.getItem(k) } catch (e) { return }
        if (!v) return
        const cur = storageGet(k)
        if (!cur) {
          try { storageSet(k, v); moved++ } catch (e) {}
        }
      })
      storageSet(NATIVE_STORE_FLAG, '1')
      keys.forEach((k) => {
        try { window.localStorage.removeItem(k) } catch (e) {}
      })
    }
    // #endif
  } catch (e) {
    /* 迁移失败不阻断启动 */
  }
}

/** 判断某个键是否为音频相关（不参与备份） */
export function isAudioStoreKey(key) {
  return (
    key.indexOf('__audio') === 0 ||
    key.indexOf('cet_audio_') === 0 ||
    key.indexOf('__cet_audio') === 0
  )
}

export { NATIVE_STORE_FLAG }
