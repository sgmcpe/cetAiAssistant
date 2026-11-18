<template>
  <view class="view-bridge" style="display: none;"></view>
</template>

<script>
/**
 * App 端逻辑层拿不到渲染层 DOM（uni-app App 端逻辑层与视图层分离），
 * 所有依赖 document / window 的交互都必须在视图层运行：
 *   - 点右边缘展开 / 收起电话·短信按钮
 *   - 外接键盘 ← / → 切页
 *   - 鼠标右键拖拽切页
 *   - 长按 / 右键选词后的「复制 / 查词」
 * 这里用 renderjs 在视图层监听，再通过 $ownerInstance.callMethod 回传逻辑层，
 * 由页面里的 usePageInteractions 统一处理（H5 端同环境，仍走逻辑层监听，避免双触发）。
 */
export default {
  name: 'ViewBridge',
  emits: ['edge', 'navigate', 'select', 'select-lost', 'selection-active'],
  methods: {
    emitEdge(payload) { this.$emit('edge', !!(payload && payload.isEdge)) },
    emitNavigate(payload) { this.$emit('navigate', (payload && payload.dir) || -1) },
    emitSelect(payload) {
      const p = payload || {}
      this.$emit('select', p.text || '', p.x || 0, p.y || 0)
    },
    emitSelectLost() { this.$emit('select-lost') },
    emitSelectionActive(payload) { this.$emit('selection-active', !!(payload && payload.active)) }
  }
}
</script>

<script module="bridge" lang="renderjs">
const EDGE_WIDTH = 68
const SWIPE_MIN = 50

