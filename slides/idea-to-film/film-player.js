// data-ignore prevents Reveal from loading/starting media as slides enter view.
// Show one start button, then hand playback over to native controls.
(() => {
  const video = document.getElementById('full-film')
  const button = document.querySelector('.film-play')
  const status = document.getElementById('film-status')
  if (!video || !button || !status) return
  let failed = false
  let attempt = 0
  const setCinemaMode = active => document.body.classList.toggle('cinema-mode', active)
  const pauseFilm = () => {
    video.pause()
    setCinemaMode(false)
  }
  const showError = () => {
    failed = true
    setCinemaMode(false)
    video.controls = false
    status.textContent = '视频加载失败，可重试或单独打开视频。'
    button.hidden = false
    button.disabled = false
  }
  button.addEventListener('click', async event => {
    event.stopPropagation()
    const currentAttempt = ++attempt
    status.textContent = ''
    button.disabled = true
    try {
      if (video.error || failed) {
        failed = false
        video.load()
      }
      await video.play()
      if (currentAttempt === attempt) button.hidden = true
    } catch {
      if (currentAttempt === attempt) showError()
    } finally {
      if (currentAttempt === attempt) button.disabled = false
    }
  })
  video.addEventListener('playing', () => {
    button.hidden = true
    video.controls = true
    status.textContent = ''
    if (document.hidden || (window.Reveal && Reveal.getCurrentSlide()?.id !== 'result')) {
      pauseFilm()
      return
    }
    setCinemaMode(true)
  })
  for (const event of ['pause', 'ended', 'emptied']) {
    video.addEventListener(event, () => setCinemaMode(false))
  }
  // <source> errors do not bubble, and can leave play() pending in Chromium.
  video.addEventListener('error', showError, true)
  if (window.Reveal) {
    Reveal.on('slidechanged', event => {
      if (event.currentSlide.id !== 'result') pauseFilm()
    })
    Reveal.on('overviewshown', pauseFilm)
    Reveal.on('paused', pauseFilm)
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseFilm()
  })
  window.addEventListener('pagehide', pauseFilm)
  // The HTML retains native controls as a fallback if this script cannot load.
  video.controls = false
  button.hidden = false
})()
