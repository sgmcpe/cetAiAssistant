<template>
  <AppShell page-id="mistakePage">
    <PageTitle title="错题本" />

    <ActionBar variant="record">
      <button class="download-record-btn" @click="importMistakes">新增</button>
      <button class="download-record-btn" @click="exportMistakes">导出</button>
      <button class="clear-record-btn" @click="clearMistakes">清空</button>
    </ActionBar>

    <view class="select-area">
      <view class="select-title-row">
        <text>筛选错题</text>
        <button class="picker-btn" @click="openMistakePicker">题库清单</button>
      </view>
    </view>

    <view class="record-list">
      <view v-if="sortedMistakes.length === 0" class="empty-tip">{{ emptyTip }}</view>
      <!-- 外层一张卡片 + 一个大标题，点击整体展开/收起；展开后所有题连在一起，每题内容直接显示 -->
      <view v-else class="fav-item mistake-card" :class="{ expanded: cardOpen }">
        <view class="fav-source" @click="cardOpen = !cardOpen">
          <view class="mistake-card-title">
            <text>{{ headerLines[0] }}</text>
            <text class="mistake-card-title-2">{{ headerLines[1] }}</text>
          </view>
          <text class="fav-toggle">{{ cardOpen ? '▼ 收起' : '▶ 展开' }}</text>
        </view>
        <button class="delete-fav trash-btn" @click="clearCardMistakes"><view class="trash-icon"></view></button>
        <view v-if="cardOpen" class="mistake-card-body">
          <view v-for="(m, i) in sortedMistakes" :key="i" class="mistake-q">
            <view class="mistake-q-head">
              <text class="mistake-q-no">{{ m.no ? '第 ' + m.no + ' 题' : mistakeSourceLabel(m) }}</text>
            </view>
            <view class="fav-body">
              <view v-if="m.stem" class="fav-question">{{ m.stem }}</view>
              <view class="fav-options">
                <view v-for="(key, idx) in optionKeys(m.options)" :key="idx" class="mistake-option"
                      :class="{ 'option-right': key === m.answer, 'option-wrong': key === m.my }">
                  <text class="mistake-option-key">{{ key }})</text> {{ m.options[key] || '' }}
                </view>
              </view>
              <view class="fav-answer">正确答案：{{ m.answer }}　你的答案：{{ m.my || '未作答' }}</view>
              <view v-if="m.analysis" class="fav-analysis">解析：{{ m.analysis }}</view>
            </view>
          </view>
          <view class="collapse-foot" @click="cardOpen = false">
            <text class="collapse-foot-btn">▲ 收起</text>
          </view>
        </view>
      </view>
    </view>

    <AppFooter />
  </AppShell>
</template>

<script setup>
import { ref, computed } from 'vue'
import useStore, { STORAGE_KEYS } from '@/store/index'
import * as CET from '@/utils/cet'
import { storageGet, storageSet } from '@/utils/storage'
import AppShell from '@/components/layout/AppShell.vue'
import PageTitle from '@/components/layout/PageTitle.vue'
import ActionBar from '@/components/layout/ActionBar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'

const state = useStore()
const levelName = computed(() => CET.levelName())

const filter = ref(null)
const mistakes = ref([])

function optionKeys(options) { return CET.optionKeys(options) }

const PASSAGE_CN = { one: 1, two: 2, three: 3, four: 4, five: 5 }
const MISTAKE_TYPE_NAMES = { careful: '仔细阅读', long: '段落匹配' }

// 错题本不再单独选题型：完全跟随主页（设置页）当前练习题型
//   听力模式 → 听力错题，二级题型取主页选中的听力题型（长对话 / 听力篇章 / 讲座）
//   阅读及其它模式 → 阅读错题，按主页选中的仔细阅读 / 段落匹配
const activeType = computed(() => (state.mode === 'listening' ? 'listening' : (state.currentExamType === 'long' ? 'long' : 'careful')))
const activeListenType = computed(() => (activeType.value === 'listening' ? CET.currentListenType() : ''))

// 标题第二行：如「四级仔细阅读」「六级长对话」
const typeTitle = computed(() => {
  if (activeType.value === 'listening') return levelName.value + (activeListenType.value || '听力')
  return levelName.value + (MISTAKE_TYPE_NAMES[activeType.value] || MISTAKE_TYPE_NAMES.careful)
})

