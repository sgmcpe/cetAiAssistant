<template>
  <!-- 页面外壳：手机和平板都用这一套，不区分屏幕尺寸。
       --font-scale 挂在 .cet-app 上（等同原版写在 <html> 上），
       设置页的字体大小滑块改的就是它，页面内所有 calc(... * var(--font-scale)) 跟着缩放。 -->
  <view class="cet-app" :style="{ '--font-scale': state.fontScale }">
    <!-- v-bind="$attrs" 把页面上的 class / @touchstart 等直接作用到 .page 上，
         配合 inheritAttrs: false 避免重复落到 .cet-app 根节点 -->
    <view class="page" :id="pageId" :class="pageClass" v-bind="$attrs">
      <slot />
    </view>

    <!-- 弹窗、长按菜单之类的浮层（不在 .page 里面） -->
    <slot name="overlay" />

    <!-- App 端视图层交互桥：renderjs 在视图层监听边缘点击 / 方向键 / 右键拖拽 / 选词，
         再回传逻辑层；处理函数由页面里的 usePageInteractions 通过 VIEW_BRIDGE_KEY 注入 -->
    <ViewBridge v-if="viewBridgeHandlers" v-on="viewBridgeHandlers" />

    <TabBar v-if="tabbar" />
  </view>
</template>

<script setup>
import { inject } from 'vue'
import TabBar from '@/components/TabBar.vue'
import ViewBridge from '@/components/ViewBridge.vue'
import useStore from '@/store/index'
import { VIEW_BRIDGE_KEY } from '@/utils/interaction'

// 不把 $attrs 自动加到根节点上，而是手动加给 .page（Vue3 用 defineOptions 声明组件选项）
defineOptions({ inheritAttrs: false })

const viewBridgeHandlers = inject(VIEW_BRIDGE_KEY, null)
const state = useStore()

defineProps({
  // 页面 id，样式里用 #readPage 这类选择器时会用到
  pageId: { type: String, default: '' },
  // 页面根节点的额外 class，比如精读页的通话状态
  pageClass: { type: [String, Object, Array], default: '' },
  // 是否显示底部标签栏
  tabbar: { type: Boolean, default: true }
})
</script>
