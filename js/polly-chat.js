/**
 * Polly Chat - 轻量级聊天组件
 * 
 * 直连 CopilotX (api.polly.wang)，SSE 流式响应
 * 从 /polly-prompt.json 加载动态 system prompt
 * D1 持久化：每条消息 fire-and-forget 同步到 Cloudflare D1
 */

class PollyChat {
    constructor(options = {}) {
        this.apiUrl = options.apiUrl || 'https://api.polly.wang';
        this.apiKey = options.apiKey || '';
        this.model = options.model || 'claude-sonnet-4.6';
        this.systemPrompt = '';
        this.messages = [];
        this.isStreaming = false;
        this.pendingImages = []; // 待发送的图片数组 [{base64, mediaType, dataUrl}]
        this.MAX_IMAGES = 4; // 单条消息最多 4 张图片
        
        // 持久化配置 (IndexedDB)
        this.STORAGE_KEY = 'polly_chat_history'; // legacy localStorage key，迁移后清除
        this.DB_NAME = 'polly_chat';
        this.STORE_NAME = 'history';
        this.MAX_MESSAGES = 50;
        this.EXPIRE_MS = 24 * 60 * 60 * 1000; // 24小时过期
        
        // D1 持久化: 会话 ID
        this.conversationId = this.getOrCreateConversationId();
        
        // DOM 元素
        this.container = null;
        this.chatBox = null;
        this.input = null;
        this.sendBtn = null;
        this.imagePreview = null;
        this.newChatBtn = null;
        
        this.init();
    }
    
    async init() {
        // 加载 system prompt
        await this.loadPrompt();
        
        // 绑定 DOM
        this.bindDOM();
        
        // 绑定事件
        this.bindEvents();
        
        // 设置欢迎屏幕（时段副标题 + 动态 chips）
        this.setupWelcome();
        
        // 恢复历史聊天记录（IndexedDB 异步）
        await this.restoreHistory();
        console.log('🐾 PollyChat initialized');
    }
    
    async loadPrompt() {
        try {
            const res = await fetch('/polly-prompt.json');
            if (res.ok) {
                const data = await res.json();
                this.systemPrompt = data.system_prompt;
                this.promptMetadata = data.metadata || {};
                console.log(`📝 Loaded prompt (${this.systemPrompt.length} chars)`);
            }
        } catch (e) {
            console.warn('Failed to load prompt, using default');
            this.systemPrompt = 'You are Polly\'s digital avatar, a friendly and professional AI assistant.';
            this.promptMetadata = {};
        }
    }
    
    bindDOM() {
        this.container = document.querySelector('.polly-chat');
        this.chatBox = document.getElementById('chat-box');
        this.input = document.getElementById('user-input');
        this.sendBtn = document.getElementById('send-button');
        this.imagePreview = document.getElementById('image-preview-container');
        this.newChatBtn = document.getElementById('new-chat-btn');
        
        if (!this.container || !this.chatBox || !this.input) {
            console.error('PollyChat: Missing DOM elements');
            return;
        }
    }
    
