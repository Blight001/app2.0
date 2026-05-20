const { IPC_CHANNELS } = require('../../core/ipc/channels');
const {
    OUTLOOK_ACCOUNTS_STORAGE_KEY,
    OUTLOOK_SELECTED_ACCOUNT_KEY,
    parseOutlookAccountsFromText,
    mergeOutlookAccounts
} = require('./outlook-email-utils');

const DEFAULT_GPTMAIL_API_CONFIG = {
    name: 'GPTMail API',
    baseUrl: 'https://mail.chatgpt.org.uk',
    apiKey: 'sk-gd97yXESjxYL',
    authHeaderName: 'X-API-Key',
    authQueryName: '',
    endpoints: {
        generateEmail: '/api/generate-email',
        emails: '/api/emails?email={email}',
        emailDetail: '/api/email/{id}',
        deleteEmail: '/api/email/{id}',
        clearEmails: '/api/emails/clear?email={email}',
        stats: '/api/stats',
        statistics24h: '/api/statistics/24h',
        topSubjects: '/api/statistics/top-subjects',
        topDomains: '/api/statistics/top-domains',
        topSenders: '/api/statistics/top-senders'
    },
    notes: '默认自动填入 API Key，生成邮箱后即可查询收件箱、查看详情、删除邮件和清空收件箱。'
};

function pickFirstText(...values) {
    for (const value of values) {
        const text = String(value ?? '').trim();
        if (text) {
            return text;
        }
    }
    return '';
}