export default {
  data() {
    return {
      installed: false,
      hasPointer: false,
      rightDrag: null,
      suppressMenuUntil: 0,
      lastArrowAt: 0,
      edgeToggleAt: 0,
      selectionTimer: null,
      lastSelected: '',
      // 最近一次按下是否来自鼠标：鼠标左键拖选只同步选区状态，不自动弹菜单（改右键触发）；
      // 手指拖动保持原行为
      lastInputWasMouse: false
    }
  },
  mounted() {
    // App 端视图层才存在 plus；H5 端由 utils/interaction.js 的逻辑层监听负责，避免双触发
    if (!this.isAppView()) return
    try { document.documentElement.classList.add('is-mobile-app') } catch (e) {}
    this.install()
  },
  methods: {
    isAppView() {
      if (typeof plus !== 'undefined') return true
      try { return /Html5Plus/i.test(navigator.userAgent || '') } catch (e) { return false }
    },
    call(name, payload) {
      const owner = this.$ownerInstance
      if (owner && typeof owner.callMethod === 'function') owner.callMethod(name, payload || {})
    },
    isEditable(target) {
      if (!target) return false
      if (target.isContentEditable) return true
      const el = target.nodeType === 3 ? target.parentElement : target
      return !!(el && el.closest && el.closest('input, textarea, select, [contenteditable]'))
    },
    hasModal() {
      try {
        return !!document.querySelector('.app-modal-mask.show, .picker-modal, .select-lookup')
      } catch (e) {
        return false
      }
    },
    getSelectionText() {
      try {
        const active = document.activeElement
        // 输入框里的选区不在 DOM selection 里，得从 selectionStart/End 读
        if (active && (active.tagName === 'TEXTAREA' ||
            (active.tagName === 'INPUT' && /^(text|search|url|tel|email|password|number)$/i.test(active.type || 'text')))) {
          const a = active.selectionStart
          const b = active.selectionEnd
          if (a != null && b != null && b > a) return String(active.value).slice(a, b)
        }
        const sel = window.getSelection ? window.getSelection() : null
        return sel ? String(sel.toString() || '') : ''
      } catch (e) {
        return ''
      }
    },
    selectionAnchor() {
      let x = 0
      let y = 0
      try {
        const sel = window.getSelection ? window.getSelection() : null
        if (sel && sel.rangeCount) {
          const rect = sel.getRangeAt(0).getBoundingClientRect()
          x = rect.left + rect.width / 2
          y = rect.top
        }
      } catch (e) { /* 拿不到矩形就由组件自己兜底定位 */ }
      return { x: x, y: y }
    },
    // 右侧边缘点击：点边缘展开 / 收起电话·短信，点内容区收起（对齐原版 practice.js）
    onClick(e) {
      const t = e.target
      // 点在按钮 / 输入框 / 滑块 / 按钮行 / 侧边栏自身时不算「右侧边缘点击」，
      // 否则点「语音输入」这类贴着右边缘的按钮会顺带把通话·短信栏弹出来
      if (t && t.closest && t.closest(
        'button, uni-button, a, input, uni-input, textarea, uni-textarea, label, uni-label, select, ' +
        'slider, uni-slider, [class*="btn"], [class*="button"], [class*="toggle"], .ask-side-nav, ' +
        '.select-lookup, .select-menu, .picker-modal, .tab-bar'
      )) return
      let x = e.clientX
      if (x == null && e.changedTouches && e.changedTouches[0]) x = e.changedTouches[0].clientX
      if (typeof x !== 'number' || x < 0) return
      const w = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0
      if (!w) return
      if (w - x < EDGE_WIDTH) {
        const now = Date.now()
        if (now - this.edgeToggleAt < 260) return
        this.edgeToggleAt = now
        this.call('emitEdge', { isEdge: true })
      } else {
        this.call('emitEdge', { isEdge: false })
      }
    },
    onPointerDown(e) {
      if (e.pointerType === 'touch') return
      if (e.button !== 2) return
      if (this.isEditable(e.target)) return
      this.rightDrag = { x: e.clientX, y: e.clientY }
    },
    // 记录本次交互是鼠标还是手指：鼠标左键（button 0）按下即视为鼠标选词
    onPrimaryDown(e) {
      if (e.pointerType === 'touch') { this.lastInputWasMouse = false; return }
      if (e.button === 0 || e.button == null) this.lastInputWasMouse = true
    },
    onTouchStart() {
      this.lastInputWasMouse = false
    },
    onPointerMove(e) {
      // 拖拽期间别让浏览器接管（原生拖影 / 选区）
      if (this.rightDrag && e.cancelable) e.preventDefault()
    },
    onPointerUp(e) {
      if (!this.rightDrag) return
      if (e.type === 'pointerup' && e.button != null && e.button !== 2) return
      const start = this.rightDrag
      this.rightDrag = null
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return
      this.suppressMenuUntil = Date.now() + 400
      this.call('emitNavigate', { dir: dx < 0 ? -1 : 1 })
    },
    onPointerCancel() { this.rightDrag = null },
    onKeyDown(e) {
      const key = e.key || (e.keyCode === 37 ? 'ArrowLeft' : e.keyCode === 39 ? 'ArrowRight' : '')
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (this.hasModal()) return
      if (this.isEditable(e.target)) return
      const now = Date.now()
      if (e.repeat && now - this.lastArrowAt < 120) return
      this.lastArrowAt = now
      if (e.cancelable) e.preventDefault()
      this.call('emitNavigate', { dir: key === 'ArrowRight' ? -1 : 1 })
    },
    onContextMenu(e) {
      // 刚用右键拖过页：压掉菜单，别打断拖拽
      if (Date.now() <= this.suppressMenuUntil) {
        if (e.cancelable) e.preventDefault()
        return
      }
      if (this.isEditable(e.target)) return
      const picked = this.getSelectionText().trim()
      if (!picked) return
      if (e.cancelable) e.preventDefault()
      this.lastSelected = picked
      const pos = this.selectionAnchor()
      this.call('emitSelect', { text: picked, x: pos.x, y: pos.y })
    },
    onSelectionChange() {
      clearTimeout(this.selectionTimer)
      this.selectionTimer = setTimeout(() => this.onSelectionSettled(), 320)
    },
    // 选区停稳再弹菜单，让用户还能拖动系统选字手柄扩大范围
    onSelectionSettled() {
      const picked = this.getSelectionText().trim()
      this.call('emitSelectionActive', { active: !!picked })
      if (!picked) {
        if (this.lastSelected) {
          this.lastSelected = ''
          this.call('emitSelectLost')
        }
        return
      }
      if (this.isEditable(document.activeElement)) return
      // 鼠标左键拖选：只同步选区状态，不自动弹菜单；菜单由右键点击触发（手指拖动仍自动弹）
      if (this.lastInputWasMouse) return
      if (picked === this.lastSelected) return
      this.lastSelected = picked
      const pos = this.selectionAnchor()
      this.call('emitSelect', { text: picked, x: pos.x, y: pos.y })
    },
    install() {
      if (this.installed) return
      if (window.__cetViewBridgeInstalled) return
      this.installed = true
      window.__cetViewBridgeInstalled = true
      const d = document
      this.hasPointer = typeof window.PointerEvent === 'function'
      const downEvent = this.hasPointer ? 'pointerdown' : 'mousedown'
      const moveEvent = this.hasPointer ? 'pointermove' : 'mousemove'
      const upEvent = this.hasPointer ? 'pointerup' : 'mouseup'
      d.addEventListener(downEvent, (e) => this.onPointerDown(e), { passive: true })
      d.addEventListener(downEvent, (e) => this.onPrimaryDown(e), { passive: true })
      d.addEventListener('touchstart', () => this.onTouchStart(), { passive: true })
      d.addEventListener(moveEvent, (e) => this.onPointerMove(e), { passive: false })
      d.addEventListener(upEvent, (e) => this.onPointerUp(e), { passive: true })
      if (this.hasPointer) d.addEventListener('pointercancel', () => this.onPointerCancel(), { passive: true })
      d.addEventListener('click', (e) => this.onClick(e))
      d.addEventListener('keydown', (e) => this.onKeyDown(e))
      d.addEventListener('contextmenu', (e) => this.onContextMenu(e))
      d.addEventListener('selectionchange', () => this.onSelectionChange())
    }
  }
}
</script>

<style scoped>
.view-bridge {
  display: none;
}
</style>
