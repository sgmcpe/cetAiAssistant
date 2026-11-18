<template>
  <AppShell page-id="wordPage">
    <PageTitle title="生词库" />

    <ActionBar variant="record">
      <button class="download-record-btn" @click="importWords">新增</button>
      <button class="download-record-btn" @click="exportWords">导出</button>
      <button class="clear-record-btn" @click="clearWords">清空</button>
    </ActionBar>

    <view class="word-row">
      <!-- word-input：给 uni-textarea 根节点挂类，样式里好控制宽度和 100px 高度。
           不用 auto-height：原版是一个固定 100px 的输入框（内容多了框内滚动），
           开了 auto-height 组件内部会按一行高度撑开，文字贴着上沿、内边距也会失效。 -->
      <textarea class="word-input" :placeholder="wordPlaceholder" v-model="wordInput"></textarea>
      <!-- id 与原版一致：手机端 #wordPage #wordAddBtn 的细内边距规则靠它命中 -->
      <button class="jump-btn" id="wordAddBtn" :data-mode="addBtnMode" @click="onAddBtn">{{ addBtnText }}</button>
    </view>

    <view class="record-list">
      <view v-if="words.length === 0" class="empty-tip">暂无生词</view>
      <view v-for="(w, i) in words" :key="i" class="word-item" :class="{ expanded: w.expanded }">
        <view class="word-head" @click="w.expanded = !w.expanded">
          <text class="word-en">{{ w.word }}</text>
          <text v-if="w.pos" class="word-pos">{{ w.pos }}</text>
          <button class="delete-word trash-btn" @click.stop="deleteWord(w.word)"><view class="trash-icon"></view></button>
        </view>
        <view v-if="w.expanded" class="word-meaning">{{ w.meaning || '' }}</view>
      </view>
    </view>

    <AppFooter />
  </AppShell>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import useStore from '@/store/index'
import * as CET from '@/utils/cet'
import { callDeepSeek } from '@/utils/deepseek'
import AppShell from '@/components/layout/AppShell.vue'
import PageTitle from '@/components/layout/PageTitle.vue'
import ActionBar from '@/components/layout/ActionBar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'

const state = useStore()

const words = ref([])
const wordInput = ref('')
const addBtnMode = ref('add')
const addBtnText = ref('添加')
// 原版 placeholder 是两行：请输入生词或短语 / 多个可换行
const wordPlaceholder = '请输入生词或短语\n多个可换行'

function refreshWords() {
  words.value = CET.loadWordBook().sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()))
    .map((w) => ({ ...w, expanded: false }))
  syncAddBtn()
}

function wordLines() {
  return wordInput.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
}

function syncAddBtn() {
  const lines = wordLines()
  const search = lines.length === 1 && !!CET.findWordEntry(lines[0])
  addBtnMode.value = search ? 'search' : 'add'
  addBtnText.value = search ? '搜索' : '添加'
}

// 输入内容变化时立即判断词库里是否已有：有则按钮变为「搜索」
watch(wordInput, syncAddBtn)

function onAddBtn() {
  if (addBtnMode.value === 'search') {
    const lines = wordLines()
    if (lines.length === 1) searchWord(lines[0])
    return
  }
  addWords()
}

function searchWord(text) {
  const key = CET.cleanWordText(text).toLowerCase()
  const hit = words.value.find((w) => CET.cleanWordText(w.word).toLowerCase() === key)
  if (!hit) { CET.tip(`生词库里没有找到「${text}」`); return }
  hit.expanded = true
  scrollToWord(words.value.indexOf(hit))
}

// 搜索命中后把该词滚到可视区域，省得用户自己在长列表里找
function scrollToWord(index) {
  const q = uni.createSelectorQuery()
  q.selectAll('.word-item').boundingClientRect()
  q.selectViewport().scrollOffset()
  q.exec((res) => {
    const rects = res && res[0] ? res[0] : []
    const viewport = res && res[1] ? res[1] : {}
    const rect = rects[index]
    if (!rect) return
    const top = (viewport.scrollTop || 0) + rect.top - 120
    uni.pageScrollTo({ scrollTop: top > 0 ? top : 0, duration: 220 })
  })
}

