<template>
  <!-- 页面大标题：生词库 / 错题本 / 练习记录。text 负责文字，块级/尺寸/居中/边距走 .page-title -->
  <view class="page-title-block" :class="{ 'has-subtitle': !!subtitle }">
    <text class="page-title">{{ title }}</text>
    <text v-if="subtitle" class="page-title-sub">{{ subtitle }}</text>
  </view>
</template>

<script setup>
defineProps({
  title: { type: String, default: '' },
  // 第二行副标题，如错题本的「四级仔细阅读」
  subtitle: { type: String, default: '' }
})
</script>
