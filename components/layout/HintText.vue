<template>
  <!-- 灰色小提示文字（原版是 <p>，改用 view 保持块级居中） -->
  <view class="hint-text" :style="textStyle"><slot /></view>
</template>

<script setup>
defineProps({
  // 需要个别调整时直接传 style，例如 margin
  textStyle: { type: [String, Object], default: '' }
})
</script>
