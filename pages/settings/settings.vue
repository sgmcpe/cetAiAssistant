<template>
  <AppShell page-id="settingsPage" :tabbar="!audioImporting">
    <SectionCard>
      <!-- 考试类型 -->
      <view class="select-title-row" id="levelSelectRow">
        <label>考试类型</label>
        <view class="level-switch" id="levelSwitch">
          <button class="level-option" :class="{ active: level === '4' }" data-level="4" @click="applyLevel('4')">四级</button>
          <button class="level-option" :class="{ active: level === '6' }" data-level="6" @click="applyLevel('6')">六级</button>
        </view>
      </view>

      <!-- 练习类型 -->
      <view class="select-title-row mode-switch-row">
        <label>练习类型</label>
        <view class="level-switch mode-switch" id="modeSwitch">
          <button class="level-option" :class="{ active: mode === 'listening' }" data-mode="listening" @click="applyMode('listening')">听力</button>
          <button class="level-option" :class="{ active: mode === 'reading' }" data-mode="reading" @click="applyMode('reading')">阅读</button>
          <button class="level-option" :class="{ active: mode === 'writing' }" data-mode="writing" @click="applyMode('writing')">写作</button>
          <button class="level-option" :class="{ active: mode === 'translation' }" data-mode="translation" @click="applyMode('translation')">翻译</button>
        </view>
      </view>

      <!-- 题型 / 听力题型 -->
      <view class="select-title-row type-switch-row" :class="{ 'is-hidden': mode !== 'reading' && mode !== 'listening' }">
        <label>{{ mode === 'listening' ? '听力题型' : '选择题型' }}</label>
        <view class="level-switch" id="typeSwitch">
          <template v-if="mode === 'reading'">
            <button class="level-option" :class="{ active: examType === 'careful' }" data-type="careful" @click="applyExamType('careful')">仔细阅读</button>
            <button class="level-option" :class="{ active: examType === 'long' }" data-type="long" @click="applyExamType('long')">段落匹配</button>
          </template>
          <template v-if="mode === 'listening'">
            <button v-for="t in listenTypes" :key="t" class="level-option"
                    :class="{ active: t === listenType }" @click="applyListenType(t)">{{ t }}</button>
          </template>
        </view>
      </view>

      <!-- 当前已选择 -->
      <view id="currentExamHint" class="current-exam-hint">
        <text class="current-exam-hint-label">当前已选择{{ hintText }}</text>
        <text class="current-exam-hint-value">{{ examValue }}</text>
      </view>

      <view class="picker-row">
        <button id="openPickerBtn" class="picker-btn" @click="openPicker">选择题库</button>
      </view>
    </SectionCard>

    <!-- DeepSeek / 腾讯云密钥 -->
    <SectionCard label="DeepSeek Api（必填）">
      <input type="text" class="token-secure" placeholder="sk-xxxxxxxx..." v-model="token" />

      <view class="field-note api-section-note">（选填，用于一句话语音识别）</view>
      <label class="token-label-gap">腾讯云 SecretId</label>
      <input type="text" placeholder="SecretId" v-model="tencentId" />

      <label class="token-label-gap">腾讯云 SecretKey</label>
      <input type="text" class="token-secure" placeholder="SecretKey" v-model="tencentKey" />

      <button id="saveSettingsBtn" @click="saveSettings">保存设置</button>
    </SectionCard>

    <!-- AI 范围 -->
    <SectionCard card-class="ai-scope-area" label="聊天时 AI 可读取到的部分">
      <view class="ai-scope-row" id="aiScopeRow">
        <view class="ai-scope-option" :class="{ active: aiScope === 'full' }" @click="applyAiScope('full')">
          <view class="ai-scope-dot"></view>
          <text>全文</text>
        </view>
        <view class="ai-scope-option" :class="{ active: aiScope === 'wrong' }" @click="applyAiScope('wrong')">
          <view class="ai-scope-dot"></view>
          <text>错题相关</text>
        </view>
      </view>
      <view class="scope-hint"><text class="scope-hint-strong">全文</text>：AI 可以读取整篇文章和所有题目，代价是聊天回复慢、较为消耗 token。</view>
      <view class="scope-hint"><text class="scope-hint-strong">错题相关</text>：AI 只读取错题相应的段落和题目，但聊天回复速度快、节省 token。</view>
    </SectionCard>

    <!-- 字体大小 -->
    <SectionCard>
      <view class="font-scale-line">
        <label class="font-scale-label">字体大小</label>
        <view class="font-scale-row">
          <!-- id 与原版一致：原 CSS 的 #fontScaleInput 负责把它压成 108px 宽的紧凑输入框，
               少了这个 id 就会退回通用 input 的 100% 宽 + 20px 24px 大内边距 -->
          <input id="fontScaleInput" type="number" min="20" max="160" step="5" inputmode="numeric"
                 v-model="fontPercent" @change="commitFontScale" @blur="commitFontScale" />
          <text class="font-scale-unit">%</text>
        </view>
      </view>
    </SectionCard>

    <!-- 听力音频 -->
    <SectionCard label="听力音频">
      <template #labelExtra>
        <text class="audio-download-link" @click="openExternal(LINK_GITEE)">下载音频</text>
      </template>
      <ActionBar>
        <button class="record-btn" @click="importAudio">导入音频 ZIP</button>
        <button class="record-btn" @click="clearAudio">清空音频</button>
      </ActionBar>
      <HintText text-style="min-height: 1em; margin: 6px 0 0;">{{ audioStatus }}</HintText>
    </SectionCard>

    <!-- 数据备份 -->
    <SectionCard label="数据备份与恢复">
      <ActionBar>
        <button class="record-btn" @click="exportData">备份</button>
        <button class="record-btn" @click="importData">恢复</button>
      </ActionBar>
    </SectionCard>

    <!-- 密钥导入导出 -->
    <SectionCard label="密钥导入与导出">
      <ActionBar>
        <button class="record-btn" @click="exportKeys">导出密钥</button>
        <button class="record-btn" @click="importKeys">导入密钥</button>
      </ActionBar>
      <view class="keys-hint">密钥文件请勿转发给他人。</view>
    </SectionCard>

    <view class="info-card">
      <view class="info-block">
        <text>deepseek的api请前往：</text>
        <text class="info-link" @click="openExternal(LINK_DEEPSEEK)">deepseek开放平台</text>
        <text>创建并充值token</text>
      </view>
      <view class="info-block">
        <text>充值1元 ≈ 判题/讲解上千次</text>
      </view>
      <view class="info-block info-block-gap">
        <text>腾讯云 api 请前往：</text>
        <text class="info-link" @click="openExternal(LINK_TENCENT_ASR)">腾讯云语音识别平台</text>
        <text>进行创建</text>
      </view>
      <view class="info-block">
        <text>每个月能识别5000次</text>
      </view>
    </view>

    <view class="update-link-row"><text class="update-link" @click="openExternal(LINK_GITEE)">检查更新 / 下载最新题库</text></view>

    <AppFooter>意见反馈1320657572@qq.com</AppFooter>

    <!-- 题库清单弹窗 -->
    <template #overlay>
      <!-- 音频导入中：全屏遮罩挡住所有点击（TabBar 同时隐藏），只能等导入结束 -->
      <view v-if="audioImporting" class="audio-import-mask" @click.stop @touchmove.stop.prevent>
        <view class="audio-import-mask-card">
          <view class="audio-import-mask-title">正在导入音频</view>
          <view class="audio-import-mask-text">{{ audioStatus || '请稍候，导入完成前请不要切换页面…' }}</view>
        </view>
      </view>
      <view v-if="pickerVisible" class="picker-modal">
        <view class="picker-panel">
          <view class="picker-header">
            <text class="picker-title">{{ pickerTitle }}</text>
            <button class="picker-close-btn" @click="pickerVisible = false">×</button>
          </view>
          <scroll-view scroll-y class="picker-list">
            <template v-for="group in pickerData" :key="`${group.year}-${group.month}`">
              <view class="picker-month">{{ group.year }}年{{ group.month }}月</view>
              <view v-for="item in group.sets" :key="item.setNo" class="picker-set-row">
                <text class="picker-set-name" @click="pickExam(group.year, group.month, item.setNo, 0)">第{{ item.setNo }}套</text>
                <button v-for="(label, idx) in setLabels(item.exam)" :key="idx"
                        class="picker-part-btn" :class="{ 'picker-all-btn': idx === 0 && isAllBtn() }"
                        @click="pickExam(group.year, group.month, item.setNo, idx)">{{ label }}</button>
              </view>
            </template>
            <view v-if="pickerEmpty" class="picker-empty">当前级别暂无题库</view>
          </scroll-view>
        </view>
      </view>
    </template>
  </AppShell>
