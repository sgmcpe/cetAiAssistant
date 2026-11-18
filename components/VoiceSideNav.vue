<template>
  <view class="ask-side-nav" :class="[navClass, { 'side-hidden': sideHidden }]">
    <button v-if="showToggle" class="ask-side-toggle" @click="$emit('toggle-side')">
      {{ sideHidden ? '‹' : '›' }}
    </button>

    <button v-if="showBack" class="ask-side-pill ask-side-back" @click="$emit('go-article')">文章</button>
    <button v-if="showMistake" class="ask-side-pill ask-side-mistake" @click="$emit('go-questions')">题目</button>

    <!-- 通话中：电话换成打断 + 挂断 -->
    <button v-if="!calling && showCall" class="ask-side-round ask-side-call"
            title="语音通话：点一下和AI直接说话" @click="$emit('call')">
      <view class="side-icon side-icon-phone"></view>
    </button>
    <button v-if="!calling && showSms" class="ask-side-round ask-side-sms"
            title="发消息，和AI讨论" @click="$emit('sms')">
      <view class="side-icon side-icon-sms"></view>
    </button>

    <button v-if="calling" class="ask-side-pill ask-side-interrupt" @click="$emit('interrupt')">打断</button>
    <button v-if="calling" class="ask-side-pill ask-side-hangup" @click="$emit('hangup')">挂断</button>

    <!-- 通话中不自动跳聊天屏：挂断下方保留短信按钮，用户自己点进去看问答记录 -->
    <button v-if="calling && showSms" class="ask-side-round ask-side-sms"
            title="发消息，和AI讨论" @click="$emit('sms')">
      <view class="side-icon side-icon-sms"></view>
    </button>
  </view>
</template>

<script setup>
import { computed } from 'vue'
import useStore from '@/store/index'

const props = defineProps({
  variant: { type: String, default: 'read' },  // read / quiz / listen / intensive
  sideHidden: { type: Boolean, default: true }
})
defineEmits(['toggle-side', 'call', 'sms', 'interrupt', 'hangup', 'go-article', 'go-questions'])

const state = useStore()
const calling = computed(() => state.callMode)

// 全局样式按页面区分侧栏类名：精读 / 精翻是 read-side-nav、做题是 quiz-side-nav；
// 精听页历史样式里 quiz-side-nav 与 listen-side-nav 两套规则都有，缺一个就整列按钮不显示。
// 之前根节点固定写死 read-side-nav，导致做题页 / 精听页的显隐规则全部匹配不上。
const navClass = computed(() => {
  if (props.variant === 'quiz') return 'quiz-side-nav'
  if (props.variant === 'listen') return 'quiz-side-nav listen-side-nav'
  if (props.variant === 'intensive') return 'read-side-nav intensive-side-nav'
  return 'read-side-nav'
})

const showToggle = computed(() => props.variant !== 'listen')
const showBack = computed(() => props.variant === 'quiz')
const showMistake = computed(() => props.variant === 'quiz')
const showCall = computed(() => true)
const showSms = computed(() => props.variant === 'quiz' || props.variant === 'listen' || props.variant === 'intensive')
</script>

<style scoped>
/* 样式沿用全局 app.scss 中的 .ask-side-nav 定义 */
</style>
