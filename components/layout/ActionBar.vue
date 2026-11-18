<template>
  <!-- 一行按钮：导入 / 导出 / 清空、提问按钮等 -->
  <view :class="barClass">
    <slot />
  </view>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // row = 普通按钮行；record = 生词/错题/记录页的导入导出行
  // translate = 精读/精翻页的翻译、提问行
  variant: { type: String, default: 'row' }
})

const CLASS_MAP = {
  row: 'button-row',
  record: 'clear-record-container',
  translate: 'translate-row'
}

const barClass = computed(() => CLASS_MAP[props.variant] || CLASS_MAP.row)
</script>