</template>

<script setup>
import { ref, computed } from 'vue'
import { onBackPress } from '@dcloudio/uni-app'
import useStore, { STORAGE_KEYS } from '@/store/index'
import { storageGet, storageSet, listStoreKeys, isAudioStoreKey } from '@/utils/storage'
import * as CET from '@/utils/cet'
import { DATA } from '@/utils/exam'
import { chooseFile } from '@/utils/file'
import { extractAudioZip, extractAudioZipNative, initKnownNames } from '@/utils/zip'
import { audioPut, audioNames, audioClear, audioDirAbs } from '@/utils/audio'
import AppShell from '@/components/layout/AppShell.vue'
import SectionCard from '@/components/layout/SectionCard.vue'
import ActionBar from '@/components/layout/ActionBar.vue'
import HintText from '@/components/layout/HintText.vue'
import AppFooter from '@/components/layout/AppFooter.vue'

const state = useStore()

const level = computed(() => state.currentLevel)
const examType = computed(() => state.currentExamType)
const mode = computed(() => state.mode)
const aiScope = computed(() => state.aiScope)
const listenType = computed(() => state.listenType)

const token = ref('')

const tencentId = ref('')
const tencentKey = ref('')
const fontPercent = ref('100')
const audioStatus = ref('')
// 音频导入中：隐藏 TabBar、铺全屏遮罩、拦截返回键，避免中途切页
const audioImporting = ref(false)

