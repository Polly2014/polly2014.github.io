/**
 * Blog TTS — 底部悬浮迷你播放器
 *
 * - post-meta 里放一个小 🔊 触发按钮
 * - 播放时底部弹出磨砂玻璃播放器
 * - 优先 R2 mp3，fallback Web Speech API
 */
(function () {
  'use strict';

  var state = 'idle';
  var mode = null;
  var playbackRate = 1;
  var triggerBtn = null;
  var playerEl = null;
  var playBtn = null;
  var progressBar = null;
  var progressWrap = null;
  var timeDisplay = null;
  var titleDisplay = null;

  // ═══ Mode A: <audio> ═══
  var audio = null;

  function audioPlay() { audio.play(); state = 'playing'; updateUI(); }
  function audioPause() { audio.pause(); state = 'paused'; updateUI(); }
  function audioStop() {
    audio.pause(); audio.currentTime = 0; state = 'idle'; updateUI();
    if (progressBar) progressBar.style.width = '0%';
    if (timeDisplay) timeDisplay.textContent = '';
  }
  function audioToggle() {
    if (state === 'idle' || state === 'paused') audioPlay();
    else audioPause();
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
      if (progressBar) progressBar.style.width = (audio.currentTime / audio.duration * 100) + '%';
      if (timeDisplay) timeDisplay.textContent = formatTime(audio.currentTime) + ' / ' + formatTime(audio.duration);
    });
    audio.addEventListener('ended', function () {
      state = 'idle'; updateUI();
      if (progressBar) progressBar.style.width = '100%';
    });
  }

  // ═══ Mode B: Web Speech API ═══
  var synth = window.speechSynthesis;
  var paragraphs = [], currentIdx = 0, currentHighlight = null;
  var zhVoice = null, enVoice = null;

  function pickVoices() {
    var v = synth.getVoices(); if (!v.length) return;
    var zh = v.filter(function(x){return /zh[-_]CN/i.test(x.lang)});
    zhVoice = zh.find(function(x){return /Tingting|Siri/i.test(x.name)}) || zh[0] || null;
    var en = v.filter(function(x){return /en[-_]US/i.test(x.lang)});
    enVoice = en.find(function(x){return /Samantha|Daniel|Siri/i.test(x.name)}) || en[0] || null;
  }
  function isCN(t) { return (t.match(/[\u4e00-\u9fff]/g)||[]).length / (t.replace(/\s/g,'').length||1) > 0.3; }

  function collectParagraphs() {
    var c = document.querySelector('.blog-post .content'); if (!c) return [];
    var r = []; c.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote').forEach(function(el){
      if (el.closest('pre')||el.closest('.mermaid')||el.closest('code')) return;
      var t = (el.innerText||el.textContent||'').trim(); if (t.length<2) return;
      r.push({el:el,text:t});
    }); return r;
  }
  function highlight(el) { clearHighlight(); if(!el)return; el.classList.add('tts-reading'); currentHighlight=el; el.scrollIntoView({behavior:'smooth',block:'center'}); }
  function clearHighlight() { if(currentHighlight){currentHighlight.classList.remove('tts-reading');currentHighlight=null;} }

  function speakParagraph(idx) {
    if (idx >= paragraphs.length) { speechStop(); return; }
    currentIdx = idx; var p = paragraphs[idx];
    var u = new SpeechSynthesisUtterance(p.text);
    if (isCN(p.text)) { if(zhVoice)u.voice=zhVoice; u.lang='zh-CN'; u.rate=1.1 * playbackRate; }
    else { if(enVoice)u.voice=enVoice; u.lang='en-US'; u.rate=1.0 * playbackRate; }
    highlight(p.el);
    if (progressBar&&paragraphs.length) progressBar.style.width = Math.round(((idx+1)/paragraphs.length)*100)+'%';
    u.onend = function(){if(state==='playing')speakParagraph(idx+1);};
    u.onerror = function(){if(state==='playing')speakParagraph(idx+1);};
    synth.speak(u);
  }

  var chromeTimer = null;
  function startChromeWA() { if(chromeTimer)return; if(!/Chrome/i.test(navigator.userAgent)||/Edg/i.test(navigator.userAgent))return; chromeTimer=setInterval(function(){if(synth.speaking&&!synth.paused){synth.pause();synth.resume();}},10000); }
  function stopChromeWA() { if(chromeTimer){clearInterval(chromeTimer);chromeTimer=null;} }

  function speechPlay() { paragraphs=collectParagraphs(); if(!paragraphs.length)return; synth.cancel(); state='playing'; updateUI(); startChromeWA(); speakParagraph(currentIdx); }
  function speechPause() { synth.pause(); state='paused'; updateUI(); stopChromeWA(); }
  function speechResume() { synth.resume(); state='playing'; updateUI(); startChromeWA(); }
  function speechStop() { synth.cancel(); state='idle'; currentIdx=0; clearHighlight(); updateUI(); stopChromeWA(); if(progressBar)progressBar.style.width='0%'; }
  function speechToggle() { if(state==='idle')speechPlay(); else if(state==='playing')speechPause(); else speechResume(); }
  function initSpeechMode() { mode='speech'; if(synth.onvoiceschanged!==undefined)synth.onvoiceschanged=pickVoices; pickVoices(); }

  // ═══ 统一接口 ═══
  function toggle() { if(mode==='audio')audioToggle(); else speechToggle(); }
  function stop() { if(mode==='audio')audioStop(); else speechStop(); }

  // ═══ UI 更新 ═══
  function updateUI() {
    if (triggerBtn) {
      triggerBtn.innerHTML = state === 'idle' ? '🔊 朗读' : '🔊 播放中…';
      triggerBtn.title = state === 'idle' ? '朗读全文' : '点击跳转播放器';
    }
    if (playBtn) {
      playBtn.textContent = state === 'playing' ? '⏸' : '▶';
    }
    if (playerEl) {
      if (state === 'idle') playerEl.classList.remove('tts-player-show');
      else playerEl.classList.add('tts-player-show');
    }
  }

  // ═══ 构建 UI ═══
  function buildUI() {
    var meta = document.querySelector('.post-meta');
    if (!meta) return false;

    // 触发按钮
    triggerBtn = document.createElement('button');
    triggerBtn.className = 'tts-trigger';
    triggerBtn.innerHTML = '🔊 朗读';
    triggerBtn.title = '朗读全文';
    triggerBtn.addEventListener('click', function () {
      if (state === 'idle') toggle();
      else if (playerEl) playerEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    meta.appendChild(triggerBtn);

    // 底部悬浮播放器
    playerEl = document.createElement('div');
    playerEl.className = 'tts-player';
    playerEl.innerHTML =
      '<div class="tts-player-inner">' +
        '<button class="tts-p-btn tts-play" title="播放/暂停">▶</button>' +
        '<div class="tts-p-progress">' +
          '<div class="tts-p-bar"></div>' +
        '</div>' +
        '<span class="tts-p-time"></span>' +
        '<button class="tts-p-btn tts-speed" title="播放速度">1×</button>' +
        '<button class="tts-p-btn tts-close" title="停止">✕</button>' +
      '</div>';
    document.body.appendChild(playerEl);

    playBtn = playerEl.querySelector('.tts-play');
    progressWrap = playerEl.querySelector('.tts-p-progress');
    progressBar = playerEl.querySelector('.tts-p-bar');
    timeDisplay = playerEl.querySelector('.tts-p-time');
    var closeBtn = playerEl.querySelector('.tts-close');

    var speedBtn = playerEl.querySelector('.tts-speed');
    var speeds = [1, 1.25, 1.5, 2];
    var speedIdx = 0;

    playBtn.addEventListener('click', toggle);
    closeBtn.addEventListener('click', stop);
    speedBtn.addEventListener('click', function () {
      speedIdx = (speedIdx + 1) % speeds.length;
      playbackRate = speeds[speedIdx];
      speedBtn.textContent = playbackRate + '×';
      if (mode === 'audio' && audio) audio.playbackRate = playbackRate;
    });
    progressWrap.addEventListener('click', function (e) {
      if (mode !== 'audio' || !audio || !audio.duration) return;
      var r = progressWrap.getBoundingClientRect();
      audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    });

    return true;
  }

  // ═══ 初始化 ═══
  function init() {
    if (!buildUI()) return;
    var slug = location.pathname.replace(/^\/|\/$/g, '');
    var audioUrl = 'https://audio.polly.wang/' + slug + '/audio.mp3';
    var probe = new Audio();
    probe.preload = 'metadata';
    var t = setTimeout(function () { fallbackToSpeech(); }, 5000);
    probe.addEventListener('loadedmetadata', function () { clearTimeout(t); initAudioMode(audioUrl); });
    probe.addEventListener('error', function () { clearTimeout(t); fallbackToSpeech(); });
    probe.src = audioUrl;
  }

  function fallbackToSpeech() {
    if (!('speechSynthesis' in window)) { if(triggerBtn)triggerBtn.style.display='none'; return; }
    initSpeechMode();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.addEventListener('beforeunload', function () {
    if (audio) audio.pause();
    if (synth) synth.cancel();
    stopChromeWA();
  });
})();
