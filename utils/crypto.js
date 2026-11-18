/**
 * 纯 JS SHA-256 与 HMAC-SHA256 实现
 * 用于 App 端（无 WebCrypto）时腾讯云 ASR 的 TC3 签名
 * 标准 FIPS 180-4 / RFC 2104 实现，无外部依赖
 */

/* ---------- SHA-256 ---------- */
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]

function rotr(x, n) {
  return (x >>> n) | (x << (32 - n))
}

function utf8Encode(str) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str)
  }
  const out = []
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i)
    if (c < 0x80) {
      out.push(c)
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c < 0xd800 || c >= 0xe000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    } else {
      i++
      c = 0x10000 + (((c & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff))
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  }
  return new Uint8Array(out)
}

/**
 * 计算 SHA-256 哈希，返回十六进制字符串
 * @param {string|Uint8Array|ArrayBuffer} str 输入数据
 * @returns {string} 十六进制哈希值
 */
export function sha256(str) {
  const data = typeof str === 'string' ? utf8Encode(str) : new Uint8Array(str)
  const bitLen = data.length * 8
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64)
  padded.set(data)
  padded[data.length] = 0x80
  // 写入 64 位大端长度
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  padded[padded.length - 8] = (hi >>> 24) & 0xff
  padded[padded.length - 7] = (hi >>> 16) & 0xff
  padded[padded.length - 6] = (hi >>> 8) & 0xff
  padded[padded.length - 5] = hi & 0xff
  padded[padded.length - 4] = (lo >>> 24) & 0xff
  padded[padded.length - 3] = (lo >>> 16) & 0xff
  padded[padded.length - 2] = (lo >>> 8) & 0xff
  padded[padded.length - 1] = lo & 0xff

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19

  const w = new Array(64)
  for (let i = 0; i < padded.length; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = (padded[i + t * 4] << 24) | (padded[i + t * 4 + 1] << 16) | (padded[i + t * 4 + 2] << 8) | padded[i + t * 4 + 3]
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3)
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10)
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const temp1 = (h + S1 + ch + K[t] + w[t]) | 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + temp1) | 0
      d = c; c = b; b = a; a = (temp1 + temp2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }

  const hex = [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
  return hex
}

/* ---------- HMAC-SHA256 ---------- */
/**
 * 计算 HMAC-SHA256，返回十六进制字符串（腾讯云 TC3 签名用）
 * @param {string|Uint8Array|ArrayBuffer} key 密钥
 * @param {string|Uint8Array} msg 消息
 * @returns {string} 十六进制 HMAC
 */
export function hmacSha256(key, msg) {
  const blockSize = 64
  let keyBytes
  if (typeof key === 'string') {
    keyBytes = utf8Encode(key)
  } else if (key instanceof ArrayBuffer) {
    keyBytes = new Uint8Array(key)
  } else {
    keyBytes = new Uint8Array(key)
  }
  if (keyBytes.length > blockSize) {
    keyBytes = hexToBytes(sha256(keyBytes))
  }
  const iKeyPad = new Uint8Array(blockSize)
  const oKeyPad = new Uint8Array(blockSize)
  for (let i = 0; i < blockSize; i++) {
    const k = i < keyBytes.length ? keyBytes[i] : 0
    iKeyPad[i] = k ^ 0x36
    oKeyPad[i] = k ^ 0x5c
  }
  const msgBytes = typeof msg === 'string' ? utf8Encode(msg) : new Uint8Array(msg)
  const inner = new Uint8Array(blockSize + msgBytes.length)
  inner.set(iKeyPad)
  inner.set(msgBytes, blockSize)
  const innerHash = hexToBytes(sha256(inner))
  const outer = new Uint8Array(blockSize + innerHash.length)
  outer.set(oKeyPad)
  outer.set(innerHash, blockSize)
  return sha256(outer)
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

/**
 * 十六进制字符串转 Uint8Array
 * @param {string} hex 十六进制字符串
 * @returns {Uint8Array}
 */
export function hexToBytesPublic(hex) {
  return hexToBytes(hex)
}

/* ---------- SHA-1（腾讯云实时语音识别签名用） ---------- */
/**
 * 计算 SHA-1 哈希，返回十六进制字符串（腾讯云 ASR 实时识别签名用）
 * @param {string|Uint8Array|ArrayBuffer} str 输入数据
 * @returns {string} 十六进制哈希
 */
export function sha1(str) {
  const data = typeof str === 'string' ? utf8Encode(str) : new Uint8Array(str)
  const bitLen = data.length * 8
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64)
  padded.set(data)
  padded[data.length] = 0x80
  const n = padded.length
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  padded[n - 8] = (hi >>> 24) & 0xff
  padded[n - 7] = (hi >>> 16) & 0xff
  padded[n - 6] = (hi >>> 8) & 0xff
  padded[n - 5] = hi & 0xff
  padded[n - 4] = (lo >>> 24) & 0xff
  padded[n - 3] = (lo >>> 16) & 0xff
  padded[n - 2] = (lo >>> 8) & 0xff
  padded[n - 1] = lo & 0xff

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Array(80)
  for (let i = 0; i < n; i += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] = (padded[i + t * 4] << 24) | (padded[i + t * 4 + 1] << 16) |
        (padded[i + t * 4 + 2] << 8) | padded[i + t * 4 + 3]
    }
    for (let t = 16; t < 80; t++) {
      const x = w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16]
      w[t] = (x << 1) | (x >>> 31)
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4
    for (let t = 0; t < 80; t++) {
      let f, k
      if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999 } else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1 } else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc } else { f = b ^ c ^ d; k = 0xca62c1d6 }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[t]) | 0
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = temp
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0
  }
  return [h0, h1, h2, h3, h4].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('')
}