const pickerVisible = ref(false)
const pickerTitle = ref('')
const pickerData = ref([])
const pickerEmpty = ref(false)

// 模式中文名；阅读还要按题型细分，所以单独算一个 examTypeLabel
const MODE_LABELS = { listening: '听力', reading: '阅读', writing: '写作', translation: '翻译' }

const examTypeLabel = computed(() => {
  if (mode.value === 'reading') return examType.value === 'long' ? '段落匹配' : '仔细阅读'
  return MODE_LABELS[mode.value] || ''
})

const hintText = computed(() => `${CET.levelName()}${examTypeLabel.value}`)

const examValue = computed(() => {
  const r = CET.resolveExamResult()
  if (r.error) return '未选择'
  const exam = r.exam
  const head = `${exam.year}年${exam.month}月第${CET.cnNum(exam.set)}套`
  const tail = CET.examHintTail()
  return tail ? (mode.value === 'reading' ? `${head}${tail}` : `${head}\n${tail}`) : head
})

const listenTypes = computed(() => (DATA.CET_LISTENING_TYPES || {})[state.currentLevel] || ['长对话', '听力篇章', '讲座'])

/* ---------------- 底部外链（与 HTML 原版 <a target="_blank"> 对齐） ---------------- */
const LINK_DEEPSEEK = 'https://platform.deepseek.com/'
const LINK_TENCENT_ASR = 'https://cloud.tencent.com/product/asr'
// 最底部「检查更新 / 下载最新题库」：原版 href 指向 gitee 仓库
const LINK_GITEE = 'https://gitee.com/sgmc/cet-assistant'

// App 端交给系统浏览器打开；H5 端开新标签页。两端都不走 <a href>，
// 免得 App 的 webview 被直接导航走、回不到应用。
function openExternal(url) {
  // #ifdef APP-PLUS
  plus.runtime.openURL(url)
  // #endif
  // #ifdef H5
  window.open(url, '_blank')
  // #endif
}

function initState() {
  token.value = storageGet(STORAGE_KEYS.TOKEN) || ''

  tencentId.value = storageGet(STORAGE_KEYS.TENCENT_ID) || ''
  tencentKey.value = storageGet(STORAGE_KEYS.TENCENT_KEY) || ''
  const savedLevel = storageGet(STORAGE_KEYS.LEVEL)
  if (savedLevel === '4' || savedLevel === '6') state.currentLevel = savedLevel
  const savedType = storageGet(STORAGE_KEYS.EXAM_TYPE)
  if (savedType === 'careful' || savedType === 'long') state.currentExamType = savedType
  const savedMode = storageGet(STORAGE_KEYS.MODE)
  // 首次进入（还没有保存过模式）默认听力，而不是阅读
  state.mode = ['listening', 'reading', 'writing', 'translation'].includes(savedMode) ? savedMode : 'listening'
  state.listenType = storageGet('cet_listen_type') || (listenTypes.value[0] || '')
  // 字号
  const scale = CET.normalizeFontScale(storageGet(STORAGE_KEYS.FONT_SCALE))
  fontPercent.value = String(Math.round(scale * 100))
  applyFontScale(scale)
  // 恢复选择
  let sel = CET.loadSelection()
  if (!sel) {
    try {
      const last = JSON.parse(storageGet(STORAGE_KEYS.LAST_EXAM) || 'null')
      if (last) sel = { year: last.year, month: last.month, set: last.set, passage: last.passage || '' }
    } catch (e) {}
  }
  if (sel) CET.fillExamInputs(sel)
  // 恢复专项选择
  if (state.mode !== 'reading') {
    try {
      const s = JSON.parse(storageGet(`cet_sel_${state.mode}_${state.currentLevel}`) || 'null')
      if (s && s.year) CET.fillExamInputs(s)
    } catch (e) {}
  }
  CET.ensureSelection()
  state.aiScope = storageGet(STORAGE_KEYS.AI_SCOPE) === 'wrong' ? 'wrong' : 'full'
}