function mergeApiConfig(source = {}) {
    const input = source && typeof source === 'object' ? source : {};
    const endpoints = input.endpoints && typeof input.endpoints === 'object' ? input.endpoints : {};

    return {
        name: pickFirstText(input.name, input.apiName, DEFAULT_GPTMAIL_API_CONFIG.name) || DEFAULT_GPTMAIL_API_CONFIG.name,
        baseUrl: pickFirstText(input.baseUrl, input.baseURL, input.base_url, DEFAULT_GPTMAIL_API_CONFIG.baseUrl) || DEFAULT_GPTMAIL_API_CONFIG.baseUrl,
        apiKey: pickFirstText(input.apiKey, input.api_key, input.api_key_value, DEFAULT_GPTMAIL_API_CONFIG.apiKey) || DEFAULT_GPTMAIL_API_CONFIG.apiKey,
        authHeaderName: pickFirstText(input.authHeaderName, input.auth_header_name, DEFAULT_GPTMAIL_API_CONFIG.authHeaderName) || DEFAULT_GPTMAIL_API_CONFIG.authHeaderName,
        authQueryName: pickFirstText(input.authQueryName, input.auth_query_name, DEFAULT_GPTMAIL_API_CONFIG.authQueryName) || DEFAULT_GPTMAIL_API_CONFIG.authQueryName,
        endpoints: {
            generateEmail: pickFirstText(
                endpoints.generateEmail,
                endpoints.generate_email,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.generateEmail
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.generateEmail,
            emails: pickFirstText(
                endpoints.emails,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.emails
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.emails,
            emailDetail: pickFirstText(
                endpoints.emailDetail,
                endpoints.email_detail,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.emailDetail
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.emailDetail,
            deleteEmail: pickFirstText(
                endpoints.deleteEmail,
                endpoints.delete_email,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.deleteEmail
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.deleteEmail,
            clearEmails: pickFirstText(
                endpoints.clearEmails,
                endpoints.clear_emails,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.clearEmails
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.clearEmails,
            stats: pickFirstText(
                endpoints.stats,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.stats
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.stats,
            statistics24h: pickFirstText(
                endpoints.statistics24h,
                endpoints.statistics_24h,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.statistics24h
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.statistics24h,
            topSubjects: pickFirstText(
                endpoints.topSubjects,
                endpoints.top_subjects,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.topSubjects
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.topSubjects,
            topDomains: pickFirstText(
                endpoints.topDomains,
                endpoints.top_domains,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.topDomains
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.topDomains,
            topSenders: pickFirstText(
                endpoints.topSenders,
                endpoints.top_senders,
                DEFAULT_GPTMAIL_API_CONFIG.endpoints.topSenders
            ) || DEFAULT_GPTMAIL_API_CONFIG.endpoints.topSenders
        },
        notes: pickFirstText(input.notes, input.description, DEFAULT_GPTMAIL_API_CONFIG.notes) || DEFAULT_GPTMAIL_API_CONFIG.notes
    };
}

module.exports = function createRendererTempEmail(deps) {
    const {
        elements,
        ipcRenderer,
        utils,
        logger
    } = deps;

    const state = {
        providers: [],
        selectedProviderId: '',
        selectedProviderName: '',
        selectedMode: 'tcp',
        selectedOutlookAccount: '',
        apiConfig: mergeApiConfig(),
        browserOpen: false,
        browserId: '',
        currentUrl: '',
        currentEmail: '',
        selectedEmailId: '',
        selectedEmailAddress: '',
        currentCode: '',
        currentSelection: '',
        outlookAccounts: [],
        selectedOutlookAccountId: '',
        outlookContentMap: {}
    };

    function appendTempEmailLog(message, color) {
        const log = elements.tempEmailConsoleOutput;
        if (!log) {
            logger.info(message);
            return;
        }

        const line = document.createElement('div');
        line.style.marginBottom = '4px';
        line.style.wordBreak = 'break-all';
        if (color) {
            line.style.color = color;
        }
        line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        log.appendChild(line);

        const autoScrollCheckbox = elements.tempEmailAutoScroll;
        if (autoScrollCheckbox && autoScrollCheckbox.checked) {
            log.scrollTop = log.scrollHeight;
        }
    }

    function setResultCard(target, content, status = 'idle') {
        if (!target) {
            return;
        }

        target.innerHTML = '';
        target.className = `email-api-result-block email-api-result-block--${status}`;

        if (content === null || content === undefined || content === '') {
            const empty = document.createElement('div');
            empty.className = 'email-api-empty';
            empty.textContent = '暂无结果';
            target.appendChild(empty);
            return;
        }

        if (typeof content === 'string') {
            const text = document.createElement('div');
            text.className = status === 'error' ? 'email-api-status email-api-status--error' : 'email-api-status';
            text.textContent = content;
            target.appendChild(text);
            return;
        }

        if (Array.isArray(content)) {
            if (content.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'email-api-empty';
                empty.textContent = '暂无结果';
                target.appendChild(empty);
                return;
            }

            const list = document.createElement('div');
            list.className = 'email-api-list';
            for (const item of content) {
                const row = document.createElement('div');
                row.className = 'email-api-list-item';
                if (item && typeof item === 'object') {
                    row.textContent = item.subject || item.email_address || item.id || JSON.stringify(item);
                } else {
                    row.textContent = String(item);
                }
                list.appendChild(row);
            }
            target.appendChild(list);
            return;
        }

        if (typeof content === 'object') {
            if (content && Object.prototype.hasOwnProperty.call(content, 'detail') && Object.prototype.hasOwnProperty.call(content, 'verification_code')) {
                const wrapper = document.createElement('div');

                if (content.verification_code) {
                    const codeBlock = document.createElement('div');
                    codeBlock.className = 'email-api-value';
                    codeBlock.textContent = `验证码: ${content.verification_code}`;
                    wrapper.appendChild(codeBlock);
                }

                const pre = document.createElement('pre');
                pre.className = 'email-api-json';
                pre.textContent = JSON.stringify(content.detail, null, 2);
                wrapper.appendChild(pre);
                target.appendChild(wrapper);
                return;
            }

            const pre = document.createElement('pre');
            pre.className = 'email-api-json';
            pre.textContent = JSON.stringify(content, null, 2);
            target.appendChild(pre);
            return;
        }

        const text = document.createElement('div');
        text.className = 'email-api-status';
        text.textContent = String(content);
        target.appendChild(text);
    }

    function setStatusCard(target, message, status = 'idle') {
        if (!target) {
            return;
        }

        target.className = `email-api-status email-api-status--${status}`;
        target.textContent = message;
    }

    function loadOutlookState() {
        try {
            const selectedId = window.localStorage.getItem(OUTLOOK_SELECTED_ACCOUNT_KEY);
            if (selectedId) {
                state.selectedOutlookAccountId = selectedId.trim();
            }
        } catch (error) {
            logger.warning(`读取 Outlook 状态失败: ${error.message}`);
        }
    }

    function saveOutlookState() {
        try {
            window.localStorage.setItem(OUTLOOK_SELECTED_ACCOUNT_KEY, state.selectedOutlookAccountId || '');
        } catch (error) {
            logger.warning(`保存 Outlook 状态失败: ${error.message}`);
        }
    }

    function setOutlookAccounts(accounts = []) {
        state.outlookAccounts = mergeOutlookAccounts([], accounts);
    }

    function openOutlookImportDialog() {
        if (!elements.outlookEmailImportDialog) {
            return;
        }
        if (elements.outlookEmailImportText) {
            elements.outlookEmailImportText.value = '';
        }
        elements.outlookEmailImportDialog.style.display = 'flex';
    }

    function closeOutlookImportDialog() {
        if (elements.outlookEmailImportDialog) {
            elements.outlookEmailImportDialog.style.display = 'none';
        }
    }

    function setOutlookContent(content, status = 'idle') {
        const target = elements.outlookEmailContent;
        if (!target) {
            return;
        }

        target.innerHTML = '';

        if (!content) {
            const empty = document.createElement('div');
            empty.className = 'outlook-email-empty';
            empty.textContent = '暂无内容';
            target.appendChild(empty);
            return;
        }

        if (status === 'frame') {
            const frame = document.createElement('iframe');
            frame.className = 'outlook-email-frame';
            frame.src = String(content || '').trim();
            frame.setAttribute('loading', 'eager');
            frame.setAttribute('referrerpolicy', 'no-referrer');
            frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
            target.appendChild(frame);
            return;
        }

        const pre = document.createElement('pre');
        pre.className = `email-api-json outlook-email-pre outlook-email-pre--${status}`;
        pre.textContent = simplifyOutlookContent(content);
        target.appendChild(pre);
    }

    function simplifyOutlookContent(value = '') {
        const input = String(value || '').trim();
        if (!input) {
            return '';
        }

        const looksLikeHtml = /<[^>]+>/.test(input);
        if (!looksLikeHtml || typeof DOMParser === 'undefined') {
            return input
                .replace(/\r\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(input, 'text/html');
            const title = String(doc.title || '').trim();

            const body = doc.body ? doc.body.cloneNode(true) : null;
            if (!body) {
                return input
                    .replace(/\r\n/g, '\n')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
            }

            body.querySelectorAll('script, style, noscript, link, meta, iframe, svg, canvas').forEach((node) => node.remove());
            body.querySelectorAll('br').forEach((node) => {
                node.replaceWith('\n');
            });

            const blockTags = 'p,div,section,article,header,footer,main,aside,li,tr,table,thead,tbody,tfoot,h1,h2,h3,h4,h5,h6,blockquote,pre';
            body.querySelectorAll(blockTags).forEach((node) => {
                const tagName = String(node.tagName || '').toLowerCase();
                if (tagName === 'pre') {
                    return;
                }
                if (!node.textContent?.trim()) {
                    return;
                }
                node.insertAdjacentText('afterend', '\n');
            });

            let text = body.textContent || '';
            text = text
                .replace(/\u00a0/g, ' ')
                .replace(/[\t ]+\n/g, '\n')
                .replace(/\n[ \t]+/g, '\n')
                .replace(/[ \t]{2,}/g, ' ')
                .replace(/\n{3,}/g, '\n\n')
                .trim();

            if (title) {
                const titleLine = `标题: ${title}`;
                text = text ? `${titleLine}\n\n${text}` : titleLine;
            }

            return text || input;
        } catch (_error) {
            return input
                .replace(/\r\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }
    }

    function getSelectedOutlookAccount() {
        return state.outlookAccounts.find((item) => item.id === state.selectedOutlookAccountId) || null;
    }

    function renderOutlookAccounts() {
        const target = elements.outlookEmailList;
        if (!target) {
            return;
        }

        target.innerHTML = '';

        if (!Array.isArray(state.outlookAccounts) || state.outlookAccounts.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'outlook-email-empty';
            empty.textContent = '暂无 Outlook 邮箱';
            target.appendChild(empty);
            setOutlookContent('暂无收件箱邮件需要显示');
            return;
        }

        for (const account of state.outlookAccounts) {
            const row = document.createElement('div');
            row.className = 'outlook-email-item';
            if (state.selectedOutlookAccountId && state.selectedOutlookAccountId === account.id) {
                row.classList.add('is-selected');
            }

            const main = document.createElement('div');
            main.className = 'outlook-email-item__main';

            const email = document.createElement('div');
            email.className = 'outlook-email-item__email';
            email.textContent = account.email;

            const password = document.createElement('div');
            password.className = 'outlook-email-item__password';
            password.textContent = account.password;

            main.appendChild(email);
            main.appendChild(password);

            const actions = document.createElement('div');
            actions.className = 'outlook-email-item__actions';

            const fetchBtn = document.createElement('button');
            fetchBtn.type = 'button';
            fetchBtn.className = 'btn btn-secondary btn-small';
            fetchBtn.textContent = '获取内容';
            fetchBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                await fetchOutlookContent(account.id);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'btn btn-danger btn-small';
            deleteBtn.textContent = '删除';
            deleteBtn.addEventListener('click', async (event) => {
                event.stopPropagation();
                await deleteOutlookAccount(account.id);
            });

            actions.appendChild(fetchBtn);
            actions.appendChild(deleteBtn);
            row.appendChild(main);
            row.appendChild(actions);
            row.addEventListener('click', () => {
                state.selectedOutlookAccountId = account.id;
                saveOutlookState();
                renderOutlookAccounts();
            });
            target.appendChild(row);
        }

        const selected = getSelectedOutlookAccount() || state.outlookAccounts[0] || null;
        if (selected && !state.selectedOutlookAccountId) {
            state.selectedOutlookAccountId = selected.id;
            saveOutlookState();
            renderOutlookAccounts();
            return;
        }

        if (!selected && state.selectedOutlookAccountId) {
            state.selectedOutlookAccountId = '';
            saveOutlookState();
        } else if (selected && state.selectedOutlookAccountId !== selected.id && !state.outlookAccounts.some((item) => item.id === state.selectedOutlookAccountId)) {
            state.selectedOutlookAccountId = selected.id;
            saveOutlookState();
            renderOutlookAccounts();
        }
    }

    async function importOutlookAccountsFromText(text = '') {
        const imported = parseOutlookAccountsFromText(text);
        if (!imported.length) {
            return { success: false, error: '没有解析到有效的 Outlook 邮箱记录' };
        }

        state.outlookAccounts = mergeOutlookAccounts(state.outlookAccounts, imported);
        if (!state.selectedOutlookAccountId && state.outlookAccounts[0]) {
            state.selectedOutlookAccountId = state.outlookAccounts[0].id;
        }
        saveOutlookState();
        try {
            const persistResult = await ipcRenderer.invoke('outlook-email-save-records', {
                outlookAccounts: state.outlookAccounts
            });
            if (!persistResult || persistResult.success !== true) {
                throw new Error(persistResult?.error || '保存 Outlook 记录失败');
            }
        } catch (error) {
            logger.warning(`Outlook 记录持久化失败: ${error.message}`);
        }
        renderOutlookAccounts();
        return { success: true, count: imported.length, accounts: state.outlookAccounts };
    }

    async function persistOutlookAccounts(accounts = []) {
        const normalized = mergeOutlookAccounts([], accounts);
        const persistResult = await ipcRenderer.invoke('outlook-email-save-records', {
            outlookAccounts: normalized
        });
        if (!persistResult || persistResult.success !== true) {
            throw new Error(persistResult?.error || '保存 Outlook 记录失败');
        }
        return persistResult;
    }

    async function fetchOutlookContent(accountId = '') {
        const account = state.outlookAccounts.find((item) => item.id === accountId) || null;
        if (!account) {
            return { success: false, error: '请选择一个 Outlook 邮箱' };
        }

        state.selectedOutlookAccountId = account.id;
        saveOutlookState();
        renderOutlookAccounts();
        setOutlookContent('正在获取内容...', 'loading');

        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.outlookFetchContent, { url: account.url });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '获取 Outlook 内容失败');
            }

            const frameUrl = String(result.url || account.url || '').trim();
            state.outlookContentMap[account.id] = frameUrl;
            setOutlookContent(frameUrl || '暂无收件箱邮件需要显示', frameUrl ? 'frame' : 'success');
            return { success: true, account, content: frameUrl };
        } catch (error) {
            const fallback = `获取失败: ${error.message}`;
            state.outlookContentMap[account.id] = fallback;
            setOutlookContent(fallback, 'error');
            return { success: false, error: error.message };
        }
    }

    async function deleteOutlookAccount(accountId = '') {
        const account = state.outlookAccounts.find((item) => item.id === accountId) || null;
        if (!account) {
            return { success: false, error: '请选择一个 Outlook 邮箱' };
        }

        const confirmed = await utils.showConfirmDialog(
            `确定删除 Outlook 邮箱「${account.email}」吗？`,
            { title: '删除 Outlook 邮箱' },
            elements
        );
        if (!confirmed) {
            return { success: false, cancelled: true };
        }

        const nextAccounts = state.outlookAccounts.filter((item) => item.id !== account.id);
        state.outlookAccounts = nextAccounts;

        if (state.selectedOutlookAccountId === account.id) {
            state.selectedOutlookAccountId = nextAccounts[0]?.id || '';
        }

        saveOutlookState();
        try {
            await persistOutlookAccounts(nextAccounts);
        } catch (error) {
            logger.warning(`删除 Outlook 记录持久化失败: ${error.message}`);
            return { success: false, error: error.message };
        }

        if (!state.selectedOutlookAccountId) {
            setOutlookContent('暂无收件箱邮件需要显示');
        } else if (state.outlookContentMap[state.selectedOutlookAccountId]) {
            setOutlookContent(state.outlookContentMap[state.selectedOutlookAccountId], 'success');
        } else {
            setOutlookContent('暂无收件箱邮件需要显示');
        }

        renderOutlookAccounts();
        return { success: true, accounts: nextAccounts };
    }

    async function importOutlookAccountsFromDialog() {
        const text = String(elements.outlookEmailImportText?.value || '').trim();
        const result = await importOutlookAccountsFromText(text);
        if (result.success) {
            closeOutlookImportDialog();
            appendTempEmailLog(`已导入 ${result.count || 0} 条 Outlook 邮箱`, '#198754');
        }
        return result;
    }

    async function clearOutlookAccounts() {
        const confirmed = await utils.showConfirmDialog(
            '确定清空全部 Outlook 邮箱吗？此操作会同时清空记录文件。',
            { title: '清空 Outlook 邮箱' },
            elements
        );
        if (!confirmed) {
            return { success: false, cancelled: true };
        }

        state.outlookAccounts = [];
        state.selectedOutlookAccountId = '';
        state.outlookContentMap = {};
        saveOutlookState();
        try {
            await persistOutlookAccounts([]);
        } catch (error) {
            logger.warning(`清空 Outlook 记录失败: ${error.message}`);
            return { success: false, error: error.message };
        }

        renderOutlookAccounts();
        setOutlookContent('暂无收件箱邮件需要显示');
        return { success: true };
    }

    function stripHtmlTags(html = '') {
        return String(html || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/gi, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    function normalizeVerificationCandidate(value = '') {
        const candidate = String(value || '').trim();
        if (!candidate) {
            return '';
        }

        const normalizedLower = candidate.toLowerCase();
        const stopWords = new Set([
            'your',
            'the',
            'and',
            'for',
            'from',
            'this',
            'that',
            'with',
            'code',
            'otp',
            'sms',
            'verification',
            'verify',
            'is',
            'are',
            'was',
            'were',
            'be',
            'to',
            'of'
        ]);
        if (stopWords.has(normalizedLower)) {
            return '';
        }

        const compact = candidate.replace(/\s+/g, '').toUpperCase();
        if (/^\d{4,8}$/.test(compact)) {
            return compact;
        }

        if (/^[A-Z0-9]{4,12}$/.test(compact) && (/[A-Z]/.test(compact) || /\d/.test(compact))) {
            return compact;
        }

        return '';
    }

    function isLikelyVerificationCode(value = '') {
        return Boolean(normalizeVerificationCandidate(value));
    }

    function extractVerificationCode(text = '') {
        const normalizedText = String(text || '')
            .replace(/[\u00a0\u200b-\u200d\ufeff]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!normalizedText) {
            return '';
        }

        const isValidCandidate = (value) => {
            const candidate = String(value || '').trim();
            if (!candidate) {
                return '';
            }

            if (/^(your|the|and|for|from|this|that|with|code|otp|sms|verification|verify|is|are|was|were|be|to|of|continue|submit|next|send|click|open|confirm|ok|done|help)$/i.test(candidate)) {
                return '';
            }

            const compact = candidate.replace(/\s+/g, '').toUpperCase();
            if (/^\d{4,8}$/.test(compact)) {
                return compact;
            }

        if (/^[A-Z0-9]{4,12}$/.test(compact) && /\d/.test(compact)) {
            return compact;
        }

        if (/^[A-Z]{4,6}$/.test(compact)) {
            return compact;
        }

            return '';
        };

        const keywordPattern = /(?:验证码|verification[_\s-]*code|sms[_\s-]*code|code|otp)/i;
        const keywordMatch = normalizedText.match(keywordPattern);
        if (keywordMatch && typeof keywordMatch.index === 'number') {
            const tail = normalizedText.slice(keywordMatch.index + keywordMatch[0].length);
            const tokens = tail.match(/\b[A-Za-z0-9]{4,12}\b/g) || [];
            for (const token of tokens) {
                const candidate = isValidCandidate(token);
                if (candidate) {
                    return candidate;
                }
            }
        }

        const digitMatch = normalizedText.match(/\b(\d{4,8})\b/);
        if (digitMatch && digitMatch[1]) {
            return digitMatch[1];
        }

        return '';
    }

    function extractVerificationCodeFromDetail(detail = {}) {
        const candidates = [];
        if (!detail || typeof detail !== 'object') {
            return '';
        }

        if (detail.content) {
            candidates.push(String(detail.content));
        }
        if (detail.html_content) {
            candidates.push(stripHtmlTags(detail.html_content));
        }
        if (detail.subject) {
            candidates.push(String(detail.subject));
        }

        const directFields = [
            detail.code,
            detail.verification_code,
            detail.verificationCode,
            detail.otp,
            detail.otp_code,
            detail.otpCode
        ];

        for (const value of directFields) {
            const code = String(value || '').trim();
            if (code) {
                return code;
            }
        }

        for (const candidate of candidates) {
            const code = extractVerificationCode(candidate);
            if (code && isLikelyVerificationCode(code)) {
                return code;
            }
        }

        return '';
    }

    function getActiveEmailAddress() {
        return String(state.currentEmail || state.selectedEmailAddress || '').trim();
    }

    function getSelectedEmailId() {
        return String(state.selectedEmailId || state.currentSelection || '').trim();
    }

    function syncApiActionButtons() {
        const hasEmailAddress = Boolean(getActiveEmailAddress());
        const hasSelectedEmail = Boolean(getSelectedEmailId());

        if (elements.emailApiCopyBtn) {
            elements.emailApiCopyBtn.disabled = !hasEmailAddress;
        }
        if (elements.emailApiListBtn) {
            elements.emailApiListBtn.disabled = !hasEmailAddress;
        }
        if (elements.emailApiDetailBtn) {
            elements.emailApiDetailBtn.disabled = !hasSelectedEmail;
        }
        if (elements.emailApiRawDetailResult) {
            elements.emailApiRawDetailResult.classList.toggle('is-disabled', !hasSelectedEmail);
        }
        if (elements.emailApiDeleteBtn) {
            elements.emailApiDeleteBtn.disabled = !hasSelectedEmail;
        }
        if (elements.emailApiClearBtn) {
            elements.emailApiClearBtn.disabled = !hasEmailAddress;
        }
    }

    function clearInboxSelection() {
        state.selectedEmailId = '';
        state.selectedEmailAddress = '';
        state.currentSelection = '';

        const target = elements.emailApiInboxResult;
        if (target) {
            target.querySelectorAll('.email-api-inbox-item').forEach((item) => {
                item.classList.remove('is-selected');
            });
        }

        syncApiActionButtons();
    }

    async function copyGeneratedEmail() {
        const email = getActiveEmailAddress();
        if (!email) {
            return { success: false, error: '暂无可复制的邮箱地址' };
        }

        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(email);
            } else {
                const input = document.createElement('textarea');
                input.value = email;
                input.setAttribute('readonly', 'readonly');
                input.style.position = 'fixed';
                input.style.left = '-9999px';
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                document.body.removeChild(input);
            }

            appendTempEmailLog(`已复制邮箱: ${email}`, '#198754');
            return { success: true, email };
        } catch (error) {
            logger.error(`复制邮箱失败: ${error.message}`);
            appendTempEmailLog(`复制邮箱失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    function renderInboxResult(emails = []) {
        const target = elements.emailApiInboxResult;
        if (!target) {
            return;
        }

        target.innerHTML = '';
        target.className = 'email-api-result-block email-api-result-block--success';

        if (!Array.isArray(emails) || emails.length === 0) {
            clearInboxSelection();
            const empty = document.createElement('div');
            empty.className = 'email-api-empty';
            empty.textContent = '暂无收件箱结果';
            target.appendChild(empty);
            return;
        }

        const list = document.createElement('div');
        list.className = 'email-api-inbox-list';

        const selectedId = String(state.selectedEmailId || '').trim();
        const currentEmail = getActiveEmailAddress();
        let firstSelectable = null;

        for (const email of emails) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'email-api-inbox-item';
            const emailId = String(email?.id || '').trim();
            const emailAddress = String(email?.email_address || email?.email || '').trim();
            if (!firstSelectable && emailId) {
                firstSelectable = { emailId, emailAddress, item };
            }
            if (selectedId && emailId && selectedId === emailId) {
                item.classList.add('is-selected');
            }

            const title = document.createElement('div');
            title.className = 'email-api-inbox-item__title';
            title.textContent = String(email?.subject || email?.email_subject || '(无主题)');

            const meta = document.createElement('div');
            meta.className = 'email-api-inbox-item__meta';
            const fromAddress = String(email?.from_address || email?.from || '-');
            const timeText = email?.timestamp
                ? new Date(Number(email.timestamp) * 1000).toLocaleString()
                : String(email?.created_at || email?.date || '-');
            meta.textContent = `${fromAddress} · ${timeText}`;

            const address = document.createElement('div');
            address.className = 'email-api-inbox-item__email';
            address.textContent = String(email?.email_address || email?.email || '');

            item.appendChild(title);
            item.appendChild(meta);
            item.appendChild(address);
            item.addEventListener('click', () => {
                clearInboxSelection();
                if (emailId) {
                    state.selectedEmailId = emailId;
                    state.selectedEmailAddress = emailAddress || currentEmail;
                    state.currentSelection = emailId;
                    if (emailAddress) {
                        state.currentEmail = emailAddress;
                    }
                    item.classList.add('is-selected');
                }
                syncApiActionButtons();
                setStatusCard(
                    elements.emailApiDetailResult,
                    `已选择邮件 ID: ${emailId || '-'}`,
                    'success'
                );
            });

            list.appendChild(item);
        }

        target.appendChild(list);

        if (!selectedId && firstSelectable) {
            state.selectedEmailId = firstSelectable.emailId;
            state.selectedEmailAddress = firstSelectable.emailAddress || currentEmail;
            state.currentSelection = firstSelectable.emailId;
            if (firstSelectable.emailAddress) {
                state.currentEmail = firstSelectable.emailAddress;
            }
            firstSelectable.item.classList.add('is-selected');
            setStatusCard(
                elements.emailApiDetailResult,
                `已自动选择第一封邮件 ID: ${firstSelectable.emailId}`,
                'success'
            );
        }

        syncApiActionButtons();
    }

    function syncModeUi() {
        const isOutlook = state.selectedMode === 'outlook';
        const isTemp = state.selectedMode === 'temp';
        const isApi = state.selectedMode === 'api';

        if (elements.emailModeConnectBtn) {
            elements.emailModeConnectBtn.classList.toggle('active', !isOutlook && !isTemp && !isApi);
            elements.emailModeConnectBtn.setAttribute('aria-pressed', String(!isOutlook && !isTemp && !isApi));
        }
        if (elements.emailModeOutlookBtn) {
            elements.emailModeOutlookBtn.classList.toggle('active', isOutlook);
            elements.emailModeOutlookBtn.setAttribute('aria-pressed', String(isOutlook));
        }
        if (elements.emailModeTempBtn) {
            elements.emailModeTempBtn.classList.toggle('active', isTemp);
            elements.emailModeTempBtn.setAttribute('aria-pressed', String(isTemp));
        }
        if (elements.emailModeApiBtn) {
            elements.emailModeApiBtn.classList.toggle('active', isApi);
            elements.emailModeApiBtn.setAttribute('aria-pressed', String(isApi));
        }
        if (elements.emailModeConnectPanel) {
            elements.emailModeConnectPanel.classList.toggle('active', !isOutlook && !isTemp && !isApi);
        }
        if (elements.emailModeOutlookPanel) {
            elements.emailModeOutlookPanel.classList.toggle('active', isOutlook);
        }
        if (elements.emailModeTempPanel) {
            elements.emailModeTempPanel.classList.toggle('active', isTemp);
        }
        if (elements.emailModeApiPanel) {
            elements.emailModeApiPanel.classList.toggle('active', isApi);
        }
    }

    function updateInfoUi() {
        if (elements.tempEmailAddBtn) {
            elements.tempEmailAddBtn.disabled = false;
        }
        if (elements.tempEmailImportBtn) {
            elements.tempEmailImportBtn.disabled = false;
        }
        if (elements.tempEmailEditBtn) {
            elements.tempEmailEditBtn.disabled = !state.selectedProviderId;
        }
        if (elements.tempEmailDeleteBtn) {
            elements.tempEmailDeleteBtn.disabled = !state.selectedProviderId;
        }
        if (elements.tempEmailOpenBtn) {
            elements.tempEmailOpenBtn.disabled = !state.selectedProviderId;
        }
        if (elements.tempEmailRefreshEmailBtn) {
            elements.tempEmailRefreshEmailBtn.disabled = !state.browserOpen;
        }
        if (elements.tempEmailProviderDebugBtn) {
            elements.tempEmailProviderDebugBtn.disabled = !state.selectedProviderId;
        }
        if (elements.tempEmailGetEmailBtn) {
            elements.tempEmailGetEmailBtn.disabled = !state.selectedProviderId;
        }
        if (elements.tempEmailGetCodeBtn) {
            elements.tempEmailGetCodeBtn.disabled = !state.selectedProviderId;
        }
    }

    function syncApiUi(apiConfig = {}) {
        const config = mergeApiConfig(apiConfig);
        state.apiConfig = config;

        if (elements.emailApiBaseUrl) {
            elements.emailApiBaseUrl.value = String(config.baseUrl || DEFAULT_GPTMAIL_API_CONFIG.baseUrl);
        }
        if (elements.emailApiKey) {
            elements.emailApiKey.value = String(config.apiKey || DEFAULT_GPTMAIL_API_CONFIG.apiKey);
        }
        state.selectedEmailAddress = getActiveEmailAddress();
        const emailAddress = getActiveEmailAddress();
        if (emailAddress) {
            setResultCard(elements.emailApiGeneratedEmail, emailAddress, 'success');
        } else {
            setResultCard(elements.emailApiGeneratedEmail, '尚未生成邮箱', 'idle');
        }
        setResultCard(elements.emailApiInboxResult, '暂无收件箱结果', 'idle');
        setResultCard(elements.emailApiDetailResult, '暂无邮件详情', 'idle');
        setResultCard(elements.emailApiRawDetailResult, '暂无原始详情', 'idle');
        setStatusCard(elements.emailApiDeleteResult, '等待操作', 'idle');
        setStatusCard(elements.emailApiClearResult, '等待操作', 'idle');
        syncApiActionButtons();
    }

    function getApiRequestConfig() {
        return mergeApiConfig(state.apiConfig || DEFAULT_GPTMAIL_API_CONFIG);
    }

    function getApiConfig() {
        return getApiRequestConfig();
    }

    async function setApiConfig(apiConfig = {}) {
        const normalizedApiConfig = mergeApiConfig({
            ...(state.apiConfig || DEFAULT_GPTMAIL_API_CONFIG),
            ...(apiConfig && typeof apiConfig === 'object' ? apiConfig : {})
        });

        state.apiConfig = normalizedApiConfig;
        syncApiUi(normalizedApiConfig);

        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailSaveApiConfig, normalizedApiConfig);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '保存临时邮箱 API 配置失败');
            }

            if (result.apiConfig && typeof result.apiConfig === 'object') {
                state.apiConfig = mergeApiConfig(result.apiConfig);
            } else if (result.state && typeof result.state === 'object' && result.state.apiConfig) {
                state.apiConfig = mergeApiConfig(result.state.apiConfig);
            }

            syncApiUi(state.apiConfig);
            appendTempEmailLog('临时邮箱 API 配置已保存', '#198754');
            return result;
        } catch (error) {
            logger.error(`保存临时邮箱 API 配置失败: ${error.message}`);
            appendTempEmailLog(`保存临时邮箱 API 配置失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    function buildApiUrl(endpoint, query = '') {
        const apiConfig = getApiRequestConfig();
        const baseUrl = String(elements.emailApiBaseUrl?.value || apiConfig.baseUrl || '').trim().replace(/\/+$/, '');
        const resolvedEndpoint = String(endpoint || '').trim();
        if (!resolvedEndpoint) {
            return baseUrl;
        }

        const [rawPath, rawSearch = ''] = resolvedEndpoint.split('?');
        const url = new URL(`${baseUrl}/${String(rawPath || '').trim().replace(/^\/+/, '')}`);
        const searchParams = new URLSearchParams(rawSearch);
        const extraQuery = String(query || '').trim().replace(/^[?&]+/, '');
        if (extraQuery) {
            const extraParams = new URLSearchParams(extraQuery);
            for (const [key, value] of extraParams.entries()) {
                searchParams.set(key, value);
            }
        }

        const apiKey = String(elements.emailApiKey?.value || apiConfig.apiKey || '').trim();
        const authQueryName = String(apiConfig.authQueryName || '').trim();
        if (apiKey && authQueryName && !searchParams.has(authQueryName)) {
            searchParams.set(authQueryName, apiKey);
        }

        const searchText = searchParams.toString();
        url.search = searchText;
        return url.toString();
    }

    function getApiHeaders() {
        const apiConfig = getApiRequestConfig();
        const headers = {
            Accept: 'application/json'
        };
        const apiKey = String(elements.emailApiKey?.value || apiConfig.apiKey || '').trim();
        if (apiKey && apiConfig.authHeaderName) {
            headers[apiConfig.authHeaderName || 'X-API-Key'] = apiKey;
        }
        return headers;
    }

    function logApi(level, message, data = null) {
        const normalizedLevel = ['debug', 'info', 'warning', 'error'].includes(level) ? level : 'info';
        if (logger && typeof logger[normalizedLevel] === 'function') {
            logger[normalizedLevel](message, data);
        } else if (logger && normalizedLevel === 'warning' && typeof logger.warn === 'function') {
            logger.warn(message, data);
        }
    }

    async function requestApi(method, url, body = null) {
        logApi('info', `请求 ${method} ${url}`, {
            method,
            url,
            hasBody: body !== null && body !== undefined
        });
        const options = {
            method,
            headers: getApiHeaders()
        };
        if (body !== null && body !== undefined) {
            options.body = typeof body === 'string' ? body : JSON.stringify(body);
            options.headers = {
                ...options.headers,
                'Content-Type': 'application/json'
            };
        }

        const response = await fetch(url, options);
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (_error) {
            data = text;
        }

        if (!response.ok) {
            const errorMessage = typeof data === 'object' && data && data.error
                ? data.error
                : `${response.status} ${response.statusText}`;
            logApi('error', `请求失败 ${method} ${url}: ${errorMessage}`, {
                method,
                url,
                status: response.status,
                statusText: response.statusText,
                response: data
            });
            throw new Error(errorMessage);
        }

        logApi('info', `请求成功 ${method} ${url}`, {
            method,
            url,
            status: response.status,
            response: data
        });
        return data;
    }

    async function runApiRequest(label, executor, handlers = {}) {
        try {
            logApi('info', `开始执行 API 请求: ${label}`);
            const result = await executor();
            logApi('info', `${label} 成功`, result);
            if (typeof handlers.onSuccess === 'function') {
                handlers.onSuccess(result);
            }
            return { success: true, data: result };
        } catch (error) {
            logApi('error', `${label} 失败: ${error.message}`, { error: error.message });
            if (typeof handlers.onError === 'function') {
                handlers.onError(error);
            }
            return { success: false, error: error.message };
        }
    }

    async function generateEmail() {
        const endpoint = getApiRequestConfig().endpoints.generateEmail;
        setStatusCard(elements.emailApiGeneratedEmail, '正在生成邮箱...', 'loading');
        return runApiRequest('生成邮箱', async () => {
            const url = buildApiUrl(endpoint);
            const response = await requestApi('GET', url);
            const generatedEmail = String(response?.data?.email || '').trim();
            if (generatedEmail) {
                clearInboxSelection();
                state.currentEmail = generatedEmail;
                state.selectedEmailAddress = generatedEmail;
                state.currentSelection = '';
                setResultCard(elements.emailApiInboxResult, '暂无收件箱结果', 'idle');
                setResultCard(elements.emailApiDetailResult, '暂无邮件详情', 'idle');
                setStatusCard(elements.emailApiDeleteResult, '等待操作', 'idle');
                setStatusCard(elements.emailApiClearResult, '等待操作', 'idle');
            }
            return response;
        }, {
            onSuccess: (response) => {
                const generatedEmail = String(response?.data?.email || '').trim();
                setResultCard(
                    elements.emailApiGeneratedEmail,
                    generatedEmail || '生成成功，但未返回邮箱地址',
                    'success'
                );
                syncApiActionButtons();
            },
            onError: (error) => {
                setStatusCard(elements.emailApiGeneratedEmail, `生成失败: ${error.message}`, 'error');
            }
        });
    }

    async function listEmails() {
        const email = getActiveEmailAddress();
        const endpoint = getApiRequestConfig().endpoints.emails;
        setResultCard(elements.emailApiInboxResult, '正在查询收件箱...', 'loading');
        return runApiRequest('查询收件箱', async () => {
            if (!email) {
                throw new Error('请先生成邮箱地址');
            }
            state.currentEmail = email;
            state.selectedEmailAddress = email;
            const url = buildApiUrl(endpoint.replace('{email}', encodeURIComponent(email)));
            const response = await requestApi('GET', url);
            return response;
        }, {
            onSuccess: (response) => {
                const emails = Array.isArray(response?.data?.emails) ? response.data.emails : [];
                renderInboxResult(emails);
                if (elements.emailApiRawDetailResult) {
                    setResultCard(elements.emailApiRawDetailResult, response?.data || response, 'success');
                }
            },
            onError: (error) => {
                setResultCard(elements.emailApiInboxResult, `查询失败: ${error.message}`, 'error');
                if (elements.emailApiRawDetailResult) {
                    setResultCard(elements.emailApiRawDetailResult, `查询失败: ${error.message}`, 'error');
                }
            }
        });
    }

    async function getEmailDetail() {
        const emailId = getSelectedEmailId();
        if (!emailId) {
            return { success: false, error: '请先在收件箱中选择一封邮件' };
        }
        const endpoint = getApiRequestConfig().endpoints.emailDetail.replace('{id}', encodeURIComponent(emailId));
        setResultCard(elements.emailApiDetailResult, '正在读取邮件详情...', 'loading');
        return runApiRequest('查看邮件详情', async () => {
            const url = buildApiUrl(endpoint);
            return await requestApi('GET', url);
        }, {
            onSuccess: (response) => {
                const detail = response?.data || response || {};
                const verificationCode = extractVerificationCodeFromDetail(detail);
                if (verificationCode) {
                    state.currentCode = verificationCode;
                }
                setResultCard(elements.emailApiDetailResult, {
                    detail,
                    verification_code: verificationCode || '未识别到验证码'
                }, 'success');
                setResultCard(elements.emailApiRawDetailResult, detail, 'success');
            },
            onError: (error) => {
                setResultCard(elements.emailApiDetailResult, `读取失败: ${error.message}`, 'error');
                setResultCard(elements.emailApiRawDetailResult, `读取失败: ${error.message}`, 'error');
            }
        });
    }

    async function deleteEmail() {
        const emailId = getSelectedEmailId();
        if (!emailId) {
            return { success: false, error: '请先在收件箱中选择一封邮件' };
        }
        const endpoint = getApiRequestConfig().endpoints.deleteEmail.replace('{id}', encodeURIComponent(emailId));
        setStatusCard(elements.emailApiDeleteResult, '正在删除邮件...', 'loading');
        return runApiRequest('删除邮件', async () => {
            const url = buildApiUrl(endpoint);
            return await requestApi('DELETE', url);
        }, {
            onSuccess: (response) => {
                const inboxList = elements.emailApiInboxResult?.querySelector('.email-api-inbox-list') || null;
                const selectedItem = inboxList?.querySelector('.email-api-inbox-item.is-selected') || null;
                if (selectedItem) {
                    selectedItem.remove();
                    const firstItem = inboxList?.querySelector('.email-api-inbox-item') || null;
                    if (firstItem) {
                        firstItem.click();
                    } else {
                        clearInboxSelection();
                        setResultCard(elements.emailApiInboxResult, '暂无收件箱结果', 'idle');
                    }
                } else {
                    clearInboxSelection();
                }
                setStatusCard(elements.emailApiDeleteResult, response?.data?.message || '邮件删除成功', 'success');
                syncApiActionButtons();
            },
            onError: (error) => {
                setStatusCard(elements.emailApiDeleteResult, `删除失败: ${error.message}`, 'error');
            }
        });
    }

    async function clearEmails() {
        const email = getActiveEmailAddress();
        const endpoint = getApiRequestConfig().endpoints.clearEmails;
        setStatusCard(elements.emailApiClearResult, '正在清空收件箱...', 'loading');
        return runApiRequest('清空收件箱', async () => {
            if (!email) {
                throw new Error('请先生成邮箱地址');
            }
            const url = buildApiUrl(endpoint.replace('{email}', encodeURIComponent(email)));
            return await requestApi('DELETE', url);
        }, {
            onSuccess: (response) => {
                clearInboxSelection();
                setResultCard(elements.emailApiInboxResult, '暂无收件箱结果', 'idle');
                setResultCard(elements.emailApiDetailResult, '暂无邮件详情', 'idle');
                setResultCard(elements.emailApiRawDetailResult, '暂无原始详情', 'idle');
                setStatusCard(
                    elements.emailApiClearResult,
                    response?.data?.message || `已清空收件箱 (${response?.data?.count ?? 0})`,
                    'success'
                );
                syncApiActionButtons();
            },
            onError: (error) => {
                setStatusCard(elements.emailApiClearResult, `清空失败: ${error.message}`, 'error');
            }
        });
    }

    function renderProviderList() {
        const list = elements.tempEmailCardList;
        if (!list) {
            return;
        }

        list.innerHTML = '';

        if (!state.providers.length) {
            const empty = document.createElement('div');
            empty.className = 'no-cards';
            empty.textContent = '暂无临时邮箱卡片';
            list.appendChild(empty);
            return;
        }

        for (const provider of state.providers) {
            const item = document.createElement('div');
            item.className = `card-item${provider.id === state.selectedProviderId ? ' selected' : ''}`;
            item.dataset.cardName = provider.id;
            item.setAttribute('role', 'button');
            item.setAttribute('tabindex', '0');
            item.innerHTML = `
                <div class="card-name">${provider.name || provider.id}</div>
                <div class="card-description">${provider.url || '-'}</div>
            `;
            item.addEventListener('click', () => {
                void selectProvider(provider.id);
            });
            item.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void selectProvider(provider.id);
                }
            });
            item.addEventListener('dblclick', () => {
                void openCurrentProvider();
            });
            list.appendChild(item);
        }
    }

    function openProviderDialog(provider = null) {
        if (!elements.tempEmailProviderDialog) {
            return;
        }

        const editingProvider = provider && typeof provider === 'object' ? provider : null;
        if (elements.tempEmailProviderDialogTitle) {
            elements.tempEmailProviderDialogTitle.textContent = editingProvider
                ? '编辑临时邮箱站点'
                : '添加临时邮箱站点';
        }
        if (elements.tempEmailProviderOriginalId) {
            elements.tempEmailProviderOriginalId.value = String(editingProvider?.id || '');
        }
        if (elements.tempEmailProviderName) {
            elements.tempEmailProviderName.value = String(editingProvider?.name || '');
        }
        if (elements.tempEmailProviderUrl) {
            elements.tempEmailProviderUrl.value = String(editingProvider?.url || '');
        }
        if (elements.tempEmailProviderClosePopups) {
            elements.tempEmailProviderClosePopups.value = stringifyListValue(editingProvider?.closePopupSelectors || []);
        }
        if (elements.tempEmailProviderEmailElement) {
            elements.tempEmailProviderEmailElement.value = String(editingProvider?.emailElement || '');
        }
        if (elements.tempEmailProviderRefreshButton) {
            elements.tempEmailProviderRefreshButton.value = String(editingProvider?.refreshButton || '');
        }
        if (elements.tempEmailProviderCodeElement) {
            elements.tempEmailProviderCodeElement.value = String(editingProvider?.codeElement || '');
        }
        if (elements.tempEmailProviderCodeClickElement) {
            elements.tempEmailProviderCodeClickElement.value = String(editingProvider?.codeClickElement || '');
        }

        elements.tempEmailProviderDialog.style.display = 'flex';
    }

    function closeProviderDialog() {
        if (!elements.tempEmailProviderDialog) {
            return;
        }

        elements.tempEmailProviderDialog.style.display = 'none';
    }

    function stringifyListValue(value, fallback = []) {
        const list = Array.isArray(value) ? value : fallback;
        return list.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
    }

    function getEffectiveTempEmailBrowserType() {
        return String(elements.browserType?.value || '').trim() || 'electron';
    }

    function parseSelectorListTextarea(value) {
        const text = String(value || '').trim();
        if (!text) {
            return { success: true, value: [] };
        }

        const selectors = [];
        const seen = new Set();
        for (const line of text.split(/\r?\n/)) {
            const selector = String(line || '').trim();
            if (!selector || seen.has(selector)) {
                continue;
            }
            seen.add(selector);
            selectors.push(selector);
        }

        return { success: true, value: selectors };
    }

    function readProviderDialogData() {
        const originalId = String(elements.tempEmailProviderOriginalId?.value || '').trim();
        const name = String(elements.tempEmailProviderName?.value || '').trim();
        const url = String(elements.tempEmailProviderUrl?.value || '').trim();
        const closePopupsResult = parseSelectorListTextarea(elements.tempEmailProviderClosePopups?.value || '');

        if (!name) {
            return { success: false, error: '请填写站点名称' };
        }
        if (!url) {
            return { success: false, error: '请填写站点网址' };
        }

        return {
            success: true,
            provider: {
                originalId,
                name,
                url,
                closePopupSelectors: closePopupsResult.value,
                emailElement: String(elements.tempEmailProviderEmailElement?.value || '').trim(),
                refreshButton: String(elements.tempEmailProviderRefreshButton?.value || '').trim(),
                codeClickElement: String(elements.tempEmailProviderCodeClickElement?.value || '').trim(),
                codeElement: String(elements.tempEmailProviderCodeElement?.value || '').trim()
            }
        };
    }

    function applyState(payload = {}) {
        if (typeof payload.selectedMode === 'string') {
            state.selectedMode = payload.selectedMode === 'outlook'
                ? 'outlook'
                : payload.selectedMode === 'temp'
                ? 'temp'
                : payload.selectedMode === 'api'
                    ? 'api'
                    : 'tcp';
        }
        if (Array.isArray(payload.providers)) {
            state.providers = payload.providers.map((provider) => ({ ...provider }));
        }
        if (typeof payload.selectedProviderId === 'string') {
            state.selectedProviderId = payload.selectedProviderId;
        }
        if (typeof payload.selectedProviderName === 'string') {
            state.selectedProviderName = payload.selectedProviderName;
        }
        if (payload.provider && typeof payload.provider === 'object') {
            state.selectedProviderId = String(payload.provider.id || state.selectedProviderId || '').trim();
            state.selectedProviderName = String(payload.provider.name || payload.provider.id || state.selectedProviderName || '').trim();
            if (payload.browserOpen === true && typeof payload.provider.url === 'string') {
                state.currentUrl = payload.provider.url;
            }
        }
        if (typeof payload.browserOpen === 'boolean') {
            state.browserOpen = payload.browserOpen;
        }
        if (payload.browserId !== undefined) {
            state.browserId = String(payload.browserId || '');
        }
        if (typeof payload.url === 'string') {
            state.currentUrl = payload.url;
        }
        if (typeof payload.email === 'string') {
            const nextEmail = String(payload.email || '').trim();
            if (nextEmail && nextEmail !== state.currentEmail) {
                state.selectedEmailId = '';
                state.currentSelection = '';
            }
            state.currentEmail = nextEmail;
            state.selectedEmailAddress = nextEmail;
            if (elements.emailApiGeneratedEmail) {
                setResultCard(elements.emailApiGeneratedEmail, nextEmail || '尚未生成邮箱', nextEmail ? 'success' : 'idle');
            }
        }
        if (typeof payload.emailId === 'string') {
            state.selectedEmailId = payload.emailId;
        }
        if (typeof payload.code === 'string') {
            state.currentCode = payload.code;
        }
        if (typeof payload.selection === 'string') {
            state.currentSelection = payload.selection;
        }
        if (payload.apiConfig && typeof payload.apiConfig === 'object') {
            state.apiConfig = mergeApiConfig(payload.apiConfig);
        }
        if (Array.isArray(payload.outlookAccounts)) {
            state.outlookAccounts = mergeOutlookAccounts([], payload.outlookAccounts);
        }
        if (typeof payload.selectedOutlookAccountId === 'string') {
            state.selectedOutlookAccountId = payload.selectedOutlookAccountId.trim();
        }
        if (payload.outlookContentMap && typeof payload.outlookContentMap === 'object') {
            state.outlookContentMap = { ...state.outlookContentMap, ...payload.outlookContentMap };
        }

        const provider = state.providers.find((item) => item.id === state.selectedProviderId) || null;
        state.selectedProviderName = provider ? provider.name || provider.id : state.selectedProviderName;

        syncModeUi();
        renderProviderList();
        renderOutlookAccounts();
        syncApiActionButtons();
        updateInfoUi();
    }

    async function loadConfig() {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailLoadConfig);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '读取临时邮箱配置失败');
            }

            const config = result.config || {};
            state.providers = Array.isArray(config.providers) ? config.providers : [];
            state.selectedMode = config.selectedMode === 'outlook'
                ? 'outlook'
                : config.selectedMode === 'temp'
                ? 'temp'
                : config.selectedMode === 'api'
                    ? 'api'
                    : 'tcp';
            state.selectedProviderId = String(config.selectedProviderId || '').trim();
            state.selectedProviderName = state.providers.find((item) => item.id === state.selectedProviderId)?.name
                || state.providers[0]?.name
                || '';
            applyState(result.state || config.state || {});
            setOutlookAccounts(config.outlookAccounts || []);
            syncApiUi(config.apiConfig || result.state?.apiConfig || DEFAULT_GPTMAIL_API_CONFIG);
            loadOutlookState();
            renderOutlookAccounts();
            appendTempEmailLog(`已加载临时邮箱配置: ${state.providers.length} 个卡片`, '#6c757d');
            return result;
        } catch (error) {
            logger.error(`加载临时邮箱配置失败: ${error.message}`);
            appendTempEmailLog(`加载临时邮箱配置失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function saveProviderFromDialog() {
        const built = readProviderDialogData();
        if (!built.success) {
            utils.showMessage(built.error, 'warning', elements);
            return built;
        }

        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailSaveProvider, built.provider);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '保存临时邮箱站点失败');
            }

            closeProviderDialog();
            await loadConfig();
            appendTempEmailLog(`已保存临时邮箱站点: ${result.provider?.name || built.provider.name}`, '#198754');
            return result;
        } catch (error) {
            logger.error(`保存临时邮箱站点失败: ${error.message}`);
            appendTempEmailLog(`保存临时邮箱站点失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function importProviders() {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailImportProviders);
            if (!result || result.success !== true) {
                if (result?.cancelled) {
                    return result;
                }
                throw new Error(result?.error || '导入临时邮箱站点失败');
            }

            await loadConfig();
            appendTempEmailLog(`已导入 ${result.count || 0} 个临时邮箱站点`, '#198754');
            return result;
        } catch (error) {
            logger.error(`导入临时邮箱站点失败: ${error.message}`);
            appendTempEmailLog(`导入临时邮箱站点失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function deleteSelectedProvider() {
        if (!state.selectedProviderId) {
            utils.showMessage('请先选择一个临时邮箱卡片', 'warning', elements);
            return { success: false, error: '请选择一个临时邮箱卡片' };
        }

        const provider = state.providers.find((item) => item.id === state.selectedProviderId) || null;
        const providerName = provider?.name || state.selectedProviderId;
        const confirmed = await utils.showConfirmDialog(
            `确认删除临时邮箱站点「${providerName}」吗？`,
            { title: '删除临时邮箱站点' },
            elements
        );
        if (!confirmed) {
            return { success: false, cancelled: true };
        }

        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailDeleteProvider, state.selectedProviderId);
            if (!result || result.success !== true) {
                throw new Error(result?.error || '删除临时邮箱站点失败');
            }

            await loadConfig();
            appendTempEmailLog(`已删除临时邮箱站点: ${providerName}`, '#6c757d');
            return result;
        } catch (error) {
            logger.error(`删除临时邮箱站点失败: ${error.message}`);
            appendTempEmailLog(`删除临时邮箱站点失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function setMode(mode) {
        const normalizedMode = mode === 'outlook'
            ? 'outlook'
            : mode === 'temp'
                ? 'temp'
                : mode === 'api'
                    ? 'api'
                    : 'tcp';
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailSetMode, { mode: normalizedMode });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '设置临时邮箱模式失败');
            }
            state.selectedMode = normalizedMode;
            applyState(result.state || {});
            appendTempEmailLog(
                `已切换到${normalizedMode === 'temp' ? '临时邮箱' : normalizedMode === 'api' ? 'API连接' : 'TCP邮箱'}模式`,
                '#0d6efd'
            );
            return result;
        } catch (error) {
            logger.error(`切换临时邮箱模式失败: ${error.message}`);
            appendTempEmailLog(`切换临时邮箱模式失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function openOutlookMode() {
        return setMode('outlook');
    }

    async function openApiMode() {
        return setMode('api');
    }

    async function selectProvider(providerId) {
        const nextId = String(providerId || '').trim();
        if (!nextId) {
            return { success: false, error: '请选择一个临时邮箱卡片' };
        }

        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailSetProvider, { providerId: nextId });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '设置临时邮箱卡片失败');
            }

            state.selectedProviderId = nextId;
            state.selectedMode = 'temp';
            applyState(result.state || {});
            appendTempEmailLog(`已选择临时邮箱卡片: ${state.selectedProviderName || nextId}`, '#6c757d');
            return result;
        } catch (error) {
            logger.error(`选择临时邮箱卡片失败: ${error.message}`);
            appendTempEmailLog(`选择临时邮箱卡片失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function openCurrentProvider() {
        if (!state.selectedProviderId) {
            utils.showMessage('请先选择一个临时邮箱卡片', 'warning', elements);
            return { success: false, error: '请选择一个临时邮箱卡片' };
        }

        await setMode('temp');
        try {
            appendTempEmailLog(`正在打开临时邮箱卡片: ${state.selectedProviderName || state.selectedProviderId}`, '#0d6efd');
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailOpenProvider, {
                browserType: getEffectiveTempEmailBrowserType(),
                providerId: state.selectedProviderId
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '打开临时邮箱浏览器失败');
            }
            applyState(result.state || result);
            appendTempEmailLog(`临时邮箱浏览器已打开: ${result.url || state.currentUrl || '-'}`, '#198754');
            return result;
        } catch (error) {
            logger.error(`打开临时邮箱浏览器失败: ${error.message}`);
            appendTempEmailLog(`打开临时邮箱浏览器失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function refreshEmail() {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailRefreshEmail, {
                providerId: state.selectedProviderId
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '刷新邮箱失败');
            }
            applyState(result.state || result);
            appendTempEmailLog('临时邮箱已刷新', '#0d6efd');
            return result;
        } catch (error) {
            logger.error(`刷新临时邮箱失败: ${error.message}`);
            appendTempEmailLog(`刷新临时邮箱失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function getEmail() {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailGetEmail, {
                providerId: state.selectedProviderId
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '获取邮箱失败');
            }
            applyState(result.state || result);
            appendTempEmailLog(`已获取临时邮箱: ${result.email}`, '#198754');
            return result;
        } catch (error) {
            logger.error(`获取临时邮箱失败: ${error.message}`);
            appendTempEmailLog(`获取临时邮箱失败: ${error.message}`, '#dc3545');
            return { success: false, error: error.message };
        }
    }

    async function getCode() {
        try {
            const result = await ipcRenderer.invoke(IPC_CHANNELS.tempEmailGetCode, {
                providerId: state.selectedProviderId
            });
            if (!result || result.success !== true) {
                throw new Error(result?.error || '获取验证码失败');
            }
            applyState(result.state || result);
        appendTempEmailLog(`已获取临时邮箱验证码: ${result.code}`, '#198754');
        return result;
    } catch (error) {
        logger.error(`获取临时邮箱验证码失败: ${error.message}`);
        appendTempEmailLog(`获取临时邮箱验证码失败: ${error.message}`, '#dc3545');
        return { success: false, error: error.message };
    }
}

    function setupTempEmailPanel() {
        if (elements.tempEmailAddBtn) {
            elements.tempEmailAddBtn.addEventListener('click', () => {
                openProviderDialog(null);
            });
        }
        if (elements.tempEmailImportBtn) {
            elements.tempEmailImportBtn.addEventListener('click', () => {
                void importProviders();
            });
        }
        if (elements.tempEmailEditBtn) {
            elements.tempEmailEditBtn.addEventListener('click', () => {
                const provider = state.providers.find((item) => item.id === state.selectedProviderId) || null;
                if (!provider) {
                    utils.showMessage('请先选择一个临时邮箱卡片', 'warning', elements);
                    return;
                }
                openProviderDialog(provider);
            });
        }
        if (elements.tempEmailDeleteBtn) {
            elements.tempEmailDeleteBtn.addEventListener('click', () => {
                void deleteSelectedProvider();
            });
        }
        if (elements.tempEmailOpenBtn) {
            elements.tempEmailOpenBtn.addEventListener('click', () => {
                void openCurrentProvider();
            });
        }
        if (elements.tempEmailRefreshEmailBtn) {
            elements.tempEmailRefreshEmailBtn.addEventListener('click', () => {
                void refreshEmail();
            });
        }
        if (elements.tempEmailProviderDebugBtn) {
            elements.tempEmailProviderDebugBtn.addEventListener('click', () => {
                void openCurrentProvider();
            });
        }
        if (elements.tempEmailGetEmailBtn) {
            elements.tempEmailGetEmailBtn.addEventListener('click', () => {
                void getEmail();
            });
        }
        if (elements.tempEmailGetCodeBtn) {
            elements.tempEmailGetCodeBtn.addEventListener('click', () => {
                void getCode();
            });
        }
        if (elements.tempEmailProviderDialogCloseBtn) {
            elements.tempEmailProviderDialogCloseBtn.addEventListener('click', () => {
                closeProviderDialog();
            });
        }
        if (elements.tempEmailProviderCancelBtn) {
            elements.tempEmailProviderCancelBtn.addEventListener('click', () => {
                closeProviderDialog();
            });
        }
        if (elements.tempEmailProviderSaveBtn) {
            elements.tempEmailProviderSaveBtn.addEventListener('click', () => {
                void saveProviderFromDialog();
            });
        }
        if (elements.tempEmailProviderForm) {
            elements.tempEmailProviderForm.addEventListener('submit', (event) => {
                event.preventDefault();
                void saveProviderFromDialog();
            });
        }
        if (elements.outlookEmailImportBtn) {
            elements.outlookEmailImportBtn.addEventListener('click', openOutlookImportDialog);
        }
        if (elements.outlookEmailClearBtn) {
            elements.outlookEmailClearBtn.addEventListener('click', clearOutlookAccounts);
        }
        if (elements.outlookEmailImportCloseBtn) {
            elements.outlookEmailImportCloseBtn.addEventListener('click', closeOutlookImportDialog);
        }
        if (elements.outlookEmailImportCancelBtn) {
            elements.outlookEmailImportCancelBtn.addEventListener('click', closeOutlookImportDialog);
        }
        if (elements.outlookEmailImportConfirmBtn) {
            elements.outlookEmailImportConfirmBtn.addEventListener('click', () => {
                void importOutlookAccountsFromDialog();
            });
        }
        if (elements.outlookEmailImportDialog) {
            elements.outlookEmailImportDialog.addEventListener('click', (event) => {
                if (event.target === elements.outlookEmailImportDialog) {
                    closeOutlookImportDialog();
                }
            });
        }
        void loadConfig().then((result) => {
            if (result && result.success) {
                const mode = state.selectedMode === 'outlook'
                    ? 'outlook'
                    : state.selectedMode === 'temp'
                        ? 'temp'
                        : state.selectedMode === 'api'
                            ? 'api'
                            : 'connect';
                void utils.activateEmailMode(mode, elements, utils.appendEmailLog, utils.updateEmailStatus);
            }
        });
    }

    function updateFromExternalState(payload = {}) {
        applyState(payload);
    }

    return {
        setupTempEmailPanel,
        loadConfig,
        setMode,
        openOutlookMode,
        selectProvider,
        openCurrentProvider,
        refreshEmail,
        getEmail,
        getCode,
        openApiMode,
        generateEmail,
        listEmails,
        getEmailDetail,
        copyGeneratedEmail,
        importOutlookAccountsFromText,
        importOutlookAccountsFromDialog,
        clearOutlookAccounts,
        fetchOutlookContent,
        deleteEmail,
        clearEmails,
        getApiConfig,
        setApiConfig,
        appendTempEmailLog,
        updateFromExternalState,
        applyState,
        state
    };
};