/* ---------- HMAC-SHA1 ---------- */
/**
 * 计算 HMAC-SHA1，返回十六进制字符串
 * @param {string|Uint8Array|ArrayBuffer} key 密钥
 * @param {string|Uint8Array} msg 消息
 * @returns {string} 十六进制 HMAC
 */
export function hmacSha1(key, msg) {
  const blockSize = 64
  let keyBytes
  if (typeof key === 'string') {
    keyBytes = utf8Encode(key)
  } else if (key instanceof ArrayBuffer) {
    keyBytes = new Uint8Array(key)
  } else {
    keyBytes = new Uint8Array(key)
  }
  if (keyBytes.length > blockSize) keyBytes = hexToBytes(sha1(keyBytes))
  const iKeyPad = new Uint8Array(blockSize)
  const oKeyPad = new Uint8Array(blockSize)
  for (let i = 0; i < blockSize; i++) {
    const k = i < keyBytes.length ? keyBytes[i] : 0
    iKeyPad[i] = k ^ 0x36
    oKeyPad[i] = k ^ 0x5c
  }
  const msgBytes = typeof msg === 'string' ? utf8Encode(msg) : new Uint8Array(msg)
  const inner = new Uint8Array(blockSize + msgBytes.length)
  inner.set(iKeyPad)
  inner.set(msgBytes, blockSize)
  const innerHash = hexToBytes(sha1(inner))
  const outer = new Uint8Array(blockSize + innerHash.length)
  outer.set(oKeyPad)
  outer.set(innerHash, blockSize)
  return sha1(outer)
}

/**
 * 计算 HMAC-SHA1 并返回 Base64（腾讯云 ASR 实时识别签名用）
 * @param {string} key 密钥
 * @param {string} msg 消息
 * @returns {string} Base64 HMAC
 */
export function hmacSha1Base64(key, msg) {
  return bytesToBase64(hexToBytes(hmacSha1(key, msg)))
}

/* ---------- Base64 ---------- */
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Uint8Array → Base64 编码
 * @param {Uint8Array} bytes 输入字节数组
 * @returns {string} Base64 字符串
 */
export function bytesToBase64(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined
    out += B64_CHARS[b0 >> 2]
    out += B64_CHARS[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)]
    out += b1 === undefined ? '=' : B64_CHARS[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)]
    out += b2 === undefined ? '=' : B64_CHARS[b2 & 63]
  }
  return out
}

let b64Lookup = null
function getB64Lookup() {
  if (b64Lookup) return b64Lookup
  b64Lookup = new Int16Array(128).fill(-1)
  for (let i = 0; i < B64_CHARS.length; i++) b64Lookup[B64_CHARS.charCodeAt(i)] = i
  return b64Lookup
}

/**
 * Base64 字符串 → Uint8Array 解码
 * @param {string} str Base64 字符串
 * @returns {Uint8Array}
 */
export function base64ToBytes(str) {
  const s = String(str || '').replace(/=+$/, '')
  const lookup = getB64Lookup()
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let p = 0
  for (let i = 0; i < s.length; i += 4) {
    const n0 = lookup[s.charCodeAt(i)] || 0
    const n1 = lookup[s.charCodeAt(i + 1)] || 0
    const n2 = i + 2 < s.length ? (lookup[s.charCodeAt(i + 2)] || 0) : 0
    const n3 = i + 3 < s.length ? (lookup[s.charCodeAt(i + 3)] || 0) : 0
    out[p++] = (n0 << 2) | (n1 >> 4)
    if (i + 2 < s.length) out[p++] = ((n1 & 15) << 4) | (n2 >> 2)
    if (i + 3 < s.length) out[p++] = ((n2 & 3) << 6) | n3
  }
  return out.slice(0, p)
}
