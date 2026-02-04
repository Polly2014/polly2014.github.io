/**
 * CFP (Call for Papers) - AI Conference Deadlines Tracker
 * 
 * 数据源：ccfddl/ccf-deadlines (GitHub)
 * 功能：
 * 1. 从 GitHub 实时拉取 ccfddl 的会议数据
 * 2. 解析 YAML 并渲染卡片
 * 3. 筛选（领域、时间）和搜索功能
 * 4. 实时倒计时
 * 5. localStorage 缓存兜底
 */

(function() {
    'use strict';

    // 配置
    const CONFIG = {
        // ccfddl GitHub API 基础 URL
        baseUrl: 'https://raw.githubusercontent.com/ccfddl/ccf-deadlines/main/conference',
        // GitHub API 用于获取文件列表
        apiBaseUrl: 'https://api.github.com/repos/ccfddl/ccf-deadlines/contents/conference',
        cacheKey: 'cfp_ccfddl_cache_v2',
        cacheDuration: 6 * 60 * 60 * 1000, // 6小时缓存
        updateInterval: 1000, // 倒计时更新间隔（毫秒）
    };

    // ccfddl 的领域分类
    const CATEGORIES = ['AI', 'DB', 'NW', 'SC', 'SE', 'DS', 'CT', 'CG', 'HI', 'MX'];
    
    // 领域映射（ccfddl 分类 -> 显示名称）
    const SUB_NAMES = {
        'AI': 'Artificial Intelligence',
        'DB': 'Database / Data Mining',
        'NW': 'Computer Networks',
        'SC': 'Security',
        'SE': 'Software Engineering',
        'DS': 'Distributed Systems',
        'CT': 'Computing Theory',
        'CG': 'Computer Graphics',
        'HI': 'Human-Computer Interaction',
        'MX': 'Interdisciplinary'
    };

    // 领域颜色
    const SUB_COLORS = {
        'AI': '#e74c3c',
        'DB': '#f39c12',
        'NW': '#3498db',
        'SC': '#9b59b6',
        'SE': '#2ecc71',
        'DS': '#1abc9c',
        'CT': '#34495e',
        'CG': '#e67e22',
        'HI': '#95a5a6',
        'MX': '#7f8c8d'
    };

    // CCF 等级颜色
    const RANK_COLORS = {
        'A': '#e74c3c',
        'B': '#f39c12',
        'C': '#3498db',
        'N': '#95a5a6'
    };

    // 状态
    let allConferences = [];
    let filteredConferences = [];
    let currentSubFilter = 'all';
    let currentTimeFilter = 'all';
    let currentSearchQuery = '';
    let countdownTimer = null;

    // DOM 元素
    let elements = {};

    /**
     * 初始化
     */
    async function init() {
        elements = {
            grid: document.getElementById('cfp-grid'),
            loading: document.getElementById('cfp-loading'),
            noResults: document.getElementById('cfp-no-results'),
            searchInput: document.getElementById('cfp-search-input'),
            subjectFilters: document.getElementById('subject-filters'),
            timeFilters: document.getElementById('time-filters'),
            lastUpdated: document.getElementById('last-updated')
        };
        
        bindEvents();
        await loadConferences();
        startCountdown();
    }

    /**
     * 绑定事件
     */
    function bindEvents() {
        // 搜索框
        if (elements.searchInput) {
            elements.searchInput.addEventListener('input', debounce(handleSearch, 300));
        }

        // 领域筛选
        if (elements.subjectFilters) {
            elements.subjectFilters.addEventListener('click', (e) => {
                if (e.target.classList.contains('filter-btn')) {
                    setActiveFilter(elements.subjectFilters, e.target);
                    currentSubFilter = e.target.dataset.sub;
                    applyFilters();
                }
            });
        }

        // 时间筛选
        if (elements.timeFilters) {
            elements.timeFilters.addEventListener('click', (e) => {
                if (e.target.classList.contains('filter-btn')) {
                    setActiveFilter(elements.timeFilters, e.target);
                    currentTimeFilter = e.target.dataset.days;
                    applyFilters();
                }
            });
        }
    }

    /**
     * 加载会议数据
     */
    async function loadConferences() {
        showLoading(true);
        updateStatus('Loading conference data...');

        // 先尝试从缓存加载
        const cached = loadFromCache();
        if (cached && cached.data && cached.data.length > 0) {
            console.log('Using cached data:', cached.data.length, 'conferences');
            allConferences = cached.data;
            applyFilters();
            showLoading(false);
            updateLastUpdated(formatCacheTime(cached.timestamp));
            
            // 后台刷新数据
            refreshDataInBackground();
            return;
        }

        // 从网络加载
        try {
            await fetchAllConferences();
            updateLastUpdated('Just now');
        } catch (error) {
            console.error('Failed to load conferences:', error);
            showError('Failed to load conference data. Please refresh the page.');
        }

        showLoading(false);
    }

    /**
     * 从 ccfddl 获取所有会议数据
     */
    async function fetchAllConferences() {
        const conferences = [];
        const errors = [];
        
        // 并行获取所有分类
        const categoryPromises = CATEGORIES.map(async (category) => {
            try {
                const categoryConfs = await fetchCategoryConferences(category);
                return categoryConfs;
            } catch (error) {
                console.warn(`Failed to fetch ${category}:`, error);
                errors.push(category);
                return [];
            }
        });

        const results = await Promise.all(categoryPromises);
        results.forEach(categoryConfs => {
            conferences.push(...categoryConfs);
        });

        console.log(`Loaded ${conferences.length} conferences from ${CATEGORIES.length - errors.length} categories`);
        
        // 处理数据：只保留未来的会议，按截止日期排序
        allConferences = conferences
            .filter(conf => conf.deadlineDate && conf.deadlineDate > new Date())
            .sort((a, b) => a.deadlineDate - b.deadlineDate);

        console.log(`${allConferences.length} upcoming conferences`);
        
        // 保存到缓存
        saveToCache(allConferences);
        
        applyFilters();
    }

    /**
     * 获取某个分类下的所有会议
     */
    async function fetchCategoryConferences(category) {
        const conferences = [];
        
        // 获取该分类下的文件列表
        const listUrl = `${CONFIG.apiBaseUrl}/${category}`;
        const listResponse = await fetch(listUrl);
        
        if (!listResponse.ok) {
            throw new Error(`Failed to fetch ${category} file list`);
        }
        
        const files = await listResponse.json();
        const ymlFiles = files.filter(f => f.name.endsWith('.yml'));
        
        // 并行获取所有 YAML 文件（限制并发数）
        const batchSize = 10;
        for (let i = 0; i < ymlFiles.length; i += batchSize) {
            const batch = ymlFiles.slice(i, i + batchSize);
            const batchPromises = batch.map(async (file) => {
                try {
                    const confUrl = `${CONFIG.baseUrl}/${category}/${file.name}`;
                    const response = await fetch(confUrl);
                    if (!response.ok) return [];
                    
                    const yamlText = await response.text();
                    const confs = parseConferenceYaml(yamlText, category);
                    return confs;
                } catch (error) {
                    console.warn(`Failed to fetch ${file.name}:`, error);
                    return [];
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(confs => conferences.push(...confs));
            
            // 更新进度
            updateStatus(`Loading ${category}... (${Math.min(i + batchSize, ymlFiles.length)}/${ymlFiles.length})`);
        }
        
        return conferences;
    }

    /**
     * 解析 ccfddl 的 YAML 格式
     */
    function parseConferenceYaml(yamlText, category) {
        const conferences = [];
        
        try {
            const data = jsyaml.load(yamlText);
            if (!Array.isArray(data)) return [];
            
            data.forEach(confGroup => {
                if (!confGroup.confs) return;
                
                // 获取会议基本信息
                const baseInfo = {
                    title: confGroup.title,
                    description: confGroup.description,
                    sub: confGroup.sub || category,
                    rank: confGroup.rank,
                    dblp: confGroup.dblp
                };
                
                // 处理每年的会议
                confGroup.confs.forEach(conf => {
                    if (!conf.timeline || conf.timeline.length === 0) return;
                    
                    // 获取最近的 deadline
                    const timeline = conf.timeline;
                    let latestDeadline = null;
                    let deadlineComment = '';
                    
                    for (const t of timeline) {
                        const deadline = parseDeadline(t.deadline, conf.timezone);
                        if (deadline && (!latestDeadline || deadline > latestDeadline)) {
                            latestDeadline = deadline;
                            deadlineComment = t.comment || '';
                        }
                    }
                    
                    if (!latestDeadline) return;
                    
                    conferences.push({
                        ...baseInfo,
                        year: conf.year,
                        id: conf.id,
                        link: conf.link,
                        deadlineDate: latestDeadline,
                        timezone: conf.timezone,
                        date: conf.date,
                        place: conf.place,
                        note: deadlineComment,
                        abstractDeadline: timeline[0]?.abstract_deadline
                    });
                });
            });
        } catch (error) {
            console.warn('Failed to parse YAML:', error);
        }
        
        return conferences;
    }

    /**
     * 解析截止时间
     */
    function parseDeadline(deadline, timezone) {
        if (!deadline || deadline === 'TBD') return null;
        
        try {
            // 处理时区
            let offset = 0;
            if (timezone) {
                if (timezone === 'AoE') {
                    offset = 12; // Anywhere on Earth = UTC-12
                } else {
                    const match = timezone.match(/UTC([+-])(\d+)/);
                    if (match) {
                        offset = parseInt(match[2]) * (match[1] === '+' ? -1 : 1);
                    }
                }
            }
            
            // 解析日期时间
            const dateStr = deadline.replace(' ', 'T');
            const date = new Date(dateStr);
            
            if (isNaN(date.getTime())) return null;
            
            // 调整时区到本地时间
            date.setHours(date.getHours() + offset + new Date().getTimezoneOffset() / 60);
            
            return date;
        } catch (e) {
            return null;
        }
    }

    /**
     * 应用筛选
     */
    function applyFilters() {
        filteredConferences = allConferences.filter(conf => {
            // 领域筛选
            if (currentSubFilter !== 'all' && conf.sub !== currentSubFilter) {
                return false;
            }

            // 时间筛选
            if (currentTimeFilter !== 'all') {
                const days = parseInt(currentTimeFilter);
                const maxDate = new Date();
                maxDate.setDate(maxDate.getDate() + days);
                if (conf.deadlineDate > maxDate) {
                    return false;
                }
            }

            // 搜索筛选
            if (currentSearchQuery) {
                const query = currentSearchQuery.toLowerCase();
                const searchText = `${conf.title} ${conf.description || ''} ${conf.place || ''}`.toLowerCase();
                if (!searchText.includes(query)) {
                    return false;
                }
            }

            return true;
        });

        renderConferences();
    }

    /**
     * 渲染会议卡片
     */
    function renderConferences() {
        if (!elements.grid) return;
        
        if (filteredConferences.length === 0) {
            elements.grid.innerHTML = '';
            if (elements.noResults) {
                elements.noResults.style.display = 'block';
            }
            return;
        }

        if (elements.noResults) {
            elements.noResults.style.display = 'none';
        }
        
        const html = filteredConferences.map(conf => createConferenceCard(conf)).join('');
        elements.grid.innerHTML = html;
    }

    /**
     * 创建会议卡片 HTML
     */
    function createConferenceCard(conf) {
        const daysLeft = getDaysLeft(conf.deadlineDate);
        const urgencyClass = getUrgencyClass(daysLeft);
        const subColor = SUB_COLORS[conf.sub] || '#7f8c8d';
        const ccfRank = conf.rank?.ccf || 'N';
        const rankColor = RANK_COLORS[ccfRank] || RANK_COLORS['N'];
        
        return `
            <div class="cfp-card ${urgencyClass}">
                <div class="cfp-card-header">
                    <h3 class="cfp-card-title">
                        <a href="${conf.link}" target="_blank" rel="noopener">${conf.title} ${conf.year}</a>
                    </h3>
                    <div class="cfp-card-badges">
                        <span class="cfp-card-rank" style="color: ${rankColor}; border-color: ${rankColor}">CCF ${ccfRank}</span>
                        <span class="cfp-card-sub" style="color: ${subColor}; border-color: ${subColor}">${conf.sub}</span>
                    </div>
                </div>
                
                ${conf.description ? `<p class="cfp-card-fullname">${conf.description}</p>` : ''}
                
                <div class="cfp-card-countdown" data-deadline="${conf.deadlineDate.toISOString()}">
                    <span class="countdown-icon">⏰</span>
                    <span class="countdown-value">${formatCountdown(conf.deadlineDate)}</span>
                </div>
                
                <div class="cfp-card-deadline">
                    <i class="fas fa-clock"></i>
                    ${formatDate(conf.deadlineDate)}
                    ${conf.timezone ? `<span class="timezone">(${conf.timezone})</span>` : ''}
                </div>
                
                <div class="cfp-card-info">
                    ${conf.date ? `<div class="cfp-card-date"><i class="fas fa-calendar"></i> ${conf.date}</div>` : ''}
                    ${conf.place ? `<div class="cfp-card-place"><i class="fas fa-map-marker-alt"></i> ${conf.place}</div>` : ''}
                </div>
                
                ${conf.note ? `<div class="cfp-card-note"><i class="fas fa-info-circle"></i> ${conf.note}</div>` : ''}
                
                <div class="cfp-card-actions">
                    <a href="${conf.link}" target="_blank" rel="noopener" class="cfp-card-link">
                        <i class="fas fa-external-link-alt"></i> Website
                    </a>
                    ${conf.dblp ? `<a href="https://dblp.org/db/conf/${conf.dblp}" target="_blank" rel="noopener" class="cfp-card-link cfp-card-link-secondary">
                        <i class="fas fa-book"></i> DBLP
                    </a>` : ''}
                </div>
            </div>
        `;
    }

    /**
     * 获取剩余天数
     */
    function getDaysLeft(deadline) {
        const now = new Date();
        const diff = deadline - now;
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    /**
     * 获取紧急程度样式类
     */
    function getUrgencyClass(daysLeft) {
        if (daysLeft <= 7) return 'urgency-critical';
        if (daysLeft <= 30) return 'urgency-warning';
        return 'urgency-normal';
    }

    /**
     * 格式化倒计时
     */
    function formatCountdown(deadline) {
        const now = new Date();
        const diff = deadline - now;
        
        if (diff <= 0) return 'Expired';
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        if (days > 0) {
            return `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        } else {
            return `${minutes}m ${seconds}s`;
        }
    }

    /**
     * 格式化日期
     */
    function formatDate(date) {
        const options = { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        };
        return date.toLocaleDateString('en-US', options);
    }

    /**
     * 启动倒计时更新
     */
    function startCountdown() {
        if (countdownTimer) clearInterval(countdownTimer);
        
        countdownTimer = setInterval(() => {
            const countdowns = document.querySelectorAll('.cfp-card-countdown');
            countdowns.forEach(el => {
                const deadline = new Date(el.dataset.deadline);
                const valueEl = el.querySelector('.countdown-value');
                if (valueEl) {
                    valueEl.textContent = formatCountdown(deadline);
                }
            });
        }, CONFIG.updateInterval);
    }

    /**
     * 处理搜索
     */
    function handleSearch(e) {
        currentSearchQuery = e.target.value.trim();
        applyFilters();
    }

    /**
     * 设置活动筛选按钮
     */
    function setActiveFilter(container, activeBtn) {
        container.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        activeBtn.classList.add('active');
    }

    /**
     * 显示/隐藏加载状态
     */
    function showLoading(show) {
        if (elements.loading) {
            elements.loading.style.display = show ? 'block' : 'none';
        }
    }

    /**
     * 更新加载状态文字
     */
    function updateStatus(text) {
        if (elements.loading) {
            elements.loading.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${text}`;
        }
    }

    /**
     * 显示错误信息
     */
    function showError(message) {
        if (elements.grid) {
            elements.grid.innerHTML = `
                <div class="cfp-error">
                    <i class="fas fa-exclamation-triangle"></i>
                    <p>${message}</p>
                    <button onclick="location.reload()" class="cfp-retry-btn">Retry</button>
                </div>
            `;
        }
    }

    /**
     * 更新最后更新时间
     */
    function updateLastUpdated(text) {
        if (elements.lastUpdated) {
            elements.lastUpdated.textContent = text;
        }
    }

    /**
     * 后台刷新数据
     */
    async function refreshDataInBackground() {
        try {
            const cached = loadFromCache();
            // 如果缓存超过 1 小时，后台刷新
            if (cached && Date.now() - cached.timestamp > 60 * 60 * 1000) {
                console.log('Refreshing data in background...');
                await fetchAllConferences();
                updateLastUpdated('Just now');
            }
        } catch (error) {
            console.warn('Background refresh failed:', error);
        }
    }

    /**
     * 缓存操作
     */
    function saveToCache(data) {
        try {
            const cache = {
                timestamp: Date.now(),
                data: data
            };
            localStorage.setItem(CONFIG.cacheKey, JSON.stringify(cache));
        } catch (e) {
            console.warn('Failed to save to cache:', e);
        }
    }

    function loadFromCache() {
        try {
            const cached = localStorage.getItem(CONFIG.cacheKey);
            if (!cached) return null;
            
            const cache = JSON.parse(cached);
            // 检查缓存是否过期
            if (Date.now() - cache.timestamp > CONFIG.cacheDuration) {
                localStorage.removeItem(CONFIG.cacheKey);
                return null;
            }
            
            // 重新解析日期对象
            cache.data = cache.data.map(conf => ({
                ...conf,
                deadlineDate: new Date(conf.deadlineDate)
            }));
            
            return cache;
        } catch (e) {
            console.warn('Failed to load from cache:', e);
            return null;
        }
    }

    function formatCacheTime(timestamp) {
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / (1000 * 60));
        if (minutes < 1) return 'Just now';
        if (minutes < 60) return `${minutes} minute(s) ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours} hour(s) ago`;
        return `${Math.floor(hours / 24)} day(s) ago`;
    }

    /**
     * 防抖函数
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
