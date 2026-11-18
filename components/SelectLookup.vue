<template>
  <!-- 选中文字后的前端自定义菜单：只提供「复制」「查词」两项。
       菜单层不铺全屏遮罩：否则 ~320ms 后弹层会挡住系统选字手柄，
       用户就只能拖选到一个单词。遮罩只在查词结果卡片出现时才铺。
       菜单收起靠选区被系统清掉（select-lost）或点了菜单项。 -->
  <view v-if="visible" class="select-layer">
    <!-- 结果卡片是模态阅读，铺一层透明遮罩挡手柄并点空白收起 -->
    <view v-if="lookupVisible" class="select-layer-dismiss" @click="dismiss"></view>

    <view v-if="!lookupVisible" class="select-menu" :style="menuStyle" @click.stop>
      <view class="select-menu-item" @click="copyText"><text>复制</text></view>
      <view class="select-menu-item" @click="lookupText"><text>查词</text></view>
      <view class="select-menu-item" @click="translateText"><text>翻译</text></view>
    </view>

    <!-- 查词结果弹窗：沿用全局 .select-lookup 的底部卡片样式 -->
    <view v-else class="select-lookup" role="dialog" @click.stop>
      <view class="select-lookup-head">
        <text class="select-lookup-word">{{ lookupWord }}</text>
        <button class="select-lookup-close" @click="dismiss">×</button>
      </view>
      <view class="select-lookup-body">{{ lookupBody }}</view>
      <view v-if="lookupMode !== 'translate'" class="select-lookup-actions">
        <button class="jump-btn" :disabled="addBtnDisabled" @click="addToBook">{{ addBtnText }}</button>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive } from 'vue'
import useStore from '@/store/index'
import * as CET from '@/utils/cet'
import { callDeepSeek } from '@/utils/deepseek'

const state = useStore()

const visible = ref(false)
const lookupVisible = ref(false)
const selectedText = ref('')
const lookupWord = ref('')
const lookupBody = ref('')
const lookupMode = ref('word')
const lookupTriples = ref([])
const addBtnDisabled = ref(true)
const addBtnText = ref('加入生词本')
const menuStyle = reactive({ top: '160px', left: '50%' })

// 菜单宽约 160px，靠窗口尺寸把浮层夹回可视区内
function viewport() {
  try {
    const info = uni.getSystemInfoSync()
    return { w: info.windowWidth || 390, h: info.windowHeight || 720 }
  } catch (err) {
    return { w: 390, h: 720 }
  }
}

/**
 * 由交互适配层在选区稳定 / 右键菜单时调用
 * @param {string} text 选中的文字
 * @param {number} x 屏幕 x（拿不到时传 0，由组件居中兜底）
 * @param {number} y 屏幕 y
 */
function show(text, x, y) {
  if (!text || !text.trim()) return
  const v = viewport()
  const menuW = 168
  const menuH = 52
  const cx = x > 0 ? x : v.w / 2
  const cy = y > 0 ? y : v.h / 2
  selectedText.value = text.trim().replace(/\s+/g, ' ')
  menuStyle.left = `${Math.max(12, Math.min(cx - menuW / 2, v.w - menuW - 12))}px`
  menuStyle.top = `${Math.max(12, Math.min(cy - menuH - 12, v.h - menuH - 12))}px`
  visible.value = true
  lookupVisible.value = false
}

function dismiss() {
  visible.value = false
  lookupVisible.value = false
  selectedText.value = ''
}

/** 选区被系统清掉时调用：结果弹窗正在看就别关，否则收起菜单 */
function hideFromSelection() {
  if (lookupVisible.value) return
  dismiss()
}

function copyText() {
  uni.setClipboardData({
    data: selectedText.value,
    success: () => {
      CET.tip('已复制')
      dismiss()
    }
  })
}