function applyFontScale(scale) {
  // 通过 rpx/全局变量实现，App 端用 plus 或直接写到页面
  // 这里用 CSS 变量 + 全局状态
  state.fontScale = scale
}

function applyLevel(l) {
  if (l === state.currentLevel) return
  state.currentLevel = l
  storageSet(STORAGE_KEYS.LEVEL, l)
  CET.ensureSelection()
  CET.saveSelection()
}

function applyExamType(t) {
  if (t === state.currentExamType) return
  state.currentExamType = t
  storageSet(STORAGE_KEYS.EXAM_TYPE, t)
  if (CET.isLongReading()) state.selPassage = ''
  CET.ensureSelection()
  CET.saveSelection()
  CET.tip(`已切换到${t === 'long' ? '段落匹配' : '仔细阅读'}`)
}

function applyMode(m) {
  state.mode = m
  storageSet(STORAGE_KEYS.MODE, m)
  // 恢复该模式选择
  try {
    const s = JSON.parse(storageGet(`cet_sel_${m}_${state.currentLevel}`) || 'null')
    if (s && s.year) CET.fillExamInputs(s)
  } catch (e) {}
  CET.ensureSelection()
  CET.saveSelection()
  CET.tip(`已切到${MODE_LABELS[m]}`)
}

function applyListenType(t) {
  state.listenType = t
  storageSet('cet_listen_type', t)
  CET.tip(`已切到${t}`)
}

function applyAiScope(v) {
  state.aiScope = v
  storageSet(STORAGE_KEYS.AI_SCOPE, v)
}

function commitFontScale() {
  const r = CET.fontScaleFromPercent(fontPercent.value)
  fontPercent.value = String(r.percent)
  applyFontScale(r.scale)
  storageSet(STORAGE_KEYS.FONT_SCALE, String(r.scale))
}

function saveSettings() {
  const id = tencentId.value.trim()
  const key = tencentKey.value.trim()
  if ((id && !key) || (!id && key)) { CET.tip('腾讯云 SecretId 和 SecretKey 请填写完整'); return }
  storageSet(STORAGE_KEYS.TOKEN, token.value.trim())
  if (id && key) {
    storageSet(STORAGE_KEYS.TENCENT_ID, id)
    storageSet(STORAGE_KEYS.TENCENT_KEY, key)
  }
  CET.tip(id && key ? '已保存腾讯云与 DeepSeek 密钥' : '已保存 DeepSeek 密钥')
}

function openPicker() {
  const data = CET.readingData()
  if (!data) { CET.tip('题库尚未加载完成，请稍候'); return }
  pickerTitle.value = `${CET.levelName()}${examTypeLabel.value}题库清单`
  // 顺序按原版：年份倒序、月份倒序（最新的排最上面）、套号正序。
  // 对象键的顺序是固定的，表达不了倒序，所以在这里拍平成一个数组再渲染
  const groups = []
  Object.keys(data).map(Number).sort((a, b) => b - a).forEach((year) => {
    Object.keys(data[year]).sort((a, b) => Number(b) - Number(a)).forEach((month) => {
      const sets = Object.keys(data[year][month]).sort((a, b) => Number(a) - Number(b))
        .map((setNo) => ({ setNo, exam: data[year][month][setNo] }))
      groups.push({ year, month, sets })
    })
  })
  pickerData.value = groups
  pickerEmpty.value = groups.length === 0
  pickerVisible.value = true
}