// passage 归一化：Passage One → 第1篇；听力数据里已是「长对话第一篇」也转成数字
const CN2NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 }
function passageLabel(p) {
  if (!p) return ''
  const text = String(p).trim()
  const m = text.match(/(\w+)$/)
  if (m) {
    const num = PASSAGE_CN[m[1].toLowerCase()]
    if (num) return '第' + num + '篇'
  }
  return text.replace(/第([一二三四五])篇/, (s, c) => '第' + (CN2NUM[c] || c) + '篇')
}

// 卡片第二行：如「长对话第一篇第3题」「仔细阅读第一篇第3题」（题号用数字）
function mistakeSourceLabel(m) {
  let head = ''
  if (m.type === 'listening') {
    head = passageLabel(m.passage) || String(m.listenType || '')
  } else {
    head = (MISTAKE_TYPE_NAMES[CET.mistakeTypeOf(m)] || MISTAKE_TYPE_NAMES.careful) + passageLabel(m.passage)
  }
  return head + (m.no ? '第' + m.no + '题' : '')
}

const filteredMistakes = computed(() => {
  const sameLevel = mistakes.value.filter((m) => (m.level || '6') === state.currentLevel)
  let list = sameLevel.filter((m) => CET.mistakeTypeOf(m) === activeType.value)
  if (activeType.value === 'listening' && activeListenType.value) {
    list = list.filter((m) => (m.listenType || '') === activeListenType.value)
  }
  if (!filter.value) return list
  return list.filter((m) => {
    if (m.exam !== filter.value.exam) return false
    if (filter.value.passage && m.passage !== filter.value.passage) return false
    return true
  })
})

const emptyTip = computed(() => {
  if (mistakes.value.filter((m) => (m.level || '6') === state.currentLevel).length === 0) return '暂无错题，去做几道题吧'
  return `暂无${typeTitle.value}错题`
})

// 当前筛选下的全部错题按题号升序排列，连成一体的同一张卡片逐题展示
const sortedMistakes = computed(() => {
  return filteredMistakes.value.slice().sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0))
})

// 外层卡片整体展开状态（默认展开）
const cardOpen = ref(true)

// 外层卡片大标题拆两行：第一行「六级2025年6月」，第二行「第1套仔细阅读」
const headerLines = computed(() => {
  const first = sortedMistakes.value[0]
  if (!first) return [typeTitle.value, '']
  const lv = (first.level || '6') === '4' ? '四级' : '六级'
  const tn = activeType.value === 'listening' ? (activeListenType.value || '听力')
    : (MISTAKE_TYPE_NAMES[activeType.value] || MISTAKE_TYPE_NAMES.careful)
  // 两行标题：第一行「六级仔细阅读」，第二行「2025年6月第1套」
  return [lv + tn, first.exam || '']
})

function refreshMistakes() {
  mistakes.value = CET.loadMistakeList().map((m) => ({ ...m, expanded: false }))
}

function openMistakePicker() {
  // 简化：直接展示套题清单筛选
  const list = CET.loadMistakeList().filter((m) => (m.level || '6') === state.currentLevel && CET.mistakeTypeOf(m) === activeType.value)
  if (list.length === 0) { CET.tip('这里还是空的'); return }
  const examMap = {}
  list.forEach((m) => {
    if (!examMap[m.exam]) examMap[m.exam] = []
    if (examMap[m.exam].indexOf(m.passage) < 0) examMap[m.exam].push(m.passage)
  })
  const exams = Object.keys(examMap)
  // 简化弹窗：用 actionSheet 展示
  const items = ['全部'].concat(exams)
  uni.showActionSheet({
    itemList: items,
    success: (res) => {
      if (res.tapIndex === 0) { filter.value = null }
      else {
        const exam = exams[res.tapIndex - 1]
        filter.value = { exam, passage: '' }
      }
      storageSet(STORAGE_KEYS.MISTAKE_FILTER, JSON.stringify(filter.value))
    }
  })
}

function exportMistakes() {
  const list = CET.loadMistakeList().filter((m) => (m.level || '6') === state.currentLevel)
  if (list.length === 0) { CET.tip('错题本为空，无法导出'); return }
  const now = new Date()
  const payload = { app: 'cetassistant', kind: 'mistakeBook', level: state.currentLevel, exportedAt: now.toISOString(), count: list.length, mistakes: list }
  const stamp = `${now.getFullYear()}-${CET.pad2(now.getMonth() + 1)}-${CET.pad2(now.getDate())}_${CET.pad2(now.getHours())}${CET.pad2(now.getMinutes())}${CET.pad2(now.getSeconds())}`
  const filename = `${levelName.value}错题本_${stamp}.json`
  CET.saveTextFile(JSON.stringify(payload, null, 2), filename)
}

