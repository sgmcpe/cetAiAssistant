<template>
  <!-- 页面底部作者信息：只有显式传入内容的页面（主页）才显示，空 <AppFooter /> 不渲染 -->
  <view v-if="$slots.default" class="app-footer"><slot /></view>
</template>