async function lookupText() {
  const target = selectedText.value
  if (!target) return
  lookupWord.value = target
  lookupVisible.value = true
  lookupMode.value = 'word'
  lookupTriples.value = []
  addBtnDisabled.value = true
  addBtnText.value = '加入生词本'

  // 选中的是一整句：不浪费 token
  if (target.length > 80 || target.split(/\s+/).length > 10) {
    lookupBody.value = '选中的内容偏长，请只选中要查的单词或短语。'
    return
  }
  // 本地生词库命中
  const local = CET.findWordEntry(target)
  if (local && local.meaning) {
    const head = local.pos ? `${local.word}(${local.pos})：\n` : `${local.word}：\n`
    lookupBody.value = head + local.meaning
    lookupTriples.value = [{ word: local.word, pos: local.pos || '', meaning: local.meaning }]
    addBtnText.value = '已在生词本'
    addBtnDisabled.value = true
    return
  }

  const sentence = state.sentences[state.currentIndex] ? state.sentences[state.currentIndex].text : ''
  const prefix = sentence ? `${state.currentIndex}|` : 'plain|'
  const cacheKey = prefix + target.toLowerCase()
  if (state.wordCache[cacheKey]) {
    const cached = state.wordCache[cacheKey]
    lookupBody.value = cached
    let triples = CET.parseWordTriples(cached)
    if (!triples.length) triples = [{ word: target, pos: '', meaning: '' }]
    lookupTriples.value = triples
    addBtnDisabled.value = CET.findWordEntry(triples[0].word) ? true : false
    addBtnText.value = addBtnDisabled.value ? '已在生词本' : '加入生词本'
    return
  }

  lookupBody.value = '查询中，请稍候…'
  try {
    const prompt = CET.readingIntro() + '\n\n' +
      (sentence ? `【当前句子】\n${sentence}\n\n` : '') +
      `【学生选中的内容】\n${target}\n\n` +
      '【要求】只查询选中的内容，如果它是短语整体翻译词性写"短语"，否则给词性和中文意思（词性用中文）。只输出两行：第一行 英文单词或短语(词性)：，第二行 中文意思'
    const answer = await callDeepSeek(prompt, 400)
    const cleaned = CET.compactLines(CET.stripMarkdownBold(answer))
    lookupBody.value = cleaned || '没有查到释义'
    state.wordCache[cacheKey] = lookupBody.value
    let triples = CET.parseWordTriples(cleaned)
    if (!triples.length) triples = [{ word: target, pos: '', meaning: '' }]
    lookupTriples.value = triples
    addBtnDisabled.value = CET.findWordEntry(triples[0].word) ? true : false
    addBtnText.value = addBtnDisabled.value ? '已在生词本' : '加入生词本'
  } catch (err) {
    lookupBody.value = err.message === '缺少Token' ? '请先在设置页填写 DeepSeek Token。' : `查词失败：${err.message}`
    lookupTriples.value = []
  }
}

async function translateText() {
  const target = selectedText.value
  if (!target) return
  lookupMode.value = 'translate'
  lookupWord.value = '翻译'
  lookupVisible.value = true
  lookupTriples.value = []
  lookupBody.value = '翻译中，请稍候…'
  try {
    const prompt = CET.readingIntro() +
      '\n\n【任务】把下面英文翻译成通顺、忠实原文的中文。直接输出译文本身，不要解释、不要加引号或序号：\n' +
      target
    const answer = await callDeepSeek(prompt, 900)
    lookupBody.value = CET.stripMarkdownBold(answer).trim() || '翻译失败，请重试'
  } catch (err) {
    lookupBody.value = err.message === '缺少Token' ? '请先在设置页填写 DeepSeek Token。' : `翻译失败：${err.message}`
  }
}

function addToBook() {
  if (!lookupTriples.value.length) return
  const added = CET.addToWordBook(lookupTriples.value)
  if (added > 0) {
    addBtnText.value = '已在生词本'
    addBtnDisabled.value = true
    CET.tip('已加入生词本')
  } else {
    CET.tip('没有可加入的词条')
  }
}

defineExpose({ show, dismiss, hideFromSelection })
</script>

<style scoped>
.select-layer {
  position: fixed;
  top: 0; right: 0; bottom: 0; left: 0;
  z-index: 1300;
  pointer-events: none;
}
.select-layer-dismiss {
  position: absolute;
  top: 0; right: 0; bottom: 0; left: 0;
  background: transparent;
  pointer-events: auto;
}
.select-menu {
  position: absolute;
  pointer-events: auto;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(15, 23, 42, 0.22);
  padding: 5px;
  display: flex;
  gap: 2px;
  -webkit-user-select: none;
  user-select: none;
}
.select-menu-item {
  padding: 9px 18px;
  font-size: 15px;
  color: #1e293b;
  border-radius: 8px;
  white-space: nowrap;
}
.select-menu-item:active { background: #eef2ff; }
/* 结果弹窗：位置由全局 .select-lookup 决定，这里只补交互与层级 */
.select-lookup {
  pointer-events: auto;
  -webkit-user-select: text;
  user-select: text;
}
</style>
