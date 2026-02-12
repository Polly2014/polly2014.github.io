/**
 * Polly Chat - 轻量级聊天组件
 * 
 * 直连 CopilotX (api.polly.wang)，SSE 流式响应
 * 从 /polly-prompt.json 加载动态 system prompt
 */

class PollyChat {
    constructor(options = {}) {
        this.apiUrl = options.apiUrl || 'https://api.polly.wang';
        this.apiKey = options.apiKey || '';
        this.model = options.model || 'claude-sonnet-4';
        this.systemPrompt = '';
        this.messages = [];
        this.isStreaming = false;
        
        // DOM 元素
        this.container = null;
        this.chatBox = null;
        this.input = null;
        this.sendBtn = null;
        
        this.init();
    }
    
    async init() {
        // 加载 system prompt
        await this.loadPrompt();
        
        // 绑定 DOM
        this.bindDOM();
        
        // 绑定事件
        this.bindEvents();
        
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
    }
    
    async send() {
        const userMessage = this.input.value.trim();
        if (!userMessage || this.isStreaming) return;
        
        // 清空输入
        this.input.value = '';
        this.input.disabled = true;
        this.sendBtn.disabled = true;
        this.isStreaming = true;
        
        // 展开聊天界面
        this.container.classList.add('expanded');
        this.chatBox.classList.add('expanded');
        
        // 显示用户消息
        this.appendMessage('user', userMessage);
        
        // 添加到历史
        this.messages.push({ role: 'user', content: userMessage });
        
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
    
    async streamResponse(bubble) {
        const body = {
            model: this.model,
            system: this.systemPrompt,
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
        
        return fullText;
    }
    
    appendMessage(role, content) {
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
        bubble.innerHTML = content ? this.renderMarkdown(content) : '<span class="thinking">Thinking...</span>';
        
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
