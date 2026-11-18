<template>
  <!-- 白色卡片区块：设置页的每一块、听力音频、数据备份等都用它 -->
  <view class="token-area" :class="cardClass">
    <!-- labelExtra：标题行右侧的附加内容（如「下载音频」链接） -->
    <view v-if="label || $slots.labelExtra" class="token-area-head">
      <label v-if="label">{{ label }}</label>
      <slot name="labelExtra" />
    </view>
    <slot />
  </view>
</template>

<script setup>
defineProps({
  // 卡片上方的小标题，不传就不显示
  label: { type: String, default: '' },
  // 额外的 class，比如 ai-scope-area
  cardClass: { type: [String, Object, Array], default: '' }
})
</script>
