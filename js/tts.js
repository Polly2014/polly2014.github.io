/**
 * Blog TTS — edge-tts 预生成音频 + 底部悬浮播放器 + Spotify 式段落高亮
 * 有 R2 mp3 → 显示 Listen 按钮；没有 → 不显示
 */
(function () {
  'use strict';

  var state = 'idle';
  var playbackRate = 1;
  var audio = null;
  var triggerBtn = null;
  var playerEl = null;
  var playBtn = null;
  var progressBar = null;
  var progressWrap = null;
  var timeDisplay = null;

  // ═══ 段落高亮 ═══
  var contentParagraphs = null;
  var totalTextLen = 0;
  var timingData = null;
  var lastHighlightIdx = -1;
  var currentHighlight = null;

  function buildParagraphMap() {
    if (contentParagraphs) return;
    var content = document.querySelector('.blog-post .content');
    if (!content) return;
    contentParagraphs = []; var cum = 0;
    content.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote').forEach(function(el) {
      if (el.closest('pre') || el.closest('.mermaid') || el.closest('code')) return;
      var t = (el.innerText || el.textContent || '').trim();
      if (t.length < 2) return;
      cum += t.length;
      contentParagraphs.push({ el: el, textLen: t.length, cumLen: cum });
    });
    totalTextLen = cum;
  }

  function highlightByCharOffset(charOffset) {
    if (!contentParagraphs || !contentParagraphs.length) return;
    var contentEl = document.querySelector('.blog-post .content');
    if (contentEl && !contentEl.classList.contains('tts-active')) contentEl.classList.add('tts-active');
    var idx = 0;
    for (var i = 0; i < contentParagraphs.length; i++) {
      if (contentParagraphs[i].cumLen > charOffset) { idx = i; break; }
      idx = i;
    }
    if (idx !== lastHighlightIdx) {
      clearHighlight();
      contentParagraphs[idx].el.classList.add('tts-reading');
      currentHighlight = contentParagraphs[idx].el;
      lastHighlightIdx = idx;
      contentParagraphs[idx].el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // 预建 timing 时间 → 段落索引映射
  var timingToParagraph = null;

  function buildTimingMap() {
    if (!timingData || !contentParagraphs || timingToParagraph) return;
    timingToParagraph = [];
    // 把段落文本拼接起来做子串搜索
    var paraTexts = contentParagraphs.map(function(p) { return p.el.innerText || p.el.textContent || ''; });
    var timCum = 0;
    for (var i = 0; i < timingData.length; i++) {
      var sentence = timingData[i].text;
      timCum += sentence.length;
      // 找这个 sentence 属于哪个段落：用 cumLen 对比
      var paraCum = 0, bestIdx = 0;
      for (var j = 0; j < contentParagraphs.length; j++) {
        paraCum += contentParagraphs[j].textLen;
        if (paraCum >= timCum) { bestIdx = j; break; }
        bestIdx = j;
      }
      timingToParagraph.push(bestIdx);
    }
  }

  function highlightByTime(t) {
    if (!timingData || !timingData.length) return;
    if (!timingToParagraph) buildTimingMap();
    // 找当前句子索引
    var sentIdx = 0;
    for (var i = 0; i < timingData.length; i++) {
      if (timingData[i].offset > t) break;
      sentIdx = i;
    }
    var paraIdx = timingToParagraph ? timingToParagraph[sentIdx] : 0;
    if (paraIdx !== lastHighlightIdx && contentParagraphs && contentParagraphs[paraIdx]) {
      var contentEl = document.querySelector('.blog-post .content');
      if (contentEl && !contentEl.classList.contains('tts-active')) contentEl.classList.add('tts-active');
      clearHighlight();
      contentParagraphs[paraIdx].el.classList.add('tts-reading');
      currentHighlight = contentParagraphs[paraIdx].el;
      lastHighlightIdx = paraIdx;
      contentParagraphs[paraIdx].el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function clearHighlight() {
    if (currentHighlight) { currentHighlight.classList.remove('tts-reading'); currentHighlight = null; }
  }

  function clearAll() {
    clearHighlight(); lastHighlightIdx = -1;
    var c = document.querySelector('.blog-post .content');
    if (c) c.classList.remove('tts-active');
  }

  // ═══ 播放控制 ═══
  function play() { audio.play(); state = 'playing'; updateUI(); }
  function pause() { audio.pause(); state = 'paused'; updateUI(); }
  function stop() {
    audio.pause(); audio.currentTime = 0; state = 'idle'; updateUI(); clearAll();
    if (progressBar) progressBar.style.width = '0%';
    if (timeDisplay) timeDisplay.textContent = '';
  }
  function toggle() {
    if (state === 'idle' || state === 'paused') play();
    else pause();
  }

  function formatTime(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ═══ UI ═══
  function updateUI() {
    if (triggerBtn) {
      var isCover = triggerBtn.classList.contains('tts-trigger-cover');
      if (isCover) {
        triggerBtn.innerHTML = state === 'playing'
          ? '<svg class="tts-icon-pulse" style="width:20px;height:20px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 7.5a5 5 0 010 9" opacity=".6"/><path d="M19.5 4.5a9 9 0 010 15" opacity=".3"/></svg>'
          : '<svg style="width:20px;height:20px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 7.5a5 5 0 010 9" opacity=".6"/><path d="M19.5 4.5a9 9 0 010 15" opacity=".3"/></svg>';
        triggerBtn.classList.toggle('tts-trigger-playing', state !== 'idle');
      } else {
        triggerBtn.innerHTML = state === 'idle'
          ? '<svg class="tts-icon" style="width:16px;height:16px;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 7.5a5 5 0 010 9" opacity=".6"/><path d="M19.5 4.5a9 9 0 010 15" opacity=".3"/></svg>朗读全文'
          : '<svg class="tts-icon tts-icon-pulse" style="width:16px;height:16px;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 7.5a5 5 0 010 9" opacity=".6"/><path d="M19.5 4.5a9 9 0 010 15" opacity=".3"/></svg>播放中';
      }
    }
    if (playBtn) playBtn.textContent = state === 'playing' ? '⏸' : '▶';
    if (playerEl) {
      if (state === 'idle') playerEl.classList.remove('tts-player-show');
      else playerEl.classList.add('tts-player-show');
    }
  }

  function buildUI(audioUrl) {
    var wrap = document.getElementById('tts-trigger-wrap');
    if (!wrap) return;

    // 初始化 audio
    audio = new Audio(audioUrl);
    audio.preload = 'metadata';
    buildParagraphMap();

    // 加载 timing JSON
    fetch(audioUrl.replace(/\.mp3$/, '.json')).then(function(r) {
      return r.ok ? r.json() : null;
    }).then(function(d) { timingData = d; }).catch(function() {});

    audio.addEventListener('timeupdate', function () {
      if (!audio.duration) return;
      if (progressBar) progressBar.style.width = (audio.currentTime / audio.duration * 100) + '%';
      if (timeDisplay) timeDisplay.textContent = formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration);
      if (state === 'playing') {
        if (timingData) highlightByTime(audio.currentTime);
        else if (totalTextLen > 0) highlightByCharOffset(Math.floor(audio.currentTime / audio.duration * totalTextLen));
      }
    });
    audio.addEventListener('ended', function () {
      state = 'idle'; updateUI(); clearAll();
      if (progressBar) progressBar.style.width = '100%';
    });

    // Listen 按钮 — 有封面图挂在封面图上，没有则独立行
    var coverEl = document.querySelector('.cover-image');
    var svgIcon = '<svg style="width:20px;height:20px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 7.5a5 5 0 010 9" opacity=".6"/><path d="M19.5 4.5a9 9 0 010 15" opacity=".3"/></svg>';
    var svgIconPulse = '<svg class="tts-icon-pulse" style="width:20px;height:20px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 7.5a5 5 0 010 9" opacity=".6"/><path d="M19.5 4.5a9 9 0 010 15" opacity=".3"/></svg>';

    triggerBtn = document.createElement('button');
    triggerBtn.title = '朗读全文';
    triggerBtn.addEventListener('click', function () {
      if (state === 'idle') toggle();
      else if (playerEl) playerEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });

    if (coverEl) {
      // 有封面图 → 圆形喇叭图标浮在右下角
      triggerBtn.className = 'tts-trigger tts-trigger-cover';
      triggerBtn.innerHTML = svgIcon;
      coverEl.appendChild(triggerBtn);
    } else {
      // 没封面图 → 独立行主色按钮
      triggerBtn.className = 'tts-trigger tts-trigger-standalone';
      triggerBtn.innerHTML = '<svg style="width:16px;height:16px;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9v6h4l5 5V4L7 9H3z"/><path d="M16.5 7.5a5 5 0 010 9" opacity=".6"/><path d="M19.5 4.5a9 9 0 010 15" opacity=".3"/></svg>朗读全文';
      wrap.appendChild(triggerBtn);
    }

    // 底部悬浮播放器
    playerEl = document.createElement('div');
    playerEl.className = 'tts-player';
    playerEl.innerHTML =
      '<div class="tts-player-inner">' +
        '<button class="tts-p-btn tts-play" title="Play/Pause">▶</button>' +
        '<div class="tts-p-progress"><div class="tts-p-bar"></div></div>' +
        '<span class="tts-p-time"></span>' +
        '<button class="tts-p-btn tts-speed" title="Speed">1×</button>' +
        '<button class="tts-p-btn tts-close" title="Stop">✕</button>' +
      '</div>';
    document.body.appendChild(playerEl);

    playBtn = playerEl.querySelector('.tts-play');
    progressWrap = playerEl.querySelector('.tts-p-progress');
    progressBar = playerEl.querySelector('.tts-p-bar');
    timeDisplay = playerEl.querySelector('.tts-p-time');

    var speedBtn = playerEl.querySelector('.tts-speed');
    var speeds = [1, 1.25, 1.5, 2], speedIdx = 0;

    playBtn.addEventListener('click', toggle);
    playerEl.querySelector('.tts-close').addEventListener('click', stop);
    speedBtn.addEventListener('click', function () {
      speedIdx = (speedIdx + 1) % speeds.length;
      playbackRate = speeds[speedIdx];
      speedBtn.textContent = playbackRate + '×';
      if (audio) audio.playbackRate = playbackRate;
    });
    progressWrap.addEventListener('click', function (e) {
      if (!audio || !audio.duration) return;
      var r = progressWrap.getBoundingClientRect();
      audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    });
  }

  // ═══ 初始化 ═══
  function init() {
    var wrap = document.getElementById('tts-trigger-wrap');
    if (!wrap) return;

    var slug = location.pathname.replace(/^\/|\/$/g, '');
    var audioUrl = 'https://audio.polly.wang/' + slug + '/audio.mp3';

    // 探测 mp3 是否存在，有才显示按钮
    var probe = new Audio();
    probe.preload = 'metadata';
    var t = setTimeout(function () { /* 超时不显示 */ }, 5000);
    probe.addEventListener('loadedmetadata', function () {
      clearTimeout(t);
      buildUI(audioUrl);
    });
    probe.addEventListener('error', function () {
      clearTimeout(t);
      // 没有 mp3 → 不显示任何东西
    });
    probe.src = audioUrl;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.addEventListener('beforeunload', function () { if (audio) audio.pause(); });
})();
