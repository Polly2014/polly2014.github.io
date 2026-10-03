// The existing reader owns the dialog/focus behavior. This owns only the clip.
// No video URL is assigned until the audience activates its preview entry.
(() => {
  const trigger = document.getElementById('ending-prompt-trigger')
  const dialog = document.getElementById('ending-prompt-dialog')
  const video = document.getElementById('ending-preview')
  const status = dialog?.querySelector('[role="status"]')
  if (!trigger || !dialog || !video || !status) return
  const hint = dialog.dataset.readingHint
  let attempt = 0
  let failed = false
  const visible = () => dialog.open && !document.hidden &&
    (!window.Reveal || Reveal.getCurrentSlide()?.id === 'delivery')
  const stop = (reset = true) => {
    ++attempt
    video.pause()
    if (reset && video.readyState > 0) video.currentTime = 0
  }
  const close = () => {
    stop()
    if (dialog.open) dialog.close()
  }
  const showError = () => {
    failed = true
    if (dialog.open) status.textContent = '视频加载失败，请关闭后重新打开预览重试。'
  }
  trigger.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
  })
  trigger.addEventListener('click', async () => {
    // Registered after the reader's click handler, which opens the dialog.
    if (!visible()) return
    const currentAttempt = ++attempt
    status.textContent = '正在加载画面… · 无声预览'
    if (!video.getAttribute('src')) {
      video.src = video.dataset.previewSrc
    } else if (failed || video.error) {
      failed = false
      video.load()
    }
    if (video.readyState > 0) video.currentTime = 0
    try {
      await video.play()
    } catch {
      if (currentAttempt === attempt && visible()) showError()
    }
  })
  video.addEventListener('playing', () => {
    if (!visible()) {
      stop(!dialog.open)
      return
    }
    status.textContent = hint
  })
  video.addEventListener('ended', () => {
    status.textContent = '播放结束，可用视频控件重播 · 无声预览 · Esc 关闭'
  })
  video.addEventListener('error', showError)
  dialog.addEventListener('close', () => { if (!dialog.open) stop() })
  if (window.Reveal) {
    Reveal.on('slidechanged', () => {
      if (Reveal.getCurrentSlide()?.id !== 'delivery') close()
    })
    Reveal.on('overviewshown', close)
    Reveal.on('paused', close)
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(false) })
  window.addEventListener('pagehide', close)
})()
