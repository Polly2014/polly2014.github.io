// Independent prompt/document readers with shared previews; no remote requests.
(() => {
  const readers = [...document.querySelectorAll('.generation-prompt-trigger[aria-haspopup="dialog"]')].map(trigger => {
    const slide = trigger.closest('section')
    const dialog = document.getElementById(trigger.getAttribute('aria-controls'))
    const prompt = dialog?.querySelector('pre')
    const copy = dialog?.querySelector('.prompt-dialog-footer button')
    const status = dialog?.querySelector('[role="status"]')
    return { slide, trigger, dialog, prompt, copy, status }
  }).filter(reader => reader.slide && reader.trigger && reader.dialog && reader.status)
  if (!readers.length) return
  const modalOpen = () => readers.some(reader => reader.dialog.open)
  let hoverDismissedByKeyboard = false

  const wrappers = [...new Set(readers.flatMap(reader => [...reader.slide.querySelectorAll('.generation-detail')]))]
  const previews = wrappers.map(wrapper => {
    const button = wrapper.querySelector('button')
    const panel = wrapper.querySelector('.generation-preview')
    const isPrompt = button.getAttribute('aria-haspopup') === 'dialog'
    let hovered = false
    let focused = false
    let pinned = false
    let dismissed = false
    let leaveTimer
    const render = () => {
      panel.hidden = dismissed || modalOpen() || !(hovered || focused || pinned)
      if (!isPrompt) button.setAttribute('aria-expanded', String(!panel.hidden))
      if (!panel.hidden) previews.forEach(preview => {
        if (preview.panel !== panel) preview.dismiss()
      })
    }
    const dismiss = () => {
      clearTimeout(leaveTimer)
      pinned = false
      dismissed = true
      render()
    }
    wrapper.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch' || hoverDismissedByKeyboard) return
      clearTimeout(leaveTimer)
      hovered = true
      dismissed = false
      render()
    })
    // Hiding a tooltip can uncover a tag under a stationary pointer. Do not
    // reopen it after Escape until the reader actually moves the pointer.
    wrapper.addEventListener('pointermove', event => {
      if (!hoverDismissedByKeyboard || event.pointerType === 'touch' || !(event.movementX || event.movementY)) return
      hoverDismissedByKeyboard = false
      hovered = true
      dismissed = false
      render()
    })
    wrapper.addEventListener('pointerleave', () => {
      hovered = false
      leaveTimer = setTimeout(() => { if (!focused && !pinned) dismiss() }, 140)
    })
    wrapper.addEventListener('focusin', () => {
      focused = true
      dismissed = false
      render()
    })
    wrapper.addEventListener('focusout', event => {
      if (wrapper.contains(event.relatedTarget)) return
      focused = false
      pinned = false
      if (!hovered) dismiss()
    })
    if (!isPrompt) button.addEventListener('click', event => {
      event.stopPropagation()
      pinned = !pinned
      dismissed = !pinned
      render()
    })
    return { wrapper, panel, dismiss }
  })
  const dismissPreviews = () => previews.forEach(preview => preview.dismiss())
  document.addEventListener('pointerdown', event => {
    previews.forEach(preview => {
      if (!preview.wrapper.contains(event.target)) preview.dismiss()
    })
  })
  // Escape dismisses a tooltip before Reveal can interpret it as overview mode.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || modalOpen() || !previews.some(preview => !preview.panel.hidden)) return
    event.preventDefault()
    event.stopImmediatePropagation()
    hoverDismissedByKeyboard = true
    dismissPreviews()
  }, true)

  readers.forEach(({ slide, trigger, dialog, prompt, copy, status }) => {
  trigger.addEventListener('click', event => {
    event.stopPropagation()
    dismissPreviews()
    status.textContent = dialog.dataset.readingHint || 'Esc 关闭 · 全文可滚动阅读'
    dialog.showModal()
    dialog.querySelector('.prompt-dialog-body').scrollTop = 0
    trigger.setAttribute('aria-expanded', 'true')
  })
  dialog.querySelector('.prompt-dialog-close').addEventListener('click', () => dialog.close())
  // Keep reading keys away from Reveal; wrap Tab at the reader's boundaries.
  dialog.addEventListener('keydown', event => {
    event.stopPropagation()
    if (event.key !== 'Tab') return
    const stops = [...dialog.querySelectorAll('button:not(:disabled), [tabindex="0"]')]
    const first = stops[0]
    const last = stops[stops.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus({ preventScroll: true })
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus({ preventScroll: true })
    }
  })
  dialog.addEventListener('close', () => {
    trigger.setAttribute('aria-expanded', 'false')
    if (!window.Reveal || Reveal.getCurrentSlide() === slide) trigger.focus({ preventScroll: true })
    dismissPreviews()
  })
  let backdropStart = false
  const outsideDialog = event => {
    const rect = dialog.getBoundingClientRect()
    return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
  }
  dialog.addEventListener('pointerdown', event => { backdropStart = outsideDialog(event) })
  dialog.addEventListener('click', event => {
    if (backdropStart && outsideDialog(event)) dialog.close()
    backdropStart = false
  })
  if (copy && prompt) copy.addEventListener('click', async () => {
    copy.disabled = true
    try {
      await navigator.clipboard.writeText(prompt.textContent)
      status.textContent = '已复制完整 Prompt'
    } catch {
      // No clipboard permission: offer an honest, selectable fallback.
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(prompt)
      selection.removeAllRanges()
      selection.addRange(range)
      status.textContent = '未能自动复制，已选中全文，请按 ⌘C / Ctrl+C。'
    } finally {
      copy.disabled = false
    }
  })
  })
  if (window.Reveal) {
    Reveal.on('slidechanged', () => {
      readers.forEach(({ dialog }) => { if (dialog.open) dialog.close() })
      dismissPreviews()
    })
    Reveal.on('overviewshown', dismissPreviews)
  }
})()
