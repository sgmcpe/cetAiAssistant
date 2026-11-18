<template>
  <AppShell page-id="recordPage">
    <PageTitle title="练习记录" />

    <ActionBar variant="record">
      <button class="download-record-btn" @click="importRecords">新增</button>
      <button class="download-record-btn" @click="exportRecords">导出</button>
      <button class="clear-record-btn" @click="clearRecords">清空</button>
    </ActionBar>

    <!-- 筛选记录：与错题页同一套布局 -->
    <view class="select-area">
      <view class="select-title-row">
        <text>筛选记录</text>
        <button class="picker-btn" @click="openRecordPicker">题库清单</button>
      </view>
    </view>

    <view class="record-list">
      <view v-if="filteredRecords.length === 0" class="empty-tip">{{ emptyTip }}</view>
      <view v-for="(r, i) in filteredRecords" :key="r.id || i" class="fav-item mistake-item" :class="{ expanded: r.expanded }">
        <view class="fav-source" @click="r.expanded = !r.expanded">
          <view class="fav-source-line">
            <text>{{ recordTitleLine(r) }}</text>
          </view>
          <text class="fav-toggle">{{ r.expanded ? '▼ 收起' : '▶ 展开' }}</text>
        </view>
        <view v-if="r.expanded" class="fav-body">
          <view class="record-time">{{ formatAt(r) }}</view>
          <view v-if="r.source" class="record-section-title">题目 / 原文</view>
          <view v-if="r.source" class="fav-analysis">{{ r.source }}</view>
          <view v-if="r.answer" class="record-section-title">我的作答</view>
          <view v-if="r.answer" class="fav-analysis">{{ r.answer }}</view>
          <view v-if="r.feedback" class="record-section-title">AI 批改</view>
          <view v-if="r.feedback" class="fav-analysis">{{ r.feedback }}</view>
          <view class="collapse-foot" @click="r.expanded = false">
            <text class="collapse-foot-btn">▲ 收起</text>
          </view>
        </view>
        <button class="delete-fav trash-btn" @click.stop="removeRecord(r)"><view class="trash-icon"></view></button>
      </view>
    </view>

    <AppFooter />
  </AppShell>
</template>

<script setup>
import { ref, computed } from 'vue'
import useStore, { STORAGE_KEYS } from '@/store/index'
import * as CET from '@/utils/cet'
import { storageSet } from '@/utils/storage'
import AppShell from '@/components/layout/AppShell.vue'
import PageTitle from '@/components/layout/PageTitle.vue'
import ActionBar from '@/components/layout/ActionBar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'

const state = useStore()
const records = ref([])
const filter = ref('')

const MODE_NAMES = { writing: '写作', translation: '翻译' }
const modeName = computed(() => MODE_NAMES[state.mode] || '')

// 练习记录只展示主页当前模式（写作 / 翻译）的记录
function modeRecords() {
  return CET.loadJsonArray(STORAGE_KEYS.RECORDS).filter((r) => r.mode === state.mode)
}

const filteredRecords = computed(() => {
  if (!filter.value) return records.value
  return records.value.filter((r) => String(r.title || '') === filter.value)
})

const emptyTip = computed(() => {
  if (records.value.length === 0) return `暂无${modeName.value}练习记录`
  return `没有符合筛选的${modeName.value}记录`
})

const CN_SET = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

function modeNameOf(r) {
  return MODE_NAMES[r.mode] || ''
}

// 卡片标题两行：第一行「六级写作」，第二行「2025年6月第1篇」（新记录用结构化字段；旧记录从 title 解析）
function recordTitleLine(r) {
  const level = r.level === '4' ? '四级' : '六级'
  const name = modeNameOf(r)
  const set = recordSetNo(r)
  let year = r.year
  let month = r.month
  const m = String(r.title || '').match(/(\d{4})年(\d{1,2})月/)
  if (!year && m) year = m[1]
  if (!month && m) month = m[2]
  if (year && month && set) return `${level}${name}\n${year}年${month}月第${set}篇`
  return `${level}${name}`
}

// 记录套号（数字）：新记录取 set，旧记录从 title 的中文套号转换
function recordSetNo(r) {
  if (r.set) return r.set
  const m = String(r.title || '').match(/月第(.+?)套/)
  if (m) return CN_SET[m[1]] || m[1]
  return ''
}

function refreshRecords() {
  records.value = modeRecords().map((r) => ({ ...r, expanded: false }))
}

function formatTime(t) {
  if (!t) return ''
  const d = new Date(t)
  return `${d.getFullYear()}-${CET.pad2(d.getMonth() + 1)}-${CET.pad2(d.getDate())} ${CET.pad2(d.getHours())}:${CET.pad2(d.getMinutes())}`
}