function setLabels(exam) {
  if (mode.value === 'reading') {
    // 段落匹配一整套就是一篇文章，只有一个入口（原版文字是「整篇」）
    if (examType.value === 'long') return ['整篇']
    return (exam.passages || []).map((_, i) => `第${i + 1}篇`)
  }
  if (mode.value === 'listening') {
    return (exam.parts || []).filter((p) => p.type === state.listenType).map((p, i) => `第${['一', '二', '三', '四'][p.part - 1]}篇`)
  }
  return ['整套']
}

// 「整套 / 整篇」这种一键选一整套的按钮在原版是绿色的 picker-all-btn；
// 仔细阅读、听力要选具体某篇，是蓝色的 picker-part-btn
function isAllBtn() {
  if (mode.value === 'listening') return false
  if (mode.value === 'reading' && examType.value !== 'long') return false
  return true
}

// 从清单里点选：只把选择回写到当前练习，不直接跳转。
// idx 是「这一套里第几个」的 0 基下标：点套名（第X套）时传 0，等于这一套的第一个（仔细阅读=第1篇）
function pickExam(year, month, setNo, idx) {
  state.selYear = String(year)
  state.selMonth = String(month)
  state.selSet = String(setNo)
  if (mode.value === 'reading' && examType.value !== 'long') {
    state.selPassage = String(idx + 1)
  } else if (mode.value === 'listening') {
    // idx 是筛选后 part 的全局序号
    const data = CET.readingData()
    const exam = data[year][month][setNo]
    const parts = (exam.parts || []).filter((p) => p.type === state.listenType)
    const globalIdx = exam.parts.indexOf(parts[idx]) + 1
    state.selPassage = String(globalIdx)
  } else {
    state.selPassage = ''
  }
  CET.saveSelection()
  pickerVisible.value = false
}

async function importAudio() {
  const file = await chooseFile('.zip')
  if (!file) {
    CET.tip('未选择文件或文件无法读取')
    return
  }
  // 导入期间锁定页面：隐藏 TabBar、全屏遮罩、拦截返回键
  audioImporting.value = true
  // 初始化已知音频文件名（用于 ZIP 中文名编码校正）
  initKnownNames(DATA.CET_AUDIO_MANIFEST)
  audioStatus.value = '正在读取音频包…'
  try {
    // #ifdef APP-PLUS
    // App 端交给 Java 原生解压：JS 引擎读二进制要经 base64，大包必然 OOM
    const targetDir = audioDirAbs()
    if (!targetDir || !file.absPath) throw new Error('无法定位沙盒目录')
    const result = await extractAudioZipNative(file.absPath, file.read, file.size, targetDir, (done, total) => {
      audioStatus.value = `正在导入 ${done} / ${total}，请稍等…`
    })
    // #endif
    // #ifndef APP-PLUS
    const result = await extractAudioZip(file.read, file.size, (done, total) => {
      audioStatus.value = `正在导入 ${done} / ${total}，请稍等…`
    }, async (name, data, type) => {
      await audioPut(name, data, type)
    })
    // #endif
    // 原生解压会直接告诉我们存了多少 mp3，省得再扫一遍目录（目录文件多时 plus.io 会读得很慢）
    let imported = typeof result.mp3 === 'number' ? result.mp3 : -1
    if (imported < 0) {
      const names = await audioNames()
      imported = names.filter((n) => /\.mp3$/i.test(n)).length
    }
    state.audioImported = imported
    console.log('[importAudio] 结果', JSON.stringify(result), '已存音频数', state.audioImported)
    const failedPart = result.failed ? `，${result.failed} 个读取失败` : ''
    CET.tip(`已导入 ${result.done} 个音频/字幕文件${failedPart}（不进入备份）`)
  } catch (err) {
    console.error('[importAudio] 失败:', err && err.message)
    CET.tip(`音频导入失败：${err.message}`)
  } finally {
    audioImporting.value = false
    audioStatus.value = ''
    // 释放「音频」沙箱大小，避免临时压缩包
    if (typeof file.cleanup === 'function') file.cleanup()
  }
}

// 导入音频期间禁止返回 / 侧滑退出，只能等导入完成
onBackPress(() => {
  if (audioImporting.value) {
    CET.tip('音频导入中，请稍候…')
    return true
  }
})

async function clearAudio() {
  const ok = await CET.uiConfirm('确定清空全部听力音频吗？清空后需重新导入 ZIP。', { danger: true, okText: '清空' })
  if (!ok) return
  await audioClear()
  state.audioImported = 0
  CET.tip('已清空音频')
}

