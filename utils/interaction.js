/**
 * 页面交互适配层：鼠标 / 外接键盘 / 文字选区 / 右侧边缘点击
 * ------------------------------------------------------------------
 * 对齐 HTML 原版 js/script.js、js/practice.js 的手势规则（左右滑、右键拖拽、方向键、
 * 选词查词、点右侧 68px 边缘展开电话按钮）。
 *
 * 关键点：uni-app App 端「逻辑层与视图层分离」，页面 JS 跑在 service webview 里，
 * 拿不到渲染层的 document —— 逻辑层里挂 document 监听收不到任何页面事件
 * （这正是「点右边缘弹不出电话 / 短信、方向键与右键拖拽不切页、选词查词失效」的根因）。
 * 所以：
 *   - App 端：由 components/ViewBridge.vue 的 renderjs 在视图层监听，再 callMethod 回传，
 *     本文件用 provide(VIEW_BRIDGE_KEY) 把处理函数交给 AppShell 渲染的 ViewBridge 绑定；
 *   - H5 端：逻辑层与视图层同环境，document 可用，仍走下面的 DOM 监听（条件编译隔离）。
 *
 * 方向约定与原版一致：dir < 0 前进，dir > 0 后退。
 */
import { provide, ref, onUnmounted } from 'vue'
// #ifdef H5
import { onShow, onHide } from '@dcloudio/uni-app'
// #endif

/** AppShell 注入本 key 拿到桥接处理函数，交给 ViewBridge 绑定 v-on */
export const VIEW_BRIDGE_KEY = Symbol('cet-view-bridge')

export const SWIPE_MIN = 50
// 原版 practice.js：页面右边缘 68px 内的空白点击用来展开 / 收起右侧电话按钮
export const EDGE_WIDTH = 68

/** 当前 DOM 里选中的文字（H5 用；App 端由 ViewBridge 上报的 isSelecting 代替） */
export function getSelectedText() {
  // #ifdef H5
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
  } catch (err) {
    return ''
  }
  // #endif
  return ''
}

/**
 * 在页面上注册交互。参数：
 *   onNavigate(dir)        dir < 0 前进（下一句 / 题目屏），dir > 0 后退
 *   onSelect(text, x, y)   选区稳定 / 右键点击选中文字 → 弹前端「复制 / 查词」
 *   onSelectionLost()      选区被清掉 → 收起前端菜单
 *   canSelect()            返回 false 时不弹查词菜单（如做题页未交卷）
 *   onEdgeClick(isEdge)    点右边缘 68px 内传 true，点其它内容区传 false；
 *                          页面自行 toggle / 收起侧栏，保持状态由页面持有
 *
 * 返回 { isSelecting }：App 端是否正在选词（用于手势判定别把选中的字翻走）。
 */