async function importMistakes() {
  const file = await CET.chooseTextFile()
  if (!file) return
  try {
    const parsed = JSON.parse(file.content)
    const arr = Array.isArray(parsed) ? parsed : (parsed.mistakes || [])
    const valid = arr.map((x) => ({
      level: x.level || state.currentLevel, type: CET.mistakeTypeOf(x),
      exam: x.exam || '', passage: x.passage || '', no: Number(x.no) || 0,
      stem: x.stem || '', options: x.options || {}, my: x.my || '',
      answer: x.answer || '', analysis: x.analysis || '', time: x.time || Date.now()
    })).filter((x) => x.stem)
    if (valid.length === 0) { CET.tip('未在文件中解析到错题'); return }
    const list = CET.loadMistakeList()
    let added = 0, skipped = 0
    valid.forEach((x) => {
      const exists = list.some((m) => (m.level || '6') === x.level && CET.mistakeTypeOf(m) === x.type && m.exam === x.exam && m.passage === x.passage && Number(m.no) === x.no)
      if (exists) skipped++; else { list.push(x); added++ }
    })
    CET.saveMistakeList(list)
    refreshMistakes()
    CET.tip(`导入完成：新增 ${added} 条${skipped ? `，跳过重复 ${skipped} 条` : ''}`)
  } catch (err) {
    CET.tip(`导入失败：${err.message}`)
  }
}

async function clearMistakes() {
  const list = CET.loadMistakeList()
  const remain = list.filter((m) => (m.level || '6') !== state.currentLevel)
  if (remain.length === list.length) { CET.tip(`${levelName.value}错题本已经是空的`); return }
  const ok = await CET.uiConfirm(`确定清空${levelName.value}的全部错题吗？此操作不可恢复！`, { danger: true, okText: '全部清空' })
  if (!ok) return
  CET.saveMistakeList(remain)
  refreshMistakes()
}

// 删除当前卡片里的全部错题（整卡一起删，不再单题删除）
function mistakeKey(m) {
  return [(m.level || '6'), CET.mistakeTypeOf(m), m.exam || '', m.passage || '', Number(m.no) || 0].join('|')
}
async function clearCardMistakes() {
  const items = sortedMistakes.value
  if (items.length === 0) return
  const ok = await CET.uiConfirm(`确定删除这 ${items.length} 道错题吗？`, { danger: true, okText: '全部删除' })
  if (!ok) return
  const del = new Set(items.map(mistakeKey))
  const all = CET.loadMistakeList()
  CET.saveMistakeList(all.filter((x) => !del.has(mistakeKey(x))))
  refreshMistakes()
}

// 初始化：题型完全跟随主页，不再读本地保存的错题题型
try { filter.value = JSON.parse(storageGet(STORAGE_KEYS.MISTAKE_FILTER) || 'null') } catch (e) { filter.value = null }
refreshMistakes()
</script>

<style scoped>
.mistake-card .fav-source {
  display: flex; align-items: center;
  padding-right: 80rpx; /* 给右上角删除按钮留位 */
}
.mistake-card-title { flex: 1; display: flex; flex-direction: column; font-weight: 700; color: #92400e; line-height: 1.4; font-size: calc(clamp(20px, 3.4vw, 26px) * var(--font-scale)); }
.mistake-card-title-2 { font-weight: 600; }
@media (min-width: 600px) {
  .mistake-card-title { font-size: calc(clamp(28px, 3.8vw, 36px) * var(--font-scale)); }
}
.mistake-card .fav-toggle { float: none; margin: 0 0 0 16rpx; white-space: nowrap; }
.mistake-card-body { margin-top: 8rpx; }
.mistake-q { padding: 20rpx 0; border-top: 1rpx solid #eadfc8; }
.mistake-q-head { display: flex; align-items: center; flex-wrap: wrap; gap: 14rpx; }
.mistake-q-no { font-size: 28rpx; font-weight: 600; color: #2b3a55; }
.mistake-q-judge { font-size: 24rpx; }
.mistake-q-judge.ok { color: #18a058; }
.mistake-q-judge.no { color: #d03050; }
.mistake-q .fav-body { margin-top: 12rpx; }
.collapse-foot { display: flex; justify-content: center; margin-top: 16rpx; padding: 18rpx 0 6rpx; border-top: 1rpx dashed #cbd5e1; }
.collapse-foot-btn { color: #b45309; font-weight: 600; font-size: calc(20px * var(--font-scale)); }

/* 平板端「▲ 收起」再放大一档 */
@media (min-width: 600px) {
  .collapse-foot-btn { font-size: calc(clamp(26px, 3.2vw, 34px) * var(--font-scale)); }
}
</style>
