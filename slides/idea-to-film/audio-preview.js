// A local, explicit-click sample. Reveal must neither preload nor autoplay it.
(() => {
  const audio = document.getElementById('brand-audio-preview')
  const button = document.getElementById('brand-audio-play')
  const status = document.getElementById('brand-audio-status')
  if (!audio || !button || !status) return
  const slide = button.closest('section')
  const label = button.querySelector('.brand-audio-label')
  const icon = button.querySelector('.brand-audio-icon')
  let requested = false
  let attempt = 0
  const isActive = () => !document.hidden && (!window.Reveal ||
    (Reveal.getCurrentSlide() === slide && !Reveal.isOverview() && !Reveal.isPaused()))
  const render = active => {
    const text = active ? '停止试听' : '试听片尾旁白 · 约3秒'
    button.setAttribute('aria-pressed', String(active))
    button.setAttribute('aria-label', text)
    label.textContent = text
    icon.textContent = active ? '■' : '▶'
  }
  const stop = () => {
    attempt++
    requested = false
    audio.pause()
    if (audio.readyState > 0) audio.currentTime = 0
    button.removeAttribute('aria-busy')
    status.textContent = ''
    render(false)
  }
  const fail = () => {
    stop()
    status.textContent = '试听暂时无法播放，请点击重试。'
  }
  button.addEventListener('click', async event => {
    event.stopPropagation()
    if (requested || !audio.paused) return stop()
    if (!isActive()) return
    requested = true
    const currentAttempt = ++attempt
    render(true)
    button.setAttribute('aria-busy', 'true')
    status.textContent = '正在加载…'
    try {
      if (!audio.hasAttribute('src')) audio.src = audio.dataset.previewSrc
      else if (audio.error) audio.load()
      await audio.play()
      if (currentAttempt !== attempt) return
      if (!isActive()) return stop()
      button.removeAttribute('aria-busy')
      status.textContent = ''
    } catch {
      // Stopping or leaving while play() is pending is intentional, not an error.
      if (currentAttempt === attempt) fail()
    }
  })
  button.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
  })
  audio.addEventListener('playing', () => {
    if (!requested || !isActive()) stop()
  })
  audio.addEventListener('ended', stop)
  audio.addEventListener('error', () => { if (requested) fail() })
  if (window.Reveal) {
    Reveal.on('slidechanged', () => { if (!isActive()) stop() })
    Reveal.on('overviewshown', stop)
    Reveal.on('paused', stop)
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop() })
  window.addEventListener('pagehide', stop)
})()
