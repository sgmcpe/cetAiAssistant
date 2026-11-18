<script setup>
// App.vue 的应用级生命周期（onLaunch / onShow / onHide）在 Vue3 下
// 必须从 @dcloudio/uni-app 显式导入，否则只是一个普通函数、永远不会被调用。
import { onLaunch, onShow, onHide } from '@dcloudio/uni-app'

onLaunch(() => {
  // #ifdef H5
  // 原版 HTML 在 <html> 上恒加 is-mobile-app，全局样式里一大批右侧按钮显隐规则
  // 都带 html.is-mobile-app 前缀。H5 端逻辑层与视图层同环境，这里直接加即可；
  // App 端逻辑层拿不到渲染层 document，改由 components/ViewBridge.vue 的 renderjs 在视图层添加。
  document.documentElement.classList.add('is-mobile-app')
  // #endif
  console.log('四六级备考助手启动')
})

onShow(() => {})

onHide(() => {})
</script>

<style lang="scss">
/* 全局样式在 App.vue 中引入，覆盖整个应用 */
@import '@/static/style/app.scss';
</style>
