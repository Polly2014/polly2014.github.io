/**
 * Blog TTS — edge-tts 预生成音频 + Web Speech API fallback
 *
 * 优先级：
 *   1. 同目录下的 audio.mp3（由 scripts/generate-tts.py 生成）→ <audio> 播放
 *   2. 浏览器 Web Speech API → 逐段朗读（fallback）
 */
(function () {
  'use strict';

  var state = 'idle';   // idle | playing | paused
  var mode = null;       // 'audio' | 'speech'
  var btn = null;
  var stopBtnEl = null;
  var progressBar = null;
  var timeDisplay = null;

  // ═══════════════════════════════════════════
  //  Mode A: <audio> 播放预生成 mp3
  // ═══════════════════════════════════════════
  var audio = null;

  function audioPlay() {
    audio.play();
    state = 'playing';
    updateButton();
  }

  function audioPause() {
    audio.pause();
    state = 'paused';
    updateButton();
  }

  function audioStop() {
    audio.pause();
    audio.currentTime = 0;
    state = 'idle';
    updateButton();
    if (progressBar) progressBar.style.width = '0%';
    if (timeDisplay) timeDisplay.textContent = '';
  }

  function audioToggle() {
    switch (state) {
      case 'idle':    audioPlay();  break;
      case 'playing': audioPause(); break;
      case 'paused':  audioPlay();  break;
    }
  }

  function formatTime(sec) {
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function initAudioMode(audioUrl) {
    mode = 'audio';
    audio = new Audio(audioUrl);
    audio.preload = 'metadata';

    audio.addEventListener('timeupdate', function () {
      if (!audio.duration) return;
      var pct = (audio.currentTime / audio.duration) * 100;
      if (progressBar) progressBar.style.width = pct + '%';
      if (timeDisplay) {
        timeDisplay.textContent = formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration);
      }
    });

    audio.addEventListener('ended', function () {
      state = 'idle';
      updateButton();
      if (progressBar) progressBar.style.width = '100%';
    });

    // 点击进度条跳转
    var progressWrap = document.querySelector('.tts-progress-wrap');
    if (progressWrap) {
      progressWrap.style.cursor = 'pointer';
      progressWrap.addEventListener('click', function (e) {
        if (!audio.duration) return;
        var rect = progressWrap.getBoundingClientRect();
        var ratio = (e.clientX - rect.left) / rect.width;
        audio.currentTime = ratio * audio.duration;
      });
    }
  }

  // ═══════════════════════════════════════════
  //  Mode B: Web Speech API fallback
  // ═══════════════════════════════════════════
  var synth = window.speechSynthesis;
  var paragraphs = [];
  var currentIdx = 0;
  var currentHighlight = null;
  var zhVoice = null;
  var enVoice = null;

  function pickVoices() {
    var voices = synth.getVoices();
    if (!voices.length) return;
    var zh = voices.filter(function (v) { return /zh[-_]CN/i.test(v.lang); });
    zhVoice = zh.find(function (v) { return /Tingting|Siri/i.test(v.name); }) || zh[0] || null;
    var en = voices.filter(function (v) { return /en[-_]US/i.test(v.lang); });
    enVoice = en.find(function (v) { return /Samantha|Daniel|Siri/i.test(v.name); }) || en[0] || null;
  }

  function isMostlyChinese(text) {
    var cn = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    return cn / (text.replace(/\s/g, '').length || 1) > 0.3;
  }

  function collectParagraphs() {
    var content = document.querySelector('.blog-post .content');
    if (!content) return [];
    var nodes = content.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote');
    var result = [];
    nodes.forEach(function (el) {
      if (el.closest('pre') || el.closest('.mermaid') || el.closest('code')) return;
      var text = (el.innerText || el.textContent || '').trim();
      if (text.length < 2) return;
      result.push({ el: el, text: text });
    });
    return result;
  }

  function highlight(el) {
    clearHighlight();
    if (!el) return;
    el.classList.add('tts-reading');
    currentHighlight = el;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearHighlight() {
    if (currentHighlight) {
      currentHighlight.classList.remove('tts-reading');
      currentHighlight = null;
    }
  }

  function speakParagraph(idx) {
    if (idx >= paragraphs.length) { speechStop(); return; }
    currentIdx = idx;
    var p = paragraphs[idx];
    var utter = new SpeechSynthesisUtterance(p.text);
    if (isMostlyChinese(p.text)) {
      if (zhVoice) utter.voice = zhVoice;
      utter.lang = 'zh-CN'; utter.rate = 1.1;
    } else {
      if (enVoice) utter.voice = enVoice;
      utter.lang = 'en-US'; utter.rate = 1.0;
    }
    highlight(p.el);
    if (progressBar && paragraphs.length) {
      progressBar.style.width = Math.round(((idx + 1) / paragraphs.length) * 100) + '%';
    }
    utter.onend = function () { if (state === 'playing') speakParagraph(idx + 1); };
    utter.onerror = function () { if (state === 'playing') speakParagraph(idx + 1); };
    synth.speak(utter);
  }

  // Chrome 15s workaround
  var chromeTimer = null;
  function startChromeWA() {
    if (chromeTimer) return;
    if (!/Chrome/i.test(navigator.userAgent) || /Edg/i.test(navigator.userAgent)) return;
    chromeTimer = setInterval(function () {
      if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); }
    }, 10000);
  }
  function stopChromeWA() { if (chromeTimer) { clearInterval(chromeTimer); chromeTimer = null; } }

  function speechPlay() {
    paragraphs = collectParagraphs();
    if (!paragraphs.length) return;
    synth.cancel();
    state = 'playing';
    updateButton();
    startChromeWA();
    speakParagraph(currentIdx);
  }

  function speechPause() {
    synth.pause();
    state = 'paused';
    updateButton();
    stopChromeWA();
  }

  function speechResume() {
    synth.resume();
    state = 'playing';
    updateButton();
    startChromeWA();
  }

  function speechStop() {
    synth.cancel();
    state = 'idle';
    currentIdx = 0;
    clearHighlight();
    updateButton();
    stopChromeWA();
    if (progressBar) progressBar.style.width = '0%';
  }

  function speechToggle() {
    switch (state) {
      case 'idle':    speechPlay();   break;
      case 'playing': speechPause();  break;
      case 'paused':  speechResume(); break;
    }
  }

  function initSpeechMode() {
    mode = 'speech';
    if (synth.onvoiceschanged !== undefined) synth.onvoiceschanged = pickVoices;
    pickVoices();
  }

  // ═══════════════════════════════════════════
  //  统一接口
  // ═══════════════════════════════════════════
  function toggle() {
    if (mode === 'audio') audioToggle();
    else speechToggle();
  }

  function stop() {
    if (mode === 'audio') audioStop();
    else speechStop();
  }

  function updateButton() {
    if (!btn) return;
    var labels = {
      idle:    ['🔊 朗读', '朗读全文'],
      playing: ['⏸ 暂停',  '暂停朗读'],
      paused:  ['▶ 继续',  '继续朗读']
    };
    btn.innerHTML = labels[state][0];
    btn.title = labels[state][1];
    // 显示/隐藏停止按钮
    if (stopBtnEl) stopBtnEl.style.display = (state === 'idle') ? 'none' : '';
  }

  // ═══════════════════════════════════════════
  //  初始化
  // ═══════════════════════════════════════════
  function init() {
    var meta = document.querySelector('.post-meta');
    if (!meta) return;

    // 构建 UI
    var container = document.createElement('span');
    container.className = 'tts-controls';

    btn = document.createElement('button');
    btn.className = 'tts-btn';
    btn.innerHTML = '🔊 朗读';
    btn.title = '朗读全文';
    btn.addEventListener('click', toggle);

    stopBtnEl = document.createElement('button');
    stopBtnEl.className = 'tts-btn tts-stop';
    stopBtnEl.innerHTML = '⏹';
    stopBtnEl.title = '停止朗读';
    stopBtnEl.style.display = 'none';
    stopBtnEl.addEventListener('click', stop);

    var progressWrap = document.createElement('span');
    progressWrap.className = 'tts-progress-wrap';
    progressBar = document.createElement('span');
    progressBar.className = 'tts-progress-bar';
    progressWrap.appendChild(progressBar);

    timeDisplay = document.createElement('span');
    timeDisplay.className = 'tts-time';

    container.appendChild(btn);
    container.appendChild(stopBtnEl);
    container.appendChild(progressWrap);
    container.appendChild(timeDisplay);
    meta.appendChild(container);

    // 探测 R2 上的 audio.mp3 是否存在
    // 用 Audio 元素直接加载 metadata，避免 XHR 跨域 CORS 问题
    var slug = location.pathname.replace(/^\/|\/$/g, '');
    var audioUrl = 'https://audio.polly.wang/' + slug + '/audio.mp3';
    var probe = new Audio();
    probe.preload = 'metadata';
    var probeTimeout = setTimeout(function () { fallbackToSpeech(); }, 5000);
    probe.addEventListener('loadedmetadata', function () {
      clearTimeout(probeTimeout);
      initAudioMode(audioUrl);
    });
    probe.addEventListener('error', function () {
      clearTimeout(probeTimeout);
      fallbackToSpeech();
    });
    probe.src = audioUrl;
  }

  function fallbackToSpeech() {
    if (!('speechSynthesis' in window)) {
      // 完全不支持 → 隐藏按钮
      var c = document.querySelector('.tts-controls');
      if (c) c.style.display = 'none';
      return;
    }
    initSpeechMode();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.addEventListener('beforeunload', function () {
    if (audio) { audio.pause(); }
    if (synth) { synth.cancel(); }
    stopChromeWA();
  });
})();