export function usePageInteractions(options = {}) {
  const {
    onNavigate = () => {},
    onSelect = () => {},
    onSelectionLost = () => {},
    canSelect = () => true,
    onEdgeClick = () => {}
  } = options

  const selecting = ref(false)

  // 视图层 ViewBridge 的事件 → 业务回调；provide 给 AppShell 拿去绑定
  const bridgeHandlers = {
    edge: (isEdge) => onEdgeClick(!!isEdge),
    navigate: (dir) => onNavigate(dir),
    select: (text, x, y) => { if (canSelect()) onSelect(text, x, y) },
    'select-lost': () => onSelectionLost(),
    'selection-active': (active) => { selecting.value = !!active }
  }
  provide(VIEW_BRIDGE_KEY, bridgeHandlers)

  // ==================== H5：逻辑层与视图层同环境，直接听 document ====================
  // #ifdef H5
  const hasPointer = typeof window !== 'undefined' && typeof window.PointerEvent === 'function'
  const downEvent = hasPointer ? 'pointerdown' : 'mousedown'
  const moveEvent = hasPointer ? 'pointermove' : 'mousemove'
  const upEvent = hasPointer ? 'pointerup' : 'mouseup'

  let installed = false
  let rightDrag = null
  let suppressMenuUntil = 0
  let lastArrowAt = 0
  let selectionTimer = null
  let lastSelected = ''
  // 最近一次按下是否来自鼠标：鼠标左键拖选只同步选区状态，不自动弹菜单（改右键触发）；
  // 手指拖动保持原行为（3 秒内没有鼠标按下就当作触摸）。
  let lastInputWasMouse = false

  function isEditable(target) {
    if (!target) return false
    if (target.isContentEditable) return true
    const el = target.nodeType === 3 ? target.parentElement : target
    return !!(el && el.closest && el.closest('input, textarea, select, [contenteditable]'))
  }

  function hasModal() {
    try {
      return !!document.querySelector('.app-modal-mask.show, .picker-modal, .select-lookup')
    } catch (err) {
      return false
    }
  }

  function onRightDragDown(e) {
    if (e.pointerType === 'touch') return           // 手指走 touchstart/touchend
    if (e.button !== 2) return                     // 只认右键
    if (isEditable(e.target)) return               // 输入框里保留系统右键菜单
    rightDrag = { x: e.clientX, y: e.clientY }
  }

  // 记录本次交互是鼠标还是手指：鼠标左键（button 0）按下即视为鼠标选词
  function onPrimaryDown(e) {
    if (e.pointerType === 'touch') { lastInputWasMouse = false; return }
    if (e.button === 0 || e.button == null) lastInputWasMouse = true
  }

  function onTouchStart() {
    lastInputWasMouse = false
  }

  function onRightDragMove(e) {
    if (rightDrag && e.cancelable) e.preventDefault()
  }

  function onRightDragUp(e) {
    if (!rightDrag) return
    if (e.type === 'pointerup' && e.button != null && e.button !== 2) return
    const start = rightDrag
    rightDrag = null
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy)) return
    suppressMenuUntil = Date.now() + 400
    bridgeHandlers.navigate(dx < 0 ? -1 : 1)
  }

  function onRightDragCancel() {
    rightDrag = null
  }

  function onContextMenu(e) {
    if (Date.now() <= suppressMenuUntil) {
      if (e.cancelable) e.preventDefault()
      return
    }
    if (isEditable(e.target)) return
    const picked = getSelectedText().trim()
    if (!picked || !canSelect()) return
    if (e.cancelable) e.preventDefault()
    lastSelected = picked
    bridgeHandlers.select(picked, e.clientX, e.clientY)
  }

  function onKeyDown(e) {
    const key = e.key || (e.keyCode === 37 ? 'ArrowLeft' : e.keyCode === 39 ? 'ArrowRight' : '')
    if (key !== 'ArrowLeft' && key !== 'ArrowRight') return
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
    if (hasModal()) return
    if (isEditable(e.target)) return
    const now = Date.now()
    if (e.repeat && now - lastArrowAt < 120) return
    lastArrowAt = now
    if (e.cancelable) e.preventDefault()
    bridgeHandlers.navigate(key === 'ArrowRight' ? -1 : 1)
  }

  function onSelectionSettled() {
    const picked = getSelectedText().trim()
    bridgeHandlers['selection-active'](!!picked)
    if (!picked) {
      if (lastSelected) {
        lastSelected = ''
        bridgeHandlers['select-lost']()
      }
      return
    }
    if (isEditable(document.activeElement)) return
    if (!canSelect()) return
    // 鼠标左键拖选：只同步选区状态，不自动弹菜单；菜单由右键点击触发（手指拖动仍自动弹）
    if (lastInputWasMouse) return
    if (picked === lastSelected) return
    lastSelected = picked
    let x = 0
    let y = 0
    try {
      const sel = window.getSelection ? window.getSelection() : null
      if (sel && sel.rangeCount) {
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        x = rect.left + rect.width / 2
        y = rect.top
      }
    } catch (err) { /* 拿不到矩形就由组件自己兜底定位 */ }
    bridgeHandlers.select(picked, x, y)
  }

  function onSelectionChange() {
    clearTimeout(selectionTimer)
    selectionTimer = setTimeout(onSelectionSettled, 320)
  }

  function handleEdgeClick(e) {
    const t = e.target
    // 按钮 / 输入框 / 滑块 / 按钮行 / 侧边栏自身不参与边缘点击判定，
    // 避免点「语音输入」等贴右边缘的按钮时把通话·短信栏弹出来
    if (t && t.closest && t.closest(
      'button, uni-button, a, input, uni-input, textarea, uni-textarea, label, uni-label, select, ' +
      'slider, uni-slider, [class*="btn"], [class*="button"], [class*="toggle"], .ask-side-nav, ' +
      '.select-lookup, .select-menu, .picker-modal, .tab-bar'
    )) return
    let x = e.clientX
    if (x == null && e.changedTouches && e.changedTouches[0]) x = e.changedTouches[0].clientX
    if (typeof x !== 'number' || x < 0) return
    const w = (window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 0)
    if (!w) return
    bridgeHandlers.edge(w - x < EDGE_WIDTH)
  }

  function install() {
    if (installed) return
    installed = true
    const d = document
    d.addEventListener(downEvent, onRightDragDown, { passive: true })
    d.addEventListener(downEvent, onPrimaryDown, { passive: true })
    d.addEventListener('touchstart', onTouchStart, { passive: true })
    d.addEventListener(moveEvent, onRightDragMove, { passive: false })
    d.addEventListener(upEvent, onRightDragUp, { passive: true })
    if (hasPointer) d.addEventListener('pointercancel', onRightDragCancel, { passive: true })
    d.addEventListener('contextmenu', onContextMenu)
    d.addEventListener('keydown', onKeyDown)
    d.addEventListener('selectionchange', onSelectionChange)
    d.addEventListener('click', handleEdgeClick)
  }

  function uninstall() {
    if (!installed) return
    installed = false
    clearTimeout(selectionTimer)
    rightDrag = null
    lastSelected = ''
    const d = document
    d.removeEventListener(downEvent, onRightDragDown)
    d.removeEventListener(downEvent, onPrimaryDown)
    d.removeEventListener('touchstart', onTouchStart)
    d.removeEventListener(moveEvent, onRightDragMove)
    d.removeEventListener(upEvent, onRightDragUp)
    if (hasPointer) d.removeEventListener('pointercancel', onRightDragCancel)
    d.removeEventListener('contextmenu', onContextMenu)
    d.removeEventListener('keydown', onKeyDown)
    d.removeEventListener('selectionchange', onSelectionChange)
    d.removeEventListener('click', handleEdgeClick)
  }

  onShow(install)
  onHide(uninstall)
  onUnmounted(uninstall)
  // #endif

  return { isSelecting: () => selecting.value }
}