function exportData() {
  const snap = {}
  CET.appStorageKeys().forEach((key) => {
    const v = storageGet(key)
    if (v != null) snap[key] = v
  })
  const backup = {
    app: 'cetassistant', kind: 'fullBackup', version: 1,
    exportedAt: new Date().toISOString(),
    keys: Object.keys(snap), data: {}, snap
  }
  CET.saveTextFile(JSON.stringify(backup, null, 2), `四六级备考助手-数据备份-${CET.backupStamp()}.json`)
  CET.tip(`已备份 ${Object.keys(snap).length} 项本地数据`)
}

async function importData() {
  const file = await CET.chooseTextFile()
  if (!file) { CET.tip('未选择文件'); return }

  let backup = null
  try {
    // 去掉开头 BOM，否则 JSON.parse 会直接报错
    backup = JSON.parse(String(file.content).replace(/^\uFEFF/, '').trim())
  } catch (e) {
    CET.tip('文件读取失败：不是有效的 JSON 文件')
    return
  }
  if (!backup || typeof backup !== 'object') { CET.tip('不是有效的备份文件'); return }
  // 和原版一样先认文件类型，误选「密钥 / 单项导出」时绝不能清空数据
  if (backup.kind && backup.kind !== 'fullBackup') {
    CET.tip('这是单项导出文件，请选择「数据备份与恢复」导出的整体备份')
    return
  }
  if (backup.type === 'keys') { CET.tip('这是密钥文件，请选择整体备份'); return }

  const snap = (backup.snap && typeof backup.snap === 'object' && !Array.isArray(backup.snap)) ? backup.snap : null
  const legacy = (backup.data && typeof backup.data === 'object' && !Array.isArray(backup.data)) ? backup.data : null
  if (!snap && !legacy) { CET.tip('不是本软件导出的备份文件'); return }

  const ok = await CET.uiConfirm('恢复会先清空软件内全部原有数据，再按备份还原：练习类型、题型、题库选择与进度、作答、错题本、生词库、练习记录、字体大小、AI 阅读范围、DeepSeek Token、腾讯云语音密钥等。自行导入的听力音频不参与备份，也不会被清空。确定继续吗？', { okText: '继续恢复' })
  if (!ok) return

  try {
    // 先清空，再按备份写回
    CET.appStorageKeys().forEach((key) => storageSet(key, ''))
    if (snap) {
      Object.keys(snap).forEach((key) => {
        if (snap[key] != null && String(snap[key]) !== '') storageSet(key, String(snap[key]))
      })
    } else {
      Object.keys(legacy).forEach((k) => {
        if (STORAGE_KEYS[k] && legacy[k] != null) storageSet(STORAGE_KEYS[k], String(legacy[k]))
      })
    }
    initState()
    CET.tip('恢复成功')
  } catch (e) {
    CET.tip(`恢复失败：${e.message}`)
  }
}

function exportKeys() {
  const data = {}
  let hasAny = false
  ;['TOKEN', 'TENCENT_ID', 'TENCENT_KEY'].forEach((k) => {
    data[k] = storageGet(STORAGE_KEYS[k]) || ''
    if (data[k]) hasAny = true
  })
  if (!hasAny) { CET.tip('还没有填写任何密钥，不用导出'); return }
  CET.saveTextFile(JSON.stringify({ app: 'cetassistant', kind: 'keys', data }, null, 2), `四六级备考助手-密钥-${CET.backupStamp()}.json`)
}

async function importKeys() {
  const file = await CET.chooseTextFile()
  if (!file) return
  try {
    const payload = JSON.parse(file.content)
    const data = payload.data || {}
    const incoming = {}
    ;['TOKEN', 'TENCENT_ID', 'TENCENT_KEY'].forEach((k) => {
      if (data[k] != null && String(data[k]).trim() !== '') incoming[k] = String(data[k]).trim()
    })
    if (!incoming.TOKEN && !incoming.TENCENT_ID && !incoming.TENCENT_KEY) { CET.tip('文件里没找到可用的密钥'); return }
    Object.keys(incoming).forEach((k) => storageSet(STORAGE_KEYS[k], incoming[k]))
    initState()
    CET.tip('密钥导入成功')
  } catch (e) {
    CET.tip(`导入失败：${e.message}`)
  }
}

initState()
</script>
