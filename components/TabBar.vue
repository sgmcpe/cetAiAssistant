<template>
  <view class="tab-bar">
    <view v-for="tab in tabs" :key="tab.key"
          class="tab-item" :class="{ active: tab.key === activeTab }"
          @click="onTab(tab)">
      <view class="tab-icon" :class="`tab-icon-${tab.icon}`"></view>
      <text class="tab-label">{{ tab.label }}</text>
    </view>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import useStore from '@/store/index'

const state = useStore()

const tabs = computed(() => {
  const mode = state.mode
  const startKey = mode === 'listening' ? 'listen' : (mode === 'translation' ? 'intensive' : 'read')
  const startLabel = mode === 'listening' ? '精听' : (mode === 'translation' ? '精翻' : '精读')
  const mistakeKey = (mode === 'translation' || mode === 'writing') ? 'record' : 'mistake'
  const mistakeLabel = (mode === 'translation' || mode === 'writing') ? '记录' : '错题'

  const list = [
    { key: 'settings', label: '主页', icon: 'settings' },
    { key: startKey, label: startLabel, icon: 'read' },
    { key: 'quiz', label: '做题', icon: 'quiz' },
    { key: 'word', label: '生词', icon: 'word' },
    { key: mistakeKey, label: mistakeLabel, icon: mistakeKey === 'record' ? 'record' : 'mistake' }
  ]
  // 写作模式隐藏精读入口
  if (mode === 'writing') list.splice(1, 1)
  return list
})

const activeTab = computed(() => state.activeTab)

function onTab(tab) {
  state.activeTab = tab.key
  const key = tab.key
  const map = {
    settings: '/pages/settings/settings',
    read: '/pages/read/read',
    quiz: '/pages/quiz/quiz',
    word: '/pages/word/word',
    mistake: '/pages/mistake/mistake',
    listen: '/pages/listen/listen',
    intensive: '/pages/intensive/intensive',
    record: '/pages/record/record'
  }
  const url = map[key]
  if (!url) return
  // 主标签页互切用 reLaunch 清空页面栈：栈里只留当前页，
  // 侧滑返回 / 左滑手势不会莫名跳回之前叠着的其它主页面
  uni.reLaunch({ url, fail: () => uni.redirectTo({ url }) })
}
</script>
