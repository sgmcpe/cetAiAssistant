<template>
  <!-- 精听页 / 听力做题页共用音频条：自绘播放键 + 时间 + 可拖动进度，
       长度撑满父容器（两页完全一致）。内部用 uni.createInnerAudioContext 播放
       —— <audio> 组件在 Vue3 下 timeupdate 不回调，原生控制条宽度也不受控。 -->
  <view class="listen-audio-bar" :class="{ 'listen-audio-float': floating }">
    <view v-if="ready" class="listen-player">
      <view class="listen-play-btn" @click="toggle">{{ playing ? '暂停' : '播放' }}</view>
      <text class="listen-time">{{ fmtTime(cur) }} / {{ fmtTime(duration) }}</text>
      <slider class="listen-progress" :value="percent" :min="0" :max="100" block-size="14"
              activeColor="#576b95" backgroundColor="#dfe2e8"
              @changing="onSeekChanging" @change="onSeekChange" />
      <!-- 悬浮态：手动点「收起」才回到原位（暂停 / 播完都不会自动收起） -->
      <view v-if="floating" class="listen-park-btn" @click.stop="unfloat">收起</view>
    </view>
    <!-- 没有音频时显示导入提示（由页面通过 #empty 插槽传入） -->
    <slot v-else name="empty">
      <view v-if="emptyText" class="hint-text">{{ emptyText }}</view>
    </slot>
  </view>
</template>

<script setup>
import { ref, computed, watch, onUnmounted } from 'vue'
import { audioDirAbs } from '@/utils/audio'

const props = defineProps({
  // 已解析好的播放地址（audioUrl 的返回值）
  src: { type: String, default: '' },
  // 音频文件名：App 端 InnerAudioContext 需要文件系统绝对路径时用它拼
  fileName: { type: String, default: '' },
  // 没有音频时的兜底提示文字
  emptyText: { type: String, default: '' },
  // 播放开始后是否悬浮到屏幕顶部（精听页开启，听力做题页保持原位）
  floatOnPlay: { type: Boolean, default: false }
})

// time：播放进度变化（秒），页面拿它做字幕高亮；ready：拿到总时长
// float-height：悬浮条实际高度，页面用它做滚动定位的顶部让位
const emit = defineEmits(['time', 'ready', 'float-height'])

const playing = ref(false)
const cur = ref(0)
const duration = ref(0)
const floating = ref(false)   // 悬浮到屏幕顶部

let innerAudio = null
let seeking = false
let lastDuration = 0

// App 端 InnerAudioContext 要文件系统绝对路径，其余端用 toLocalURL 给的地址
const playerSrc = computed(() => {
  const abs = audioDirAbs()
  if (abs && props.fileName) return abs + props.fileName
  return props.src || ''
})

const ready = computed(() => !!props.src)

const percent = computed(() => {
  const d = duration.value
  if (!d) return 0
  return Math.max(0, Math.min(100, (cur.value / d) * 100))
})

function fmtTime(s) {
  const v = Number(s)
  if (!isFinite(v) || v <= 0) return '0:00'
  const m = Math.floor(v / 60)
  const sec = Math.floor(v % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function syncDuration() {
  const d = innerAudio ? innerAudio.duration : 0
  if (d > 0 && d !== lastDuration) {
    lastDuration = d
    duration.value = d
    emit('ready', d)
  }
}

function ensureAudio() {
  if (innerAudio) return innerAudio
  innerAudio = uni.createInnerAudioContext()
  innerAudio.onPlay(() => {
    playing.value = true
    // 每次开始播放都自动悬浮（点过「收起」后再点播放可重新展开）
    if (props.floatOnPlay) floating.value = true
  })
  innerAudio.onPause(() => { playing.value = false })
  innerAudio.onEnded(() => { playing.value = false })
  innerAudio.onCanplay(() => { syncDuration() })
  innerAudio.onError((err) => {
    playing.value = false
    console.log('[audio-bar] audio error', err && err.errMsg)
  })
  innerAudio.onTimeUpdate(() => {
    syncDuration()
    if (seeking) return
    cur.value = innerAudio.currentTime
    emit('time', cur.value)
  })
  return innerAudio
}

function toggle() {
  const a = ensureAudio()
  if (!a.src) a.src = playerSrc.value || ''
  if (playing.value) a.pause()
  else a.play()
}

function pause() {
  if (!innerAudio || !playing.value) return
  try { innerAudio.pause() } catch (e) {}
}

// 手动收起：回到原位（再点播放会重新悬浮）
function unfloat() {
  floating.value = false
}

function seek(t) {
  const a = ensureAudio()
  if (!a.src) a.src = playerSrc.value || ''
  try { a.seek(t) } catch (e) {}
  cur.value = t
  emit('time', t)
}

// 换篇 / 重新挂地址：停掉上一段，进度归零
function reset() {
  playing.value = false
  cur.value = 0
  duration.value = 0
  lastDuration = 0
  floating.value = false
  if (!innerAudio) return
  try { innerAudio.stop() } catch (e) {}
  innerAudio.src = playerSrc.value || ''
}

function onSeekChanging(e) {
  seeking = true
  cur.value = ((e.detail.value || 0) / 100) * (duration.value || 0)
}

function onSeekChange(e) {
  const t = ((e.detail.value || 0) / 100) * (duration.value || 0)
  seeking = false
  seek(t)
}

// 换音频就重挂地址（精听页换篇、做题页换套题都会走到这里）
watch(playerSrc, () => { reset() })

// 悬浮 / 取消悬浮后测量实际高度并上报（含状态栏让位），页面用它给内容让出顶部空间
watch(floating, (v) => {
  if (!v) { emit('float-height', 0); return }
  setTimeout(() => {
    uni.createSelectorQuery()
      .select('.listen-audio-bar')
      .boundingClientRect()
      .exec((res) => {
        const r = res && res[0]
        if (r && r.height) emit('float-height', Math.round(r.height))
      })
  }, 160)
})

// 页面卸载时释放播放器（onUnmounted 兜底，页面的 onUnload 也会主动调一次）
function destroy() {
  if (!innerAudio) return
  try { innerAudio.destroy() } catch (e) {}
  innerAudio = null
}

onUnmounted(destroy)

defineExpose({ toggle, pause, seek, reset, destroy, unfloat, cur, duration, playing, floating })
</script>
