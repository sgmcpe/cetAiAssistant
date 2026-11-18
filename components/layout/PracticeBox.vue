<template>
  <!-- 精读 / 精听 / 精翻的主练习区域，左右滑动切换需要监听触摸 -->
  <view class="practice-box" :class="boxClass" @touchstart="$emit('touchstart', $event)" @touchend="$emit('touchend', $event)">
    <slot />
  </view>
</template>

<script setup>
defineProps({
  boxClass: { type: [String, Object, Array], default: '' }
})

defineEmits(['touchstart', 'touchend'])
</script>