    bindEvents() {
        this.sendBtn?.addEventListener('click', () => this.send());
        this.input?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.send();
            }
        });
        
        // 图片粘贴支持
        this.input?.addEventListener('paste', (e) => this.handlePaste(e));
        
        // New Chat 按钮
        this.newChatBtn?.addEventListener('click', () => this.newChat());
        
        // 快捷 chip 点击（3 种类型）
        document.querySelectorAll('.welcome-chips .chip').forEach(chip => {
            chip.addEventListener('click', () => {
                // GA4: 追踪 chip 点击
                if (typeof gtag === 'function') {
                    gtag('event', 'chat_chip_click', {
                        chip_label: chip.textContent.trim(),
                        chip_action: chip.dataset.action || 'send_message'
                    });
                }

                // 功能型：发张图试试 → 弹文件选择器
                if (chip.dataset.action === 'upload-image') {
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = 'image/*';
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            this.processImage(file);
                            this.input.focus();
                        }
                    };
                    fileInput.click();
                    return;
                }
                // 普通/动态型：发送 data-msg
                const msg = chip.dataset.msg;
                if (msg) {
                    this.input.value = msg;
                    this.send();
                }
            });
        });
    }
    
    // ========== 欢迎屏幕 ==========
    
    setupWelcome() {
        // Time-based subtitle
        const subtitle = document.getElementById('welcome-subtitle');
        if (subtitle) {
            const hour = new Date().getHours();
            if (hour >= 5 && hour < 9) {
                subtitle.textContent = 'An early bird coder, rare sight ☀️';
            } else if (hour >= 9 && hour < 12) {
                subtitle.textContent = 'Polly\'s digital twin, good morning ☕';
            } else if (hour >= 12 && hour < 14) {
                subtitle.textContent = 'Lunch break, let\'s chat 🍜';
            } else if (hour >= 14 && hour < 18) {
                subtitle.textContent = 'Polly\'s digital twin, always online ☕';
            } else if (hour >= 18 && hour < 22) {
                subtitle.textContent = 'After hours, time to unwind 🌆';
            } else {
                subtitle.textContent = 'Night owl mode, online 🌙';
            }
        }
        
        // Dynamic chips: extract current project from prompt
        this.updateDynamicChips();

        // Fade in subtitle & chips (avoid flash of default text)
        subtitle?.classList.add('ready');
        document.getElementById('welcome-chips')?.classList.add('ready');
    }
    
    updateDynamicChips() {
        const dynamicChip = document.querySelector('.welcome-chips .chip-dynamic');
        if (!dynamicChip) return;
        
        // 用轻量 latest-post.json (~120B) 而非 blog-index.json (816KB)，避免阻塞 LCP
        // 完整索引由 worker.js 在收到聊天消息时拉取（带三级缓存），前端不参与
        fetch('/latest-post.json')
            .then(r => r.ok ? r.json() : null)
            .then(latest => {
                if (!latest || !latest.title) return;
                const shortTitle = latest.title.length > 12 ? latest.title.slice(0, 12) + '…' : latest.title;
                dynamicChip.textContent = `🔬 ${shortTitle}`;
                // 用书名号+"你最新的博文"消除第一人称标题带来的角色歧义
                // （例如标题「我的小破站，被六家 AI 公司围观了」里的"我"指 Polly，不是访客）
                dynamicChip.dataset.msg = `聊聊你最新的博文《${latest.title}》`;
            })
            .catch(() => {});
    }
    
    handlePaste(e) {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        let hasImage = false;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                if (!hasImage) {
                    e.preventDefault();
                    hasImage = true;
                }
                if (this.pendingImages.length >= this.MAX_IMAGES) {
                    alert(`Up to ${this.MAX_IMAGES} images allowed`);
                    break;
                }
                const file = item.getAsFile();
                if (file) this.processImage(file);
            }
        }
    }
    
    processImage(file) {
        // 限制原始文件 10MB
        if (file.size > 10 * 1024 * 1024) {
            alert('Image too large (max 10MB)');
            return;
        }
        
        // 检查数量上限
        if (this.pendingImages.length >= this.MAX_IMAGES) {
            alert(`Up to ${this.MAX_IMAGES} images allowed`);
            return;
        }
        
        // 使用 Canvas 压缩图片
        this.compressImage(file).then(({ base64, mediaType, dataUrl }) => {
            this.pendingImages.push({ base64, mediaType, dataUrl });
            this.showImagePreview();
            console.log(`📷 Image ${this.pendingImages.length}/${this.MAX_IMAGES} ready: ${Math.round(base64.length / 1024)}KB`);
        }).catch(err => {
            console.error('Image processing failed:', err);
            alert('Failed to process image');
        });
    }
    
    compressImage(file, maxSize = 800, quality = 0.7, maxBytes = 60000) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            img.onload = () => {
                URL.revokeObjectURL(img.src); // 释放 Blob URL
                // 计算缩放尺寸
                let { width, height } = img;
                if (width > maxSize || height > maxSize) {
                    if (width > height) {
                        height = Math.round(height * maxSize / width);
                        width = maxSize;
                    } else {
                        width = Math.round(width * maxSize / height);
                        height = maxSize;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                
                // 尝试压缩到目标大小
                let currentQuality = quality;
                let dataUrl;
                let attempts = 0;
                
                do {
                    dataUrl = canvas.toDataURL('image/jpeg', currentQuality);
                    const base64Length = dataUrl.split(',')[1].length;
                    
                    if (base64Length <= maxBytes || currentQuality <= 0.3 || attempts >= 5) {
                        break;
                    }
                    
                    currentQuality -= 0.1;
                    attempts++;
                } while (true);
                
                const base64 = dataUrl.split(',')[1];
                console.log(`📷 Compressed: ${img.width}x${img.height} → ${width}x${height}, quality=${currentQuality.toFixed(1)}, size=${Math.round(base64.length/1024)}KB`);
                
                resolve({
                    base64,
                    mediaType: 'image/jpeg',
                    dataUrl
                });
            };
            
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = URL.createObjectURL(file);
        });
    }
    
    showImagePreview() {
        if (!this.imagePreview) return;
        
        if (this.pendingImages.length === 0) {
            this.clearImagePreview();
            return;
        }
        
        // 横向 flex 布局，每张缩略图独立 ❌
        const thumbnails = this.pendingImages.map((img, idx) => `
            <div class="preview-wrapper" data-idx="${idx}">
                <img src="${img.dataUrl}" alt="Preview ${idx + 1}" class="preview-image" />
                <button class="preview-remove" title="Remove image" data-idx="${idx}">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `).join('');
        
        const countHint = this.pendingImages.length >= this.MAX_IMAGES 
            ? `<span class="preview-count">${this.pendingImages.length}/${this.MAX_IMAGES} (max)</span>` 
            : `<span class="preview-count">${this.pendingImages.length}/${this.MAX_IMAGES}</span>`;
        
        this.imagePreview.innerHTML = `<div class="preview-list">${thumbnails}</div>${countHint}`;
        this.imagePreview.classList.add('visible');
        
        // 为每个 ❌ 绑定独立删除
        this.imagePreview.querySelectorAll('.preview-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.idx);
                this.pendingImages.splice(idx, 1);
                this.showImagePreview(); // 重新渲染
            });
        });
        
        // 聚焦输入框
        this.input?.focus();
    }
    
    clearImagePreview() {
        this.pendingImages = [];
        if (this.imagePreview) {
            this.imagePreview.innerHTML = '';
            this.imagePreview.classList.remove('visible');
        }
    }
    
    async send() {
        const userMessage = this.input.value.trim();
        const imageCount = this.pendingImages.length;
        
        // 必须有文字或图片
        if (!userMessage && imageCount === 0) return;
        if (this.isStreaming) return;
        
        // 保存图片数据（清空前）
        const images = [...this.pendingImages];
        
        // 清空输入
        this.input.value = '';
        this.clearImagePreview();
        this.input.disabled = true;
        this.sendBtn.disabled = true;
        this.isStreaming = true;
        
        // 展开聊天界面
        this.container.classList.add('expanded');
        this.chatBox.classList.add('expanded');
        
        // 显示用户消息（带图片预览）
        this.appendMessage('user', userMessage, images);
        
        // 构建消息内容（Anthropic 格式）
        let messageContent;
        if (images.length > 0) {
            messageContent = [];
            // 多张图片依次加入 content 数组
            for (const img of images) {
                messageContent.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: img.mediaType,
                        data: img.base64
                    }
                });
            }
            if (userMessage) {
                messageContent.push({ type: 'text', text: userMessage });
            }
        } else {
            messageContent = userMessage;
        }
        
        // 添加到历史
        this.messages.push({ role: 'user', content: messageContent });
        
        // 保存用户消息到 IndexedDB
        this.saveHistory();
        
        // D1 持久化: 同步用户消息 (fire-and-forget)
        this.syncMessage('user', userMessage || `[${imageCount} image${imageCount > 1 ? 's' : ''}]`, imageCount);
        
        // GA4: 追踪聊天事件
        if (typeof gtag === 'function') {
            const messageIndex = this.messages.length;
            // 首条消息 = chat_start
            if (messageIndex === 1) {
                gtag('event', 'chat_start', {
                    message_type: imageCount > 0 ? 'image' : 'text',
                    first_message: userMessage?.slice(0, 100) || '[image]'
                });
            }
            // 每条消息都追踪
            gtag('event', 'chat_message', {
                message_index: messageIndex,
                message_type: imageCount > 0 ? 'image' : 'text',
                has_images: imageCount > 0,
                image_count: imageCount
            });
        }
        
        // 显示 New Chat 按钮
        this.showNewChatBtn();
        
        // 创建助手消息容器
        const assistantBubble = this.appendMessage('assistant', '');
        
        try {
            await this.streamResponseWithRetry(assistantBubble);
        } catch (error) {
            console.error('Stream error:', error);
            this.showFriendlyError(assistantBubble, error);
        } finally {
            this.input.disabled = false;
            this.sendBtn.disabled = false;
            this.isStreaming = false;
            this.input.focus();
        }
    }
    
    getTimeContext() {
        const now = new Date();
        const hour = now.getHours();
        const min = String(now.getMinutes()).padStart(2, '0');
        const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const day = weekdays[now.getDay()];
        const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        
        // Time period label
        let period;
        if (hour >= 6 && hour < 12) period = 'morning';
        else if (hour >= 12 && hour < 14) period = 'noon';
        else if (hour >= 14 && hour < 18) period = 'afternoon';
        else if (hour >= 18 && hour < 22) period = 'evening';
        else period = 'late night';
        
        return `\n\n## Current Time\nVisitor's local time: ${dateStr}, ${period}, ${hour}:${min}, ${day}. Adjust greeting and tone accordingly.`;
    }
    
    // ========== 重试 & 错误处理 ==========

    /**
     * 判断 HTTP 状态码是否可重试（仅临时性故障）
     */
    isRetryableStatus(status) {
        // 502/503/504 = upstream 临时故障，值得重试
        // 429 = rate limit, 稍等即可
        // 522/524 = 服务器完全不可达（如 Azure VM 停机），不重试
        return [429, 502, 503, 504].includes(status);
    }

    /**
     * 带自动重试的流式响应
     * 仅对临时性错误 (502/503/504/429) 重试 1 次
     * 522/524 等服务器停机直接报错，不浪费用户等待时间
     */
    async streamResponseWithRetry(bubble, maxRetries = 1) {
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`🔄 Retry attempt ${attempt}/${maxRetries}...`);
                    bubble.innerHTML = `<span class="chat-retry-hint">⏳ Retrying...</span>`;
                    await new Promise(r => setTimeout(r, 2000));
                }
                return await this.streamResponse(bubble);
            } catch (error) {
                lastError = error;
                const status = error._httpStatus || 0;
                if (!this.isRetryableStatus(status) || attempt === maxRetries) {
                    throw error;
                }
            }
        }
        throw lastError;
    }

    /**
     * 显示友好的错误消息（非原始 HTTP 状态码）
     */
    showFriendlyError(bubble, error) {
        const status = error._httpStatus || 0;
        let icon, title, detail, showRetry = true;

        if (status === 522 || status === 524) {
            // 连接超时或服务器不可达
            icon = '🤔';
            title = 'Hmm, thinking too hard...';
            detail = 'Polly got lost in thought and took too long to respond. Give it another shot — it usually works on the second try!';
        } else if (status === 502 || status === 503 || status === 504) {
            icon = '🔧';
            title = 'Server is temporarily unavailable';
            detail = 'The backend service is restarting or under maintenance. Please try again in a moment.';
        } else if (status === 429) {
            icon = '⏳';
            title = 'Too many requests';
            detail = 'Rate limit reached. Please wait a few seconds and try again.';
        } else if (status === 401 || status === 403) {
            icon = '🔒';
            title = 'Authentication error';
            detail = 'API key issue. This is a bug — Polly will fix it soon!';
            showRetry = false;
        } else if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
            icon = '📡';
            title = 'Network error';
            detail = 'Please check your internet connection and try again.';
        } else {
            icon = '😅';
            title = 'Something went wrong';
            detail = error.message || 'Unknown error';
        }

        bubble.innerHTML = `
            <div class="chat-error">
                <div class="chat-error-icon">${icon}</div>
                <div class="chat-error-title">${title}</div>
                <div class="chat-error-detail">${detail}</div>
                ${showRetry ? '<button class="chat-error-retry" onclick="window.pollyChat.retryLast()"><i class="fas fa-redo-alt"></i> Retry</button>' : ''}
            </div>
        `;
        this.scrollToBottom();
    }

    /**
     * 重试最后一条消息（点击 Retry 按钮触发）
     */
    async retryLast() {
        if (this.isStreaming) return;
        // 移除最后一条 assistant 消息（错误消息）
        const lastBubble = this.chatBox.querySelector('.message-container:last-child .polly-message');
        if (!lastBubble) return;

        // 移除消息历史中最后一条 assistant（如果有的话）
        if (this.messages.length && this.messages[this.messages.length - 1].role === 'assistant') {
            this.messages.pop();
        }

        this.isStreaming = true;
        this.input.disabled = true;
        this.sendBtn.disabled = true;
        lastBubble.innerHTML = '';

        try {
            await this.streamResponseWithRetry(lastBubble);
        } catch (error) {
            console.error('Retry failed:', error);
            this.showFriendlyError(lastBubble, error);
        } finally {
            this.input.disabled = false;
            this.sendBtn.disabled = false;
            this.isStreaming = false;
            this.input.focus();
        }
    }

    async streamResponse(bubble) {
        const body = {
            model: this.model,
            system: this.systemPrompt + this.getTimeContext(),
            messages: this.messages,
            max_tokens: 2048,
            stream: true
        };
        
        // 首字节超时：worker 在 Phase 4 改造后会立即返回 headers + 推 thinking trace，
        // TTFB < 1s。给 15s 已极宽松；超过仍不到响应说明真挂了。
        const controller = new AbortController();
        const connectTimeout = setTimeout(() => controller.abort(), 15000);
        
        let response;
        try {
            response = await fetch(`${this.apiUrl}/v1/messages`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream',
                    'X-Conversation-Id': this.conversationId  // Phase 2: 访客记忆
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });
        } catch (e) {
            clearTimeout(connectTimeout);
            if (e.name === 'AbortError') {
                const err = new Error('Server unreachable (connection timeout)');
                err._httpStatus = 522; // 视为 522
                throw err;
            }
            throw e;
        }
        clearTimeout(connectTimeout);
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            const err = new Error(error.error?.message || `HTTP ${response.status}`);
            err._httpStatus = response.status;
            throw err;
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';
        let currentEvent = 'message';  // 当前 SSE event 类型（默认 message）
        
        // Phase 4: thinking trace 卡片栈（每个 tool 调用 = 一张独立卡片）
        // 结构：[trace-stack(动态卡片们)] [chat-answer(最终答案)]
        const traceStartTs = Date.now();
        let traceCardCount = 0;
        let pendingThinkingCard = null;  // 当前尚未匹配 tool_call 的 thinking 卡片
        let lastToolCard = null;          // 最近一张 tool_call 卡片，用于合并 tool_result
        
        const ensureStack = () => {
            if (bubble._traceStack) return bubble._traceStack;
            const el = document.createElement('div');
            el.className = 'trace-stack';
            bubble.insertBefore(el, bubble.firstChild);
            bubble._traceStack = el;
            return el;
        };
        const ensureAnswerEl = () => {
            if (bubble._answerEl) return bubble._answerEl;
            const el = document.createElement('div');
            el.className = 'chat-answer';
            bubble.appendChild(el);
            bubble._answerEl = el;
            return el;
        };
        const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => 
            ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        
        // 添加一张 thinking 卡片（pending 状态：转圈圈）
        const addThinkingCard = (label) => {
            const stack = ensureStack();
            const card = document.createElement('div');
            card.className = 'trace-card thinking';
            card.innerHTML = `
                <span class="trace-card-spinner"></span>
                <span class="trace-card-label">${escapeHtml(label)}</span>
            `;
            stack.appendChild(card);
            traceCardCount++;
            this.scrollToBottom();
            return card;
        };
        
        // tool_call: 把当前 thinking 卡片升级为 tool 卡片（或新建一张）
        const startToolCard = (label) => {
            let card;
            if (pendingThinkingCard) {
                card = pendingThinkingCard;
                card.className = 'trace-card running';
                card.innerHTML = `
                    <span class="trace-card-spinner"></span>
                    <span class="trace-card-label">${escapeHtml(label)}</span>
                `;
                pendingThinkingCard = null;
            } else {
                const stack = ensureStack();
                card = document.createElement('div');
                card.className = 'trace-card running';
                card.innerHTML = `
                    <span class="trace-card-spinner"></span>
                    <span class="trace-card-label">${escapeHtml(label)}</span>
                `;
                stack.appendChild(card);
                traceCardCount++;
            }
            this.scrollToBottom();
            return card;
        };
        
        // tool_result: 把对应 tool 卡片标记完成 + 追加结果摘要
        const completeToolCard = (resultText, ok) => {
            if (!lastToolCard) return;
            lastToolCard.className = 'trace-card ' + (ok ? 'done' : 'failed');
            const labelEl = lastToolCard.querySelector('.trace-card-label');
            const labelText = labelEl ? labelEl.textContent : '';
            lastToolCard.innerHTML = `
                <span class="trace-card-icon">${ok ? '✓' : '✗'}</span>
                <span class="trace-card-label">${escapeHtml(labelText)}</span>
                <span class="trace-card-result">${escapeHtml(resultText)}</span>
            `;
            this.scrollToBottom();
        };
        
        // 流结束后：把所有卡片折叠成顶部一行小灰条
        const finalizeTrace = () => {
            const stack = bubble._traceStack;
            if (!stack || stack.classList.contains('finalized')) return;
            // 把所有 pending 卡片标完成
            for (const c of stack.querySelectorAll('.trace-card.thinking, .trace-card.running')) {
                c.classList.remove('thinking', 'running');
                c.classList.add('done');
            }
            const elapsed = Math.round((Date.now() - traceStartTs) / 1000);
            const summary = document.createElement('div');
            summary.className = 'trace-summary';
            summary.innerHTML = `
                <span class="trace-summary-icon">✓</span>
                <span class="trace-summary-text">思考了 ${elapsed} 秒 · ${traceCardCount} 步</span>
                <span class="trace-summary-toggle">展开</span>
            `;
            stack.classList.add('finalized', 'collapsed');
            stack.insertBefore(summary, stack.firstChild);
            summary.onclick = () => {
                stack.classList.toggle('collapsed');
                summary.querySelector('.trace-summary-toggle').textContent =
                    stack.classList.contains('collapsed') ? '展开' : '收起';
            };
        };
        bubble._finalizeTrace = finalizeTrace;
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            // 解析 SSE 事件
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留不完整的行
            
            for (const line of lines) {
                // SSE 注释（heartbeat）
                if (line.startsWith(':')) continue;
                
                // 空行 = 一个事件结束 → 重置 event 类型
                if (line === '') { currentEvent = 'message'; continue; }
                
                // event: xxx 标记当前事件类型
                if (line.startsWith('event: ')) {
                    currentEvent = line.slice(7).trim();
                    continue;
                }
                
                if (!line.startsWith('data: ')) continue;
                
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                
                try {
                    const event = JSON.parse(data);
                    
                    // Phase 4: worker 推送的自定义事件
                    if (currentEvent === 'status') {
                        if (event.phase === 'thinking') {
                            // thinking 不立即建卡片：先 pending，等下个 tool_call 升级
                            // 如果已经有 pending 就不重复建（连续 thinking 合并）
                            if (!pendingThinkingCard && !lastToolCard) {
                                pendingThinkingCard = addThinkingCard(event.detail || '正在思考...');
                            } else if (lastToolCard && !pendingThinkingCard) {
                                // 已有 tool 卡片完成，新一轮 thinking 启动 → 建新 pending 卡片
                                pendingThinkingCard = addThinkingCard(event.detail || '正在整理...');
                                lastToolCard = null;
                            }
                        } else if (event.phase === 'tool_call') {
                            lastToolCard = startToolCard(event.label || `调用 ${event.tool}`);
                        } else if (event.phase === 'tool_result') {
                            const cnt = event.count;
                            const summary = event.ok
                                ? (cnt >= 1 ? `${cnt} 条结果` : '完成')
                                : '未找到';
                            completeToolCard(summary, event.ok);
                        }
                        continue;
                    }
                    if (currentEvent === 'error') {
                        const err = new Error(event.message || 'Stream error');
                        err._httpStatus = 502;
                        throw err;
                    }
                    
                    // Anthropic 格式
                    if (event.type === 'content_block_delta') {
                        const delta = event.delta?.text || '';
                        fullText += delta;
                        // 首次收到文字时，淡出 thinking dots，但保留 trace 完整可见
                        if (bubble._thinkingEl) {
                            bubble._thinkingEl.classList.add('fade-out');
                            const el = bubble._thinkingEl;
                            bubble._thinkingEl = null;
                            setTimeout(() => el.remove(), 300);
                        }
                        // 把还在转的 pending thinking 卡片标完成
                        if (pendingThinkingCard) {
                            pendingThinkingCard.classList.remove('thinking');
                            pendingThinkingCard.classList.add('done');
                            const labelEl = pendingThinkingCard.querySelector('.trace-card-label');
                            const labelText = labelEl ? labelEl.textContent : '正在整理...';
                            pendingThinkingCard.innerHTML = `
                                <span class="trace-card-icon">✓</span>
                                <span class="trace-card-label">${escapeHtml(labelText)}</span>
                            `;
                            pendingThinkingCard = null;
                        }
                        const ansEl = ensureAnswerEl();
                        ansEl.innerHTML = this.renderMarkdown(fullText);
                        this.scrollToBottom();
                    }
                    
                    // OpenAI 格式 (fallback)
                    if (event.choices?.[0]?.delta?.content) {
                        fullText += event.choices[0].delta.content;
                        const ansEl = ensureAnswerEl();
                        ansEl.innerHTML = this.renderMarkdown(fullText);
                        this.scrollToBottom();
                    }
                } catch (e) {
                    // 重新抛出 status=error 的真实错误，避免被吞
                    if (e._httpStatus) throw e;
                    // 其他 JSON parse 失败：跳过
                }
            }
        }
        
        // 流结束：把 thinking trace 折叠为 "Thought for Xs · N steps" 摘要
        if (typeof bubble._finalizeTrace === 'function') bubble._finalizeTrace();
        
        // 保存完整回复到历史
        this.messages.push({ role: 'assistant', content: fullText });
        
        // 持久化到 IndexedDB
        this.saveHistory();
        
        // D1 持久化: 同步助手回复 (fire-and-forget)
        this.syncMessage('assistant', fullText);
        
        return fullText;
    }
    
    appendMessage(role, content, images = []) {
        const wrapper = document.createElement('div');
        // 使用原有 CSS 类名：message-container + user-message/polly-message
        const roleClass = role === 'user' ? 'user-message' : 'polly-message';
        wrapper.className = `message-container ${roleClass}`;
        
        const avatar = document.createElement('div');
        avatar.className = 'chat-avatar';
        // 使用图标而非 emoji
        avatar.innerHTML = role === 'user' 
            ? '<i class="fas fa-user"></i>' 
            : '<img src="/images/polly.png" alt="Polly">';
        
        const bubble = document.createElement('div');
        // 使用原有 CSS 类名：chat-bubble + user/polly
        const bubbleClass = role === 'user' ? 'user' : 'polly';
        bubble.className = `chat-bubble ${bubbleClass}`;
        
        // 构建气泡内容：多图循环渲染
        let bubbleContent = '';
        if (images && images.length > 0) {
            bubbleContent += '<div class="chat-images">';
            for (const img of images) {
                bubbleContent += `<img src="data:${img.mediaType};base64,${img.base64}" class="chat-image" alt="Uploaded" />`;
            }
            bubbleContent += '</div>';
        }
        if (content) {
            bubbleContent += this.renderMarkdown(content);
        }
        bubble.innerHTML = bubbleContent || '<div class="thinking"><span></span><span></span><span></span></div>';
        
        wrapper.appendChild(avatar);
        wrapper.appendChild(bubble);
        this.chatBox.appendChild(wrapper);
        
        this.scrollToBottom();
        
        // 记录 thinking 元素，用于过渡动画
        if (!bubbleContent) {
            bubble._thinkingEl = bubble.querySelector('.thinking');
        }
        
        return bubble;
    }
    
    renderMarkdown(text) {
        let html;
        if (typeof marked !== 'undefined') {
            // 转义反引号外的裸 HTML 标签，防止标题里的 <div> 等被当真实标签解析
            const escaped = text.replace(/(`[^`]*`)|(<\/?[a-zA-Z][^>]*>)/g,
                (m, code) => code ? code : m.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
            html = marked.parse(escaped);
        } else {
            // Fallback: 基础格式化
            html = text
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.+?)\*/g, '<em>$1</em>')
                .replace(/`(.+?)`/g, '<code>$1</code>')
                .replace(/\n/g, '<br>');
        }
        // XSS 防护：DOMPurify 清洗
        if (typeof DOMPurify !== 'undefined') {
            return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
        }
        return html;
    }
    
    scrollToBottom() {
        this.chatBox.scrollTop = this.chatBox.scrollHeight;
    }
    
    // ========== IndexedDB 持久化 ==========
    
    _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.DB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(this.STORE_NAME);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    
    async _idbGet(key) {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const req = tx.objectStore(this.STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => db.close();
        });
    }
    
    async _idbPut(key, value) {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            tx.objectStore(this.STORE_NAME).put(value, key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        });
    }
    
    async _idbDelete(key) {
        const db = await this._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            tx.objectStore(this.STORE_NAME).delete(key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => reject(tx.error);
        });
    }
    
    // ========== 聊天记录持久化 ==========
    
    async saveHistory() {
        try {
            // 完整保存消息（含图片 base64），IndexedDB 容量充裕
            const toSave = this.messages.slice(-this.MAX_MESSAGES);
            await this._idbPut('current', { messages: toSave, time: Date.now() });
        } catch (e) {
            console.warn('保存聊天记录失败:', e);
        }
    }
    
    async restoreHistory() {
        try {
            // 自动迁移旧 localStorage 数据
            const legacy = localStorage.getItem(this.STORAGE_KEY);
            if (legacy) {
                const legacyData = JSON.parse(legacy);
                // 迁移到 IndexedDB（旧数据无图片，直接搬）
                if (legacyData.messages?.length > 0) {
                    await this._idbPut('current', legacyData);
                }
                localStorage.removeItem(this.STORAGE_KEY);
                console.log('📦 Migrated localStorage → IndexedDB');
            }
            
            const data = await this._idbGet('current');
            if (!data || !data.messages?.length) return;
            
            // 24小时过期自动清空
            if (data.time && Date.now() - data.time > this.EXPIRE_MS) {
                await this._idbDelete('current');
                return;
            }
            
            // 恢复 messages 数组（含完整图片，可继续对话）
            this.messages = data.messages;
            
            // 展开聊天界面
            this.container.classList.add('expanded');
            this.chatBox.classList.add('expanded');
            
            // 渲染历史消息到页面（区分纯文本 vs 含图消息）
            data.messages.forEach(msg => {
                const role = msg.role === 'user' ? 'user' : 'assistant';
                if (typeof msg.content === 'string') {
                    this.appendMessage(role, msg.content);
                } else {
                    // 从 Anthropic content 数组提取图片 + 文本
                    const images = msg.content
                        .filter(c => c.type === 'image')
                        .map(c => ({ base64: c.source.data, mediaType: c.source.media_type }));
                    const text = msg.content.find(c => c.type === 'text')?.text || '';
                    this.appendMessage(role, text, images);
                }
            });
            
            // 显示 New Chat 按钮
            this.showNewChatBtn();
            this.scrollToBottom();
            
            console.log(`💬 Restored ${data.messages.length} messages (IndexedDB)`);
        } catch (e) {
            console.warn('恢复聊天记录失败:', e);
        }
    }
    
    showNewChatBtn() {
        if (this.newChatBtn) this.newChatBtn.style.display = 'inline-flex';
    }
    
    newChat() {
        // 清空一切
        this.messages = [];
        this._idbDelete('current').catch(() => {});
        localStorage.removeItem(this.STORAGE_KEY); // 清理 legacy
        this.chatBox.innerHTML = '';
        
        // 新会话 ID
        this.conversationId = this.resetConversationId();
        
        // 隐藏按钮，收起界面（CSS .expanded 控制 welcome-screen 显隐）
        if (this.newChatBtn) this.newChatBtn.style.display = 'none';
        this.container.classList.remove('expanded');
        this.chatBox.classList.remove('expanded');
        
        this.input?.focus();
    }
    
    // ========== D1 持久化 ==========
    
    getOrCreateConversationId() {
        const stored = localStorage.getItem('polly_conv_id');
        if (stored) return stored;
        return this.resetConversationId();
    }
    
    resetConversationId() {
        const id = crypto.randomUUID();
        localStorage.setItem('polly_conv_id', id);
        return id;
    }
    
    syncMessage(role, content, imageCount = 0) {
        // Fire-and-forget: 绝不阻塞聊天体验
        try {
            const metadata = this.messages.length <= 1 ? {
                ua: navigator.userAgent.slice(0, 200),
                lang: navigator.language,
                ref: document.referrer.slice(0, 200),
                page: location.pathname,
                screen: screen.width + 'x' + screen.height,
            } : undefined;
            
            fetch(`${this.apiUrl}/v1/conversations/log`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    conversation_id: this.conversationId,
                    role,
                    content,
                    image_count: imageCount,
                    metadata,
                }),
            }).catch(() => {}); // 静默失败
        } catch (e) {
            // 静默
        }
    }
}

// 自动初始化
document.addEventListener('DOMContentLoaded', () => {
    // 从 script 标签或全局配置获取 API key
    const config = window.POLLY_CHAT_CONFIG || {};
    
    // 查找 script 标签上的配置
    const scriptTag = document.querySelector('script[data-api-key]');
    if (scriptTag) {
        config.apiKey = scriptTag.dataset.apiKey;
    }
    
    window.pollyChat = new PollyChat(config);
});
