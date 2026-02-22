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
        this.model = options.model || 'claude-sonnet-4';
        this.systemPrompt = '';
        this.messages = [];
        this.isStreaming = false;
        this.pendingImages = []; // 待发送的图片数组 [{base64, mediaType, dataUrl}]
        this.MAX_IMAGES = 4; // 单条消息最多 4 张图片
        
        // localStorage 配置
        this.STORAGE_KEY = 'polly_chat_history';
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
                // 恢复历史聊天记录
        this.restoreHistory();
                console.log('� PollyChat initialized');
    }
    
    async loadPrompt() {
        try {
            const res = await fetch('/polly-prompt.json');
            if (res.ok) {
                const data = await res.json();
                this.systemPrompt = data.system_prompt;
                console.log(`📝 Loaded prompt (${this.systemPrompt.length} chars)`);
            }
        } catch (e) {
            console.warn('Failed to load prompt, using default');
            this.systemPrompt = 'You are Polly\'s digital avatar, a friendly and professional AI assistant.';
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
                    alert(`最多支持 ${this.MAX_IMAGES} 张图片`);
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
            alert(`最多支持 ${this.MAX_IMAGES} 张图片`);
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
        
        // 保存用户消息到 localStorage
        this.saveHistory();
        
        // D1 持久化: 同步用户消息 (fire-and-forget)
        this.syncMessage('user', userMessage || `[${imageCount} image${imageCount > 1 ? 's' : ''}]`, imageCount);
        
        // 显示 New Chat 按钮
        this.showNewChatBtn();
        
        // 创建助手消息容器
        const assistantBubble = this.appendMessage('assistant', '');
        
        try {
            await this.streamResponse(assistantBubble);
        } catch (error) {
            console.error('Stream error:', error);
            assistantBubble.textContent = `Oops, something went wrong: ${error.message}`;
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
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const day = weekdays[now.getDay()];
        
        // 时段标签
        let period;
        if (hour >= 6 && hour < 12) period = '上午';
        else if (hour >= 12 && hour < 14) period = '中午';
        else if (hour >= 14 && hour < 18) period = '下午';
        else if (hour >= 18 && hour < 22) period = '傍晚';
        else period = '深夜';
        
        return `\n\n## 当前时间\n访客本地时间：${period} ${hour}:${min}，星期${day}。据此调整语气和话题。`;
    }
    
    async streamResponse(bubble) {
        const body = {
            model: this.model,
            system: this.systemPrompt + this.getTimeContext(),
            messages: this.messages,
            max_tokens: 2048,
            stream: true
        };
        
        const response = await fetch(`${this.apiUrl}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify(body)
        });
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error?.message || `HTTP ${response.status}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            // 解析 SSE 事件
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留不完整的行
            
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                
                const data = line.slice(6);
                if (data === '[DONE]') continue;
                
                try {
                    const event = JSON.parse(data);
                    
                    // Anthropic 格式
                    if (event.type === 'content_block_delta') {
                        const delta = event.delta?.text || '';
                        fullText += delta;
                        bubble.innerHTML = this.renderMarkdown(fullText);
                        this.scrollToBottom();
                    }
                    
                    // OpenAI 格式 (fallback)
                    if (event.choices?.[0]?.delta?.content) {
                        fullText += event.choices[0].delta.content;
                        bubble.innerHTML = this.renderMarkdown(fullText);
                        this.scrollToBottom();
                    }
                } catch (e) {
                    // 跳过无法解析的行
                }
            }
        }
        
        // 保存完整回复到历史
        this.messages.push({ role: 'assistant', content: fullText });
        
        // 持久化到 localStorage
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
        
        return bubble;
    }
    
    renderMarkdown(text) {
        // 简单的 Markdown 渲染
        if (typeof marked !== 'undefined') {
            return marked.parse(text);
        }
        
        // Fallback: 基础格式化
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }
    
    scrollToBottom() {
        this.chatBox.scrollTop = this.chatBox.scrollHeight;
    }
    
    // ========== 聊天记录持久化 ==========
    
    saveHistory() {
        try {
            // 只保存文本消息（跳过图片 base64 避免撑爆 localStorage）
            const toSave = this.messages.map(msg => {
                if (typeof msg.content === 'string') {
                    return { role: msg.role, content: msg.content };
                }
                // 多图消息：提取文本 + 标注图片数量
                const textBlock = msg.content.find(c => c.type === 'text');
                const imgCount = msg.content.filter(c => c.type === 'image').length;
                const imgLabel = imgCount > 0 ? `[${imgCount} image${imgCount > 1 ? 's' : ''}]` : '';
                const text = textBlock?.text || '';
                return { role: msg.role, content: text ? `${imgLabel} ${text}`.trim() : imgLabel || '[image]' };
            });
            // 上限控制
            while (toSave.length > this.MAX_MESSAGES) toSave.shift();
            const data = { messages: toSave, time: Date.now() };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.warn('保存聊天记录失败:', e);
        }
    }
    
    restoreHistory() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (!raw) return;
            
            const data = JSON.parse(raw);
            
            // 24小时过期自动清空
            if (data.time && Date.now() - data.time > this.EXPIRE_MS) {
                localStorage.removeItem(this.STORAGE_KEY);
                return;
            }
            
            if (!data.messages || data.messages.length === 0) return;
            
            // 恢复 messages 数组（用于上下文继续对话）
            this.messages = data.messages;
            
            // 展开聊天界面
            this.container.classList.add('expanded');
            this.chatBox.classList.add('expanded');
            
            // 渲染历史消息到页面
            data.messages.forEach(msg => {
                this.appendMessage(msg.role === 'user' ? 'user' : 'assistant', msg.content);
            });
            
            // 显示 New Chat 按钮
            this.showNewChatBtn();
            this.scrollToBottom();
            
            console.log(`💬 Restored ${data.messages.length} messages`);
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
        localStorage.removeItem(this.STORAGE_KEY);
        this.chatBox.innerHTML = '';
        
        // 新会话 ID
        this.conversationId = this.resetConversationId();
        
        // 隐藏按钮，收起界面
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