async function addWords() {
  const lines = wordLines()
  if (lines.length === 0) { CET.tip('请先输入要添加的单词或短语'); return }
  const prompt = '你是一位英语老师，正在帮学生整理大学英语四六级生词。\n\n【学生输入的内容】\n' + lines.join('\n') +
    '\n\n【要求】把每一行当作一个查询单位，分别给出它常用的词性和中文意思（词性用中文），按格式输出：单词或短语：词性：意思'
  try {
    const answer = await callDeepSeek(prompt, 800)
    let triples = CET.parseWordTriples(CET.stripMarkdownBold(answer))
    if (triples.length === 0) {
      triples = lines.map((w) => (CET.extractEnglishPhrases ? CET.extractEnglishPhrases(w)[0] : '') || '')
        .filter(CET.isValidWordEntry).map((w) => ({ word: CET.cleanWordText(w), pos: '', meaning: '' }))
    }
    const added = CET.addToWordBook(triples)
    if (added === 0) { CET.tip('没有识别到英文单词，请检查输入内容'); return }
    wordInput.value = ''
    refreshWords()
    CET.tip(`已添加 ${added} 个生词`)
  } catch (err) {
    if (err.message !== '缺少Token') CET.tip(`添加失败：${err.message}`)
  }
}

function exportWords() {
  const list = CET.loadWordBook()
  if (list.length === 0) { CET.tip('生词库还是空的，先去精读页查几个词吧'); return }
  const now = new Date()
  const stamp = `${now.getFullYear()}-${CET.pad2(now.getMonth() + 1)}-${CET.pad2(now.getDate())}_${CET.pad2(now.getHours())}${CET.pad2(now.getMinutes())}${CET.pad2(now.getSeconds())}`
  const payload = { app: 'cetassistant', kind: 'wordBook', exportedAt: now.toISOString(), count: list.length, words: list }
  CET.saveTextFile(JSON.stringify(payload, null, 2), `生词库_带释义_${stamp}.json`)
  const onlyWords = list.map((w) => w.word).join('\n')
  CET.saveTextFile(onlyWords, `生词库_仅单词_${stamp}.json`)
  CET.tip('已导出两个生词文件')
}

async function importWords() {
  const file = await CET.chooseTextFile()
  if (!file) return
  try {
    const parsed = JSON.parse(file.content)
    const arr = Array.isArray(parsed) ? parsed : (parsed.words || [])
    const triples = arr.map((w) => ({ word: w.word || '', pos: w.pos || '', meaning: w.meaning || '' })).filter((w) => w.word)
    if (triples.length === 0) { CET.tip('文件里没有解析到单词'); return }
    const added = CET.addToWordBook(triples)
    refreshWords()
    CET.tip(`导入完成，共处理 ${added} 条`)
  } catch (err) {
    CET.tip(`导入失败：${err.message}`)
  }
}

async function clearWords() {
  if (CET.loadWordBook().length === 0) { CET.tip('生词库已经是空的'); return }
  const ok = await CET.uiConfirm('确定清空全部生词吗？此操作不可恢复！', { danger: true, okText: '全部清空' })
  if (!ok) return
  CET.saveWordBook([])
  refreshWords()
}

async function deleteWord(word) {
  const ok = await CET.uiConfirm(`确定删除「${word}」这个生词吗？`, { danger: true, okText: '删除' })
  if (!ok) return
  const list = CET.loadWordBook().filter((w) => String(w.word).toLowerCase() !== String(word).toLowerCase())
  CET.saveWordBook(list)
  refreshWords()
}

refreshWords()
</script>