// 兼容旧记录：早期存的是 Date 的 toString（带 GMT 的长串），转成短格式
function formatAt(r) {
  const at = r.at || ''
  if (at && !/GMT/i.test(at)) return at
  const ts = r.time || Date.parse(at)
  if (!ts) return at || ''
  return formatTime(ts)
}

function openRecordPicker() {
  const list = modeRecords()
  if (list.length === 0) { CET.tip('这里还是空的'); return }
  const titles = []
  list.forEach((r) => {
    const t = String(r.title || '').trim()
    if (t && titles.indexOf(t) < 0) titles.push(t)
  })
  if (titles.length <= 1) { CET.tip('只有一套记录，无需筛选'); return }
  uni.showActionSheet({
    itemList: ['全部'].concat(titles),
    success: (res) => {
      filter.value = res.tapIndex === 0 ? '' : titles[res.tapIndex - 1]
    }
  })
}

function exportRecords() {
  const list = modeRecords()
  if (list.length === 0) { CET.tip(`暂无${modeName.value}练习记录，无法导出`); return }
  const now = new Date()
  const payload = { app: 'cetassistant', kind: 'practiceRecords', mode: state.mode, exportedAt: now.toISOString(), count: list.length, records: list }
  const stamp = `${now.getFullYear()}-${CET.pad2(now.getMonth() + 1)}-${CET.pad2(now.getDate())}_${CET.pad2(now.getHours())}${CET.pad2(now.getMinutes())}${CET.pad2(now.getSeconds())}`
  const filename = `${CET.levelName()}${modeName.value}练习记录_${stamp}.json`
  CET.saveTextFile(JSON.stringify(payload, null, 2), filename)
}

async function importRecords() {
  const file = await CET.chooseTextFile()
  if (!file) return
  try {
    const parsed = JSON.parse(file.content)
    const arr = Array.isArray(parsed) ? parsed : (parsed.records || [])
    if (arr.length === 0) { CET.tip('文件里没有解析到记录'); return }
    const all = CET.loadJsonArray(STORAGE_KEYS.RECORDS)
    let added = 0
    arr.forEach((r) => {
      const id = r.id || String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7)
      if (all.some((x) => x.id === id)) return
      all.push({ ...r, mode: r.mode || state.mode, id })
      added++
    })
    storageSet(STORAGE_KEYS.RECORDS, JSON.stringify(all.slice(-300)))
    refreshRecords()
    CET.tip(`新增完成：新增 ${added} 条`)
  } catch (err) {
    CET.tip(`导入失败：${err.message}`)
  }
}

async function clearRecords() {
  const all = CET.loadJsonArray(STORAGE_KEYS.RECORDS)
  const remain = all.filter((r) => r.mode !== state.mode)
  if (remain.length === all.length) { CET.tip(`暂无${modeName.value}练习记录`); return }
  const ok = await CET.uiConfirm(`确定清空全部${modeName.value}练习记录吗？此操作不可恢复！`, { danger: true, okText: '全部清空' })
  if (!ok) return
  storageSet(STORAGE_KEYS.RECORDS, JSON.stringify(remain))
  filter.value = ''
  refreshRecords()
}

async function removeRecord(r) {
  const ok = await CET.uiConfirm('确定删除这条练习记录吗？', { danger: true, okText: '删除' })
  if (!ok) return
  const all = CET.loadJsonArray(STORAGE_KEYS.RECORDS)
  const idx = all.findIndex((x) => (r.id ? x.id === r.id : (x.at === r.at && x.title === r.title)))
  if (idx >= 0) all.splice(idx, 1)
  storageSet(STORAGE_KEYS.RECORDS, JSON.stringify(all))
  refreshRecords()
}

refreshRecords()
</script>

<style scoped>
/* 和错题本同款：标题占左、展开/收起固定右侧同行垂直居中，不再被长标题挤到第二行 */
.fav-item .fav-source { display: flex; align-items: center; padding-right: 80rpx; }
.fav-item .fav-source-line { flex: 1; min-width: 0; }
.fav-item .fav-toggle { float: none; margin: 0 0 0 16rpx; white-space: nowrap; }
.fav-item .fav-source-line text { white-space: pre-line; }
.collapse-foot { display: flex; justify-content: center; margin-top: 16rpx; padding: 18rpx 0 6rpx; border-top: 1rpx dashed #cbd5e1; }
.collapse-foot-btn { color: #b45309; font-weight: 600; font-size: calc(20px * var(--font-scale)); }

/* 平板端「▲ 收起」再放大一档 */
@media (min-width: 600px) {
  .collapse-foot-btn { font-size: calc(clamp(26px, 3.2vw, 34px) * var(--font-scale)); }
}
</style>
