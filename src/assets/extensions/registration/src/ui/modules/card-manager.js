/**
 * 卡片管理模块
 * 处理卡片的加载、渲染、编辑、删除等功能
 */

const { ipcRenderer } = require('electron');
const { logger } = require('../console.js');
const {
    filterRegistrationCards,
    isAllowedRegistrationCardName
} = require('../../core/registration/registration-ui-state');

// 全局状态
let currentCard = null;
let currentTestCard = null;
let currentHaikaBindCard = null;
let cardControlMode = 'local';
let registrationCardAccessMode = 'restricted';
const loadedCardModes = new Set();
const loadingCardModes = new Map();
const DEFAULT_MIN_COOKIE_SIZE_BYTES = 8192;
const DEFAULT_UPLOAD_TARGET_SCORE_SCOPE = 'all';

function normalizeCardMode(cardMode = 'register') {
    return cardMode === 'test' || cardMode === 'haikaBind' ? cardMode : 'register';
}

function normalizeCardControlMode(mode = 'local') {
    const normalized = String(mode || '').trim().toLowerCase();
    return normalized === 'tcp' || normalized === 'remote' ? 'remote' : 'local';
}

function setCardControlMode(mode = 'local') {
    cardControlMode = normalizeCardControlMode(mode);
}

function getCardControlMode() {
    return cardControlMode;
}

function isRemoteCardControlMode() {
    return cardControlMode === 'remote';
}

function setRegistrationCardAccessMode(mode = 'restricted') {
    const normalized = String(mode || '').trim().toLowerCase();
    registrationCardAccessMode = normalized === 'all' || normalized === 'unrestricted' ? 'all' : 'restricted';
}

function canUseAnyRegistrationCard() {
    return registrationCardAccessMode === 'all';
}

function getRemoteCardControlMessage(cardMode = 'register') {
    const modeConfig = getCardModeConfig(cardMode);
    return `服务器控制状态下${modeConfig.label}卡片由服务器接管`;
}

function resolveCardMinCookieSizeBytes(cardData) {
    const candidates = [
        cardData?.min_cookie_size_bytes,
        cardData?.minCookieSizeBytes,
        cardData?.min_cookie_size,
        cardData?.minCookieSize
    ];

    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === '') {
            continue;
        }

        const parsed = parseInt(candidate, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
    }

    return DEFAULT_MIN_COOKIE_SIZE_BYTES;
}

function normalizeMinCookieSizeInput(rawValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return DEFAULT_MIN_COOKIE_SIZE_BYTES;
    }

    const parsed = parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return DEFAULT_MIN_COOKIE_SIZE_BYTES;
    }

    return parsed;
}

function normalizeUploadTargetScoreScope(rawValue) {
    const normalized = String(rawValue || '').trim().toLowerCase();
    if (!normalized) {
        return DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
    }

    if (normalized === 'custom' || normalized === 'single' || normalized === 'specific' || normalized === 'specified') {
        return 'custom';
    }

    return DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
}

function parseUploadTargetScoreTypes(rawValue) {
    const rawList = Array.isArray(rawValue)
        ? rawValue
        : String(rawValue || '').split(/[\n,，;；]+/);

    const normalizedList = [];
    const seen = new Set();

    rawList.forEach(item => {
        const value = String(item || '').trim();
        if (!value || seen.has(value)) {
            return;
        }

        seen.add(value);
        normalizedList.push(value);
    });

    return normalizedList;
}

function resolveUploadTargetScoreConfig(cardData = {}) {
    const uploadConfig = cardData && typeof cardData.upload === 'object' ? cardData.upload : {};
    const rawScope = cardData?.upload_target_score_scope
        ?? cardData?.uploadTargetScoreScope
        ?? uploadConfig.target_score_scope
        ?? uploadConfig.targetScoreScope;
    const rawTypes = cardData?.upload_target_score_types
        ?? cardData?.uploadTargetScoreTypes
        ?? uploadConfig.target_score_types
        ?? uploadConfig.targetScoreTypes
        ?? cardData?.upload_target_score_type
        ?? cardData?.uploadTargetScoreType
        ?? uploadConfig.target_score_type
        ?? uploadConfig.targetScoreType;

    const parsedTypes = parseUploadTargetScoreTypes(rawTypes);
    const hasExplicitScope = rawScope !== undefined && rawScope !== null && String(rawScope).trim() !== '';
    let scope = normalizeUploadTargetScoreScope(rawScope);
    if (!hasExplicitScope && parsedTypes.length > 0) {
        scope = 'custom';
    }

    if (scope !== 'custom') {
        return {
            scope: DEFAULT_UPLOAD_TARGET_SCORE_SCOPE,
            types: []
        };
    }

    return {
        scope: 'custom',
        types: parsedTypes
    };
}

function setUploadTargetScoreControlsVisibility(elements) {
    if (!elements) {
        return;
    }

    const scope = elements.cardUploadTargetScoreScope
        ? normalizeUploadTargetScoreScope(elements.cardUploadTargetScoreScope.value)
        : DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
    const isCustom = scope === 'custom';

    if (elements.cardUploadTargetScoreTypesGroup) {
        elements.cardUploadTargetScoreTypesGroup.style.display = isCustom ? '' : 'none';
    }
    if (elements.cardUploadTargetScoreTypes) {
        elements.cardUploadTargetScoreTypes.disabled = !isCustom;
    }
}

function getCardModeConfig(cardMode = 'register') {
    const mode = normalizeCardMode(cardMode);
    const modeConfig = {
        register: {
            mode: 'register',
            label: '注册',
            listSelector: '#card-list .card-item',
            itemSelector: name => `#card-list [data-card-name="${name}"]`,
            listElementKey: 'cardList',
            loadEvent: 'cards-loaded',
            loadChannel: 'load-cards',
            importChannel: 'import-card',
            saveChannel: 'save-card',
            getChannel: 'get-card',
            deleteChannel: 'delete-card',
            setChannel: 'set-current-card'
        },
        test: {
            mode: 'test',
            label: '测试',
            listSelector: '#test-card-list .card-item',
            itemSelector: name => `#test-card-list [data-card-name="${name}"]`,
            listElementKey: 'testCardList',
            loadEvent: 'test-cards-loaded',
            loadChannel: 'load-test-cards',
            importChannel: 'import-test-card',
            saveChannel: 'save-test-card',
            getChannel: 'get-test-card',
            deleteChannel: 'delete-test-card',
            setChannel: 'set-current-test-card'
        },
        haikaBind: {
            mode: 'haikaBind',
            label: '海卡绑定',
            listSelector: '#haika-bind-card-list .card-item',
            itemSelector: name => `#haika-bind-card-list [data-card-name="${name}"]`,
            listElementKey: 'haikaBindCardList',
            loadEvent: 'haika-bind-cards-loaded',
            loadChannel: 'load-haika-bind-cards',
            importChannel: 'import-haika-bind-card',
            saveChannel: 'save-haika-bind-card',
            getChannel: 'get-haika-bind-card',
            deleteChannel: 'delete-haika-bind-card',
            setChannel: 'set-current-haika-bind-card'
        }
    };

    return modeConfig[mode];
}

function getCurrentCardByMode(cardMode = 'register') {
    if (cardMode === 'test') return currentTestCard;
    if (cardMode === 'haikaBind') return currentHaikaBindCard;
    return currentCard;
}

function isCardModeLoaded(cardMode = 'register') {
    return loadedCardModes.has(normalizeCardMode(cardMode));
}

function markCardModeLoaded(cardMode = 'register', loaded = true) {
    const mode = normalizeCardMode(cardMode);
    if (loaded) {
        loadedCardModes.add(mode);
        return;
    }

    loadedCardModes.delete(mode);
}

function renderDeferredLoadPlaceholder(elements, cardMode = 'register', message = '') {
    const modeConfig = getCardModeConfig(cardMode);
    const listElement = elements && elements[modeConfig.listElementKey];
    if (!listElement) {
        return;
    }

    const placeholderMessage = message || (
        isRemoteCardControlMode()
            ? getRemoteCardControlMessage(cardMode)
            : `卡片未自动加载，点击这里加载${modeConfig.label}卡片`
    );
    listElement.innerHTML = `
        <div class="no-cards card-load-placeholder" data-card-load-mode="${modeConfig.mode}">
            ${placeholderMessage}
        </div>
    `;
}

async function ensureCardsLoaded(cardMode = 'register', options = {}) {
    const mode = normalizeCardMode(cardMode);
    const forceReload = Boolean(options && options.forceReload);
    const allowLocalLoadInRemoteMode = Boolean(options && options.allowLocalLoadInRemoteMode);

    if (isRemoteCardControlMode() && !allowLocalLoadInRemoteMode) {
        return [];
    }

    if (!forceReload && isCardModeLoaded(mode)) {
        return [];
    }

    if (!forceReload && loadingCardModes.has(mode)) {
        return loadingCardModes.get(mode);
    }

    let loader = loadCards;
    if (mode === 'test') {
        loader = loadTestCards;
    } else if (mode === 'haikaBind') {
        loader = loadHaikaBindCards;
    }

    const loadingPromise = Promise.resolve(loader({ forceReload }))
        .finally(() => {
            loadingCardModes.delete(mode);
        });

    loadingCardModes.set(mode, loadingPromise);
    return loadingPromise;
}

function setCurrentCardByMode(cardName, cardMode = 'register') {
    if (cardMode === 'test') {
        currentTestCard = cardName;
        return;
    }
    if (cardMode === 'haikaBind') {
        currentHaikaBindCard = cardName;
        return;
    }
    currentCard = cardName;
}

/**
 * 加载卡片列表
 */
async function loadCards(options = {}) {
    try {
        const allowLocalLoadInRemoteMode = Boolean(options && options.allowLocalLoadInRemoteMode);
        if (isRemoteCardControlMode() && !allowLocalLoadInRemoteMode) {
            markCardModeLoaded('register', false);
            return [];
        }

        const result = await ipcRenderer.invoke('load-cards', options);
        if (result.success) {
            markCardModeLoaded('register', true);
            setRegistrationCardAccessMode(result.allowAllRegistrationCards === true ? 'all' : 'restricted');
            result.cards = canUseAnyRegistrationCard()
                ? (Array.isArray(result.cards) ? result.cards : [])
                : filterRegistrationCards(result.cards, 'register');
            // 通过全局事件通知渲染进程更新卡片列表
            // elements 和 onCardChange 由 renderer.js 中的事件监听器处理
            window.dispatchEvent(new CustomEvent('cards-loaded', { detail: result.cards }));
            return result.cards;
        } else {
            markCardModeLoaded('register', false);
            logger.error(`加载卡片失败: ${result.error}`);
        }
    } catch (error) {
        markCardModeLoaded('register', false);
        logger.error(`加载卡片异常: ${error.message}`);
    }

    return [];
}

/**
 * 加载测试卡片列表
 */
async function loadTestCards(options = {}) {
    try {
        const allowLocalLoadInRemoteMode = Boolean(options && options.allowLocalLoadInRemoteMode);
        if (isRemoteCardControlMode() && !allowLocalLoadInRemoteMode) {
            markCardModeLoaded('test', false);
            return [];
        }

        const result = await ipcRenderer.invoke('load-test-cards', options);
        if (result.success) {
            markCardModeLoaded('test', true);
            window.dispatchEvent(new CustomEvent('test-cards-loaded', { detail: result.cards }));
            return result.cards;
        } else {
            markCardModeLoaded('test', false);
            logger.error(`加载测试卡片失败: ${result.error}`);
        }
    } catch (error) {
        markCardModeLoaded('test', false);
        logger.error(`加载测试卡片异常: ${error.message}`);
    }

    return [];
}

/**
 * 加载海卡绑定卡片列表
 */
async function loadHaikaBindCards(options = {}) {
    try {
        const allowLocalLoadInRemoteMode = Boolean(options && options.allowLocalLoadInRemoteMode);
        if (isRemoteCardControlMode() && !allowLocalLoadInRemoteMode) {
            markCardModeLoaded('haikaBind', false);
            return [];
        }

        const result = await ipcRenderer.invoke('load-haika-bind-cards', options);
        if (result.success) {
            markCardModeLoaded('haikaBind', true);
            window.dispatchEvent(new CustomEvent('haika-bind-cards-loaded', { detail: result.cards }));
            return result.cards;
        } else {
            markCardModeLoaded('haikaBind', false);
            logger.error(`加载海卡绑定卡片失败: ${result.error}`);
        }
    } catch (error) {
        markCardModeLoaded('haikaBind', false);
        logger.error(`加载海卡绑定卡片异常: ${error.message}`);
    }

    return [];
}

/**
 * 渲染卡片列表
 * @param {Array} cards - 卡片数据数组
 * @param {Object} elements - DOM元素对象
 * @param {Function} onCardChange - 卡片变化回调（用于刷新Cookie列表等）
 * @param {string} cardMode - 卡片类型: register | test | haikaBind
 */
function renderCardList(cards, elements, onCardChange, cardMode = 'register') {
    const modeConfig = getCardModeConfig(cardMode);
    const listElement = elements[modeConfig.listElementKey];
    if (!elements || !listElement) return;

    const displayCards = cardMode === 'register'
        ? (canUseAnyRegistrationCard() ? (Array.isArray(cards) ? cards : []) : filterRegistrationCards(cards, cardMode))
        : (Array.isArray(cards) ? cards : []);

    markCardModeLoaded(cardMode, true);
    listElement.innerHTML = '';

    if (displayCards.length === 0) {
        listElement.innerHTML = `<div class="no-cards">暂无${modeConfig.label}卡片</div>`;
        return;
    }

    displayCards.forEach(card => {
        const cardElement = document.createElement('div');
        cardElement.className = 'card-item';
        cardElement.dataset.cardName = card.name;

        cardElement.innerHTML = `
            <div class="card-name">${card.name}</div>
            <div class="card-description">${card.description || '无描述'}</div>
        `;

        cardElement.addEventListener('click', () => selectCard(card.name, elements, (name) => {
            setCurrentCardByMode(name, cardMode);
        }, onCardChange, cardMode));
        listElement.appendChild(cardElement);
    });

    const selectedCardName = String(getCurrentCardByMode(cardMode) || '').trim();
    if (selectedCardName) {
        const selectedElement = Array.from(listElement.querySelectorAll('.card-item'))
            .find(item => item && item.dataset && item.dataset.cardName === selectedCardName);
        if (selectedElement) {
            selectedElement.classList.add('selected');
        } else if (cardMode === 'register' && displayCards.length === 1 && (canUseAnyRegistrationCard() || isAllowedRegistrationCardName(displayCards[0]?.name))) {
            selectCard(displayCards[0].name, elements, (name) => {
                setCurrentCardByMode(name, cardMode);
            }, onCardChange, cardMode);
        }
    } else if (cardMode === 'register' && displayCards.length === 1 && (canUseAnyRegistrationCard() || isAllowedRegistrationCardName(displayCards[0]?.name))) {
        selectCard(displayCards[0].name, elements, (name) => {
            setCurrentCardByMode(name, cardMode);
        }, onCardChange, cardMode);
    }
}

/**
 * 选择卡片
 * @param {string} cardName - 卡片名称
 * @param {Object} elements - DOM元素对象
 * @param {Function} onSelect - 选择回调函数
 * @param {Function} onCardChange - 卡片变化回调（用于刷新Cookie列表等）
 * @param {string} cardMode - 卡片类型: register | test | haikaBind
 */
function selectCard(cardName, elements, onSelect, onCardChange, cardMode = 'register') {
    const modeConfig = getCardModeConfig(cardMode);
    if (isRemoteCardControlMode()) {
        logger.info(getRemoteCardControlMessage(cardMode));
        return;
    }

    if (cardMode === 'register' && !canUseAnyRegistrationCard() && !isAllowedRegistrationCardName(cardName)) {
        logger.info('注册卡片页面仅允许使用国际版即梦注册卡片');
        return;
    }

    const listSelector = modeConfig.listSelector;
    const itemSelector = modeConfig.itemSelector(cardName);

    // 清除之前的选择
    document.querySelectorAll(listSelector).forEach(item => {
        item.classList.remove('selected');
    });

    // 选择新的卡片
    const selectedCard = document.querySelector(itemSelector);
    if (selectedCard) {
        selectedCard.classList.add('selected');
        
        setCurrentCardByMode(cardName, cardMode);
        logger.info(`选择${modeConfig.label}卡片: ${cardName}`);

        if (modeConfig.setChannel) {
            ipcRenderer.invoke(modeConfig.setChannel, cardName).catch(error => {
                logger.error(`设置当前${modeConfig.label}卡片失败: ${error.message}`);
            });
        }

        if (cardMode === 'register' && elements.startBtn) {
            elements.startBtn.disabled = false;
            elements.statusLabel.textContent = `已选择卡片: ${cardName}`;
        }

        if (onSelect) {
            onSelect(cardName);
        }

        // 触发卡片变化回调（用于刷新Cookie列表等）
        if (onCardChange) {
            onCardChange(cardName);
        }
    }
}

/**
 * 获取当前选中的卡片
 */
function getCurrentCard() {
    return currentCard;
}

/**
 * 获取当前选中的测试卡片
 */
function getCurrentTestCard() {
    return currentTestCard;
}

/**
 * 获取当前选中的海卡绑定卡片
 */
function getCurrentHaikaBindCard() {
    return currentHaikaBindCard;
}

/**
 * 设置当前卡片（从外部设置）
 */
function setCurrentCard(cardName) {
    currentCard = cardName;
}

/**
 * 设置当前测试卡片（从外部设置）
 */
function setCurrentTestCard(cardName) {
    currentTestCard = cardName;
}

/**
 * 设置当前海卡绑定卡片（从外部设置）
 */
function setCurrentHaikaBindCard(cardName) {
    currentHaikaBindCard = cardName;
}

/**
 * 显示卡片对话框
 */
function showCardDialog(cardData, elements, toggleCharsetField, cardMode = 'register') {
    // 重置表单
    elements.cardForm.reset();
    if (elements.cardDebugStepPause) {
        elements.cardDebugStepPause.checked = true;
    }
    delete elements.cardDialog.dataset.originalCardName;
    
    // 标记当前卡片类型
    elements.cardDialog.dataset.cardMode = cardMode;
    const modeConfig = getCardModeConfig(cardMode);

    if (cardData) {
        // 编辑模式
        elements.dialogTitle.textContent = `编辑${modeConfig.label}卡片`;
        elements.cardDialog.dataset.originalCardName = cardData.name || '';
        elements.cardName.value = cardData.name || '';
        elements.cardWebsite.value = cardData.website || '';
        elements.cardDescription.value = cardData.description || '';
        elements.cardEmail.value = cardData.email || '';
        elements.cardPassword.value = cardData.password || '';
        elements.cardPoints.value = cardData.points || 0;
        if (elements.cardMinCookieSize) {
            elements.cardMinCookieSize.value = cardData
                ? resolveCardMinCookieSizeBytes(cardData)
                : DEFAULT_MIN_COOKIE_SIZE_BYTES;
        }

        // 加载random配置
        if (cardData.random) {
            if (cardData.random.email) {
                elements.emailRandomLength.value = cardData.random.email.length || 8;
                elements.emailRandomType.value = cardData.random.email.type || 'lowercase';
                elements.emailRandomCharset.value = cardData.random.email.charset || '';
            } else {
                elements.emailRandomLength.value = 8;
                elements.emailRandomType.value = 'lowercase';
                elements.emailRandomCharset.value = '';
            }

            if (cardData.random.password) {
                elements.passwordRandomLength.value = cardData.random.password.length || 12;
                elements.passwordRandomType.value = cardData.random.password.type || 'mixed';
                elements.passwordRandomCharset.value = cardData.random.password.charset || '';
            } else {
                elements.passwordRandomLength.value = 12;
                elements.passwordRandomType.value = 'mixed';
                elements.passwordRandomCharset.value = '';
            }
        } else {
            // 默认值
            elements.emailRandomLength.value = 8;
            elements.emailRandomType.value = 'lowercase';
            elements.emailRandomCharset.value = '';
            elements.passwordRandomLength.value = 12;
            elements.passwordRandomType.value = 'mixed';
            elements.passwordRandomCharset.value = '';
        }

        // 初始化字符集字段显示状态
        toggleCharsetField('email');
        toggleCharsetField('password');

        // 加载 popups - 直接显示JSON
        if (cardData.popups) {
            elements.cardPopupsTextarea.value = JSON.stringify(cardData.popups, null, 2);
        } else {
            elements.cardPopupsTextarea.value = '[]';
        }

        // 加载步骤 - 直接显示JSON
        if (cardData.steps) {
            elements.cardStepsTextarea.value = JSON.stringify(cardData.steps, null, 2);
        } else {
            elements.cardStepsTextarea.value = '[]';
        }
    } else {
        // 添加模式
        elements.dialogTitle.textContent = `添加${modeConfig.label}卡片`;
        elements.cardPopupsTextarea.value = '[]';
        elements.cardStepsTextarea.value = '[]';
    }

    if (elements.cardMinCookieSizeGroup) {
        const isRegisterMode = cardMode === 'register';
        elements.cardMinCookieSizeGroup.style.display = isRegisterMode ? '' : 'none';
    }
    if (elements.cardUploadTargetScoreScope || elements.cardUploadTargetScoreTypesGroup) {
        const isRegisterMode = cardMode === 'register';
        if (isRegisterMode) {
            const uploadTargetScoreConfig = resolveUploadTargetScoreConfig(cardData || {});
            if (elements.cardUploadTargetScoreScope) {
                elements.cardUploadTargetScoreScope.value = uploadTargetScoreConfig.scope;
            }
            if (elements.cardUploadTargetScoreTypes) {
                elements.cardUploadTargetScoreTypes.value = uploadTargetScoreConfig.types.join('\n');
            }
        } else {
            if (elements.cardUploadTargetScoreScope) {
                elements.cardUploadTargetScoreScope.value = DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
            }
            if (elements.cardUploadTargetScoreTypes) {
                elements.cardUploadTargetScoreTypes.value = '';
            }
        }
        setUploadTargetScoreControlsVisibility(elements);
    }

    if (elements.cardMinCookieSize && !cardData) {
        elements.cardMinCookieSize.value = String(DEFAULT_MIN_COOKIE_SIZE_BYTES);
    }
    if (cardMode !== 'register' && elements.cardMinCookieSize) {
        elements.cardMinCookieSize.value = '0';
    }
    if (cardMode === 'register') {
        const uploadConfig = cardData && typeof cardData === 'object'
            ? (cardData.upload && typeof cardData.upload === 'object' ? cardData.upload : {})
            : {};
        const uploadServerUrl = cardData?.upload_server_url || cardData?.uploadServerUrl || uploadConfig.server_url || uploadConfig.serverUrl || '';
        const uploadCardKey = cardData?.upload_card_key || cardData?.uploadCardKey || cardData?.card_key || uploadConfig.card_key || uploadConfig.cardKey || '';

        if (elements.registrationUploadServerUrl) {
            elements.registrationUploadServerUrl.value = uploadServerUrl;
        }
        if (elements.registrationUploadCardKey) {
            elements.registrationUploadCardKey.value = uploadCardKey;
        }
        if (elements.registrationAutoUpload) {
            elements.registrationAutoUpload.checked = cardData?.registration_auto_upload === undefined
                ? true
                : Boolean(cardData.registration_auto_upload);
        }
        if (elements.cardUploadTargetScoreScope || elements.cardUploadTargetScoreTypesGroup) {
            const uploadTargetScoreConfig = resolveUploadTargetScoreConfig(cardData || {});
            if (elements.cardUploadTargetScoreScope) {
                elements.cardUploadTargetScoreScope.value = uploadTargetScoreConfig.scope;
            }
            if (elements.cardUploadTargetScoreTypes) {
                elements.cardUploadTargetScoreTypes.value = uploadTargetScoreConfig.types.join('\n');
            }
            setUploadTargetScoreControlsVisibility(elements);
        }
    } else {
        if (elements.registrationUploadServerUrl) {
            elements.registrationUploadServerUrl.value = '';
        }
        if (elements.registrationUploadCardKey) {
            elements.registrationUploadCardKey.value = '';
        }
        if (elements.registrationAutoUpload) {
            elements.registrationAutoUpload.checked = true;
        }
        if (elements.cardUploadTargetScoreScope) {
            elements.cardUploadTargetScoreScope.value = DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
        }
        if (elements.cardUploadTargetScoreTypes) {
            elements.cardUploadTargetScoreTypes.value = '';
        }
        setUploadTargetScoreControlsVisibility(elements);
    }

    elements.cardDialog.style.display = 'flex';
}

/**
 * 隐藏卡片对话框
 */
function hideCardDialog(elements) {
    elements.cardDialog.style.display = 'none';
    delete elements.cardDialog.dataset.cardMode;
    delete elements.cardDialog.dataset.originalCardName;
}

function getBrowserConfigForMode(elements, cardMode = 'register', browserSettingsPatch = {}) {
    const browserType = elements.browserType && elements.browserType.value ? elements.browserType.value : 'electron';
    const headlessElement = elements.headlessMode;
    const dynamicFingerprint = elements.browserDynamicFingerprint ? elements.browserDynamicFingerprint.checked : true;
    const activeBrowserSettingsPatch = browserSettingsPatch && typeof browserSettingsPatch === 'object'
        ? browserSettingsPatch
        : {};

    return {
        browserType,
        browserSettings: {
            browser_type: browserType,
            browser_source: elements.browserSource ? String(elements.browserSource.value || '').trim() : 'local-browser',
            browser_display_mode: elements.browserDisplayMode && elements.browserDisplayMode.checked ? 'embedded' : 'window',
            headless: headlessElement ? !!headlessElement.checked : true,
            region: elements.browserRegion ? String(elements.browserRegion.value || '').trim() : '',
            locale: elements.browserLocale ? String(elements.browserLocale.value || '').trim() : '',
            timezone_id: elements.browserTimezoneId ? String(elements.browserTimezoneId.value || '').trim() : '',
            dynamic_fingerprint: dynamicFingerprint,
            block_images_videos: elements.browserBlockImagesVideos ? elements.browserBlockImagesVideos.checked : false,
            ...activeBrowserSettingsPatch
        }
    };
}

function buildCardDataFromForm(elements) {
    const cardMode = elements.cardDialog.dataset.cardMode || 'register';
    const originalCardName = String(elements.cardDialog.dataset.originalCardName || '').trim();
    const uploadTargetScoreScope = elements.cardUploadTargetScoreScope
        ? normalizeUploadTargetScoreScope(elements.cardUploadTargetScoreScope.value)
        : DEFAULT_UPLOAD_TARGET_SCORE_SCOPE;
    const uploadTargetScoreTypes = uploadTargetScoreScope === 'custom'
        ? parseUploadTargetScoreTypes(elements.cardUploadTargetScoreTypes ? elements.cardUploadTargetScoreTypes.value : '')
        : [];

    if (cardMode === 'register' && uploadTargetScoreScope === 'custom' && uploadTargetScoreTypes.length === 0) {
        return { success: false, error: '请填写目标积分账号/类型，或将目标积分类型改为“默认所有积分账号”' };
    }

    const cardData = {
        name: elements.cardName.value.trim(),
        website: elements.cardWebsite.value.trim(),
        description: elements.cardDescription.value.trim(),
        email: elements.cardEmail.value.trim(),
        password: elements.cardPassword.value.trim(),
        points: parseInt(elements.cardPoints.value) || 0,
        random: {
            email: {
                length: parseInt(elements.emailRandomLength.value) || 8,
                type: elements.emailRandomType.value || 'lowercase',
                charset: elements.emailRandomType.value === 'custom' ? elements.emailRandomCharset.value.trim() : undefined
            },
            password: {
                length: parseInt(elements.passwordRandomLength.value) || 12,
                type: elements.passwordRandomType.value || 'mixed',
                charset: elements.passwordRandomType.value === 'custom' ? elements.passwordRandomCharset.value.trim() : undefined
            }
        },
        steps: [],
        popups: []
    };

    if (cardMode === 'register') {
        const uploadServerUrl = elements.registrationUploadServerUrl ? elements.registrationUploadServerUrl.value.trim() : '';
        const uploadCardKey = elements.registrationUploadCardKey ? elements.registrationUploadCardKey.value.trim() : '';
        const registrationAutoUpload = elements.registrationAutoUpload ? elements.registrationAutoUpload.checked === true : true;
        const minCookieSizeBytes = elements.cardMinCookieSize
            ? normalizeMinCookieSizeInput(elements.cardMinCookieSize.value)
            : DEFAULT_MIN_COOKIE_SIZE_BYTES;
        const resolvedUploadTargetScoreTypes = uploadTargetScoreScope === 'custom' ? uploadTargetScoreTypes : [];
        cardData.upload_server_url = uploadServerUrl;
        cardData.upload_card_key = uploadCardKey;
        cardData.registration_auto_upload = registrationAutoUpload;
        cardData.min_cookie_size_bytes = minCookieSizeBytes;
        cardData.upload_target_score_scope = uploadTargetScoreScope;
        cardData.upload_target_score_types = resolvedUploadTargetScoreTypes;
        cardData.upload_target_score_type = resolvedUploadTargetScoreTypes[0] || '';
        cardData.upload = {
            server_url: uploadServerUrl,
            card_key: uploadCardKey,
            registration_auto_upload: registrationAutoUpload,
            target_score_scope: uploadTargetScoreScope,
            target_score_types: resolvedUploadTargetScoreTypes,
            target_score_type: resolvedUploadTargetScoreTypes[0] || ''
        };
    }

    try {
        const popupsJson = elements.cardPopupsTextarea.value.trim();
        cardData.popups = popupsJson ? JSON.parse(popupsJson) : [];
    } catch (error) {
        return { success: false, error: `弹窗规则JSON格式错误: ${error.message}` };
    }

    try {
        const stepsJson = elements.cardStepsTextarea.value.trim();
        cardData.steps = stepsJson ? JSON.parse(stepsJson) : [];
    } catch (error) {
        return { success: false, error: `步骤JSON格式错误: ${error.message}` };
    }

    if (!cardData.name) {
        return { success: false, error: '请输入卡片名称' };
    }

    if (originalCardName) {
        cardData.original_name = originalCardName;
    }

    return { success: true, cardData };
}

/**
 * 保存卡片
 */
async function saveCard(elements, showMessage, loadCardsFn, loadTestCardsFn = loadCardsFn, loadHaikaBindCardsFn = loadCardsFn) {
    try {
        const cardMode = elements.cardDialog.dataset.cardMode || 'register';
        if (isRemoteCardControlMode()) {
            showMessage(getRemoteCardControlMessage(cardMode), 'info');
            return;
        }

        const modeConfig = getCardModeConfig(cardMode);
        const built = buildCardDataFromForm(elements);
        if (!built.success) {
            showMessage(built.error, 'error');
            return;
        }

        const channel = modeConfig.saveChannel;
        const result = await ipcRenderer.invoke(channel, built.cardData);
        
        if (result.success) {
            hideCardDialog(elements);
            // 重新加载对应的卡片列表
            if (cardMode === 'test') {
                loadTestCardsFn();
            } else if (cardMode === 'haikaBind') {
                loadHaikaBindCardsFn();
            } else {
                loadCardsFn();
            }
            showMessage(`${modeConfig.label}卡片保存成功`, 'success');
        } else {
            showMessage(`保存失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showMessage(`保存异常: ${error.message}`, 'error');
    }
}

async function debugCard(elements, showMessage, getBrowserSettingsPatchFn = null) {
    try {
        const cardMode = elements.cardDialog.dataset.cardMode || 'register';
        const built = buildCardDataFromForm(elements);
        if (!built.success) {
            showMessage(built.error, 'error');
            return;
        }

        const browserSettingsPatch = typeof getBrowserSettingsPatchFn === 'function'
            ? getBrowserSettingsPatchFn() || {}
            : {};
        const browserConfig = getBrowserConfigForMode(elements, cardMode, browserSettingsPatch);
        const pauseEachStep = elements.cardDebugStepPause ? elements.cardDebugStepPause.checked : true;
        const result = await ipcRenderer.invoke('debug-card', {
            cardMode,
            cardData: built.cardData,
            browserType: browserConfig.browserType,
            browserSettings: browserConfig.browserSettings,
            pauseEachStep
        });

        if (result && result.success) {
            showMessage('调试任务已启动，浏览器会保持打开', 'success');
        } else {
            showMessage(`调试启动失败: ${result && result.error ? result.error : '未知错误'}`, 'error');
        }
    } catch (error) {
        showMessage(`调试启动异常: ${error.message}`, 'error');
    }
}

/**
 * 导入卡片
 */
async function importCard(showMessage, loadCardsFn, cardMode = 'register', loadTestCardsFn = loadCardsFn, loadHaikaBindCardsFn = loadCardsFn) {
    try {
        if (isRemoteCardControlMode()) {
            showMessage(getRemoteCardControlMessage(cardMode), 'info');
            return;
        }

        const modeConfig = getCardModeConfig(cardMode);
        const channel = modeConfig.importChannel;
        const result = await ipcRenderer.invoke(channel);
        
        if (result.success) {
            if (cardMode === 'test') {
                loadTestCardsFn();
            } else if (cardMode === 'haikaBind') {
                loadHaikaBindCardsFn();
            } else {
                loadCardsFn();
            }
            showMessage(`${modeConfig.label}卡片导入成功`, 'success');
        } else if (result.cancelled) {
            // 用户取消，不做任何操作
        } else {
            showMessage(`导入失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showMessage(`导入异常: ${error.message}`, 'error');
    }
}

/**
 * 编辑选中的卡片
 */
async function editSelectedCard(showMessage, selectedCardName, cardMode = 'register') {
    if (isRemoteCardControlMode()) {
        showMessage(getRemoteCardControlMessage(cardMode), 'info');
        return null;
    }

    const modeConfig = getCardModeConfig(cardMode);
    if (!selectedCardName) {
        showMessage(`请先选择一个${modeConfig.label}卡片`, 'error');
        return null;
    }

    try {
        const channel = modeConfig.getChannel;
        const result = await ipcRenderer.invoke(channel, selectedCardName);
        if (result.success) {
            return result.card;
        } else {
            showMessage(`获取卡片数据失败: ${result.error}`, 'error');
            return null;
        }
    } catch (error) {
        showMessage(`获取卡片数据异常: ${error.message}`, 'error');
        return null;
    }
}

/**
 * 删除选中的卡片
 */
async function deleteSelectedCard(elements, showMessage, loadCardsFn, selectedCardName, setCurrentCardFn, cardMode = 'register', loadTestCardsFn = loadCardsFn, loadHaikaBindCardsFn = loadCardsFn) {
    if (isRemoteCardControlMode()) {
        showMessage(getRemoteCardControlMessage(cardMode), 'info');
        return;
    }

    const modeConfig = getCardModeConfig(cardMode);
    if (!selectedCardName) {
        showMessage(`请先选择一个${modeConfig.label}卡片`, 'error');
        return;
    }

    try {
        const channel = modeConfig.deleteChannel;
        const result = await ipcRenderer.invoke(channel, selectedCardName);
        
        if (result.success) {
            setCurrentCardFn(null);
            
            if (cardMode === 'register' && elements.startBtn) {
                elements.startBtn.disabled = true;
                elements.statusLabel.textContent = '未选择卡片';
            }
            
            if (cardMode === 'test') {
                loadTestCardsFn();
            } else if (cardMode === 'haikaBind') {
                loadHaikaBindCardsFn();
            } else {
                loadCardsFn();
            }
            showMessage(`${modeConfig.label}卡片删除成功`, 'success');

            // 通知主进程清除当前卡片
            const setChannel = modeConfig.setChannel;
            ipcRenderer.invoke(setChannel, null).catch(error => {
                logger.error(`清除当前${modeConfig.label}卡片失败: ${error.message}`);
            });
        } else {
            showMessage(`删除失败: ${result.error}`, 'error');
        }
    } catch (error) {
        showMessage(`删除异常: ${error.message}`, 'error');
    }
}

async function ensureCardModeLoadedForAction(cardMode, loadCardsFn, loadTestCardsFn = loadCardsFn, loadHaikaBindCardsFn = loadCardsFn) {
    if (isRemoteCardControlMode()) {
        return false;
    }

    if (isCardModeLoaded(cardMode)) {
        return true;
    }

    if (cardMode === 'test') {
        await loadTestCardsFn();
        return isCardModeLoaded('test');
    }

    if (cardMode === 'haikaBind') {
        await loadHaikaBindCardsFn();
        return isCardModeLoaded('haikaBind');
    }

    await loadCardsFn();
    return isCardModeLoaded('register');
}

/**
 * 设置卡片管理的DOM元素引用
 */
function setupCardEventListeners(
    elements,
    showMessage,
    hideCardDialog,
    loadCardsFn,
    toggleCharsetField,
    loadTestCardsFn = loadCardsFn,
    loadHaikaBindCardsFn = loadCardsFn,
    getBrowserSettingsPatchFn = null
) {
    const deferredLoadConfigs = [
        { listElement: elements.cardList, cardMode: 'register', loadFn: loadCardsFn },
        { listElement: elements.testCardList, cardMode: 'test', loadFn: loadTestCardsFn },
        { listElement: elements.haikaBindCardList, cardMode: 'haikaBind', loadFn: loadHaikaBindCardsFn }
    ];

    deferredLoadConfigs.forEach(({ listElement, loadFn }) => {
        if (!listElement) {
            return;
        }

        listElement.addEventListener('click', async (event) => {
            const placeholder = event.target.closest('.card-load-placeholder');
            if (!placeholder) {
                return;
            }

            if (isRemoteCardControlMode()) {
                showMessage(getRemoteCardControlMessage(placeholder.dataset.cardLoadMode || 'register'), 'info');
                return;
            }

            await loadFn();
        });
    });

    // 注册卡片管理事件
    if (elements.addCardBtn) {
        elements.addCardBtn.addEventListener('click', () => {
            if (isRemoteCardControlMode()) {
                showMessage(getRemoteCardControlMessage('register'), 'info');
                return;
            }

            showCardDialog(null, elements, toggleCharsetField, 'register');
        });
    }
    if (elements.importCardBtn) {
        elements.importCardBtn.addEventListener('click', () => importCard(showMessage, loadCardsFn, 'register', loadTestCardsFn, loadHaikaBindCardsFn));
    }
    if (elements.editCardBtn) {
        elements.editCardBtn.addEventListener('click', async () => {
            await ensureCardModeLoadedForAction('register', loadCardsFn, loadTestCardsFn, loadHaikaBindCardsFn);
            const card = await editSelectedCard(showMessage, currentCard, 'register');
            if (card) {
                showCardDialog(card, elements, toggleCharsetField, 'register');
            }
        });
    }
    if (elements.deleteCardBtn) {
        elements.deleteCardBtn.addEventListener('click', async () => {
            await ensureCardModeLoadedForAction('register', loadCardsFn, loadTestCardsFn, loadHaikaBindCardsFn);
            deleteSelectedCard(elements, showMessage, loadCardsFn, currentCard, (name) => { currentCard = name; }, 'register', loadTestCardsFn, loadHaikaBindCardsFn);
        });
    }

    // 测试卡片管理事件
    if (elements.addTestCardBtn) {
        elements.addTestCardBtn.addEventListener('click', () => {
            if (isRemoteCardControlMode()) {
                showMessage(getRemoteCardControlMessage('test'), 'info');
                return;
            }

            showCardDialog(null, elements, toggleCharsetField, 'test');
        });
    }
    if (elements.importTestCardBtn) {
        elements.importTestCardBtn.addEventListener('click', () => importCard(showMessage, loadCardsFn, 'test', loadTestCardsFn, loadHaikaBindCardsFn));
    }
    if (elements.editTestCardBtn) {
        elements.editTestCardBtn.addEventListener('click', async () => {
            await ensureCardModeLoadedForAction('test', loadCardsFn, loadTestCardsFn, loadHaikaBindCardsFn);
            const card = await editSelectedCard(showMessage, currentTestCard, 'test');
            if (card) {
                showCardDialog(card, elements, toggleCharsetField, 'test');
            }
        });
    }
    if (elements.deleteTestCardBtn) {
        elements.deleteTestCardBtn.addEventListener('click', async () => {
            await ensureCardModeLoadedForAction('test', loadCardsFn, loadTestCardsFn, loadHaikaBindCardsFn);
            deleteSelectedCard(elements, showMessage, loadCardsFn, currentTestCard, (name) => { currentTestCard = name; }, 'test', loadTestCardsFn, loadHaikaBindCardsFn);
        });
    }

    // 海卡绑定卡片管理事件
    if (elements.addHaikaBindCardBtn) {
        elements.addHaikaBindCardBtn.addEventListener('click', () => {
            if (isRemoteCardControlMode()) {
                showMessage(getRemoteCardControlMessage('haikaBind'), 'info');
                return;
            }

            showCardDialog(null, elements, toggleCharsetField, 'haikaBind');
        });
    }
    if (elements.importHaikaBindCardBtn) {
        elements.importHaikaBindCardBtn.addEventListener('click', () => importCard(showMessage, loadCardsFn, 'haikaBind', loadTestCardsFn, loadHaikaBindCardsFn));
    }
    if (elements.editHaikaBindCardBtn) {
        elements.editHaikaBindCardBtn.addEventListener('click', async () => {
            await ensureCardModeLoadedForAction('haikaBind', loadCardsFn, loadTestCardsFn, loadHaikaBindCardsFn);
            const card = await editSelectedCard(showMessage, currentHaikaBindCard, 'haikaBind');
            if (card) {
                showCardDialog(card, elements, toggleCharsetField, 'haikaBind');
            }
        });
    }
    if (elements.deleteHaikaBindCardBtn) {
        elements.deleteHaikaBindCardBtn.addEventListener('click', async () => {
            await ensureCardModeLoadedForAction('haikaBind', loadCardsFn, loadTestCardsFn, loadHaikaBindCardsFn);
            deleteSelectedCard(elements, showMessage, loadCardsFn, currentHaikaBindCard, (name) => { currentHaikaBindCard = name; }, 'haikaBind', loadTestCardsFn, loadHaikaBindCardsFn);
        });
    }

    // 对话框事件
    if (elements.closeDialogBtn) {
        elements.closeDialogBtn.addEventListener('click', () => hideCardDialog(elements));
    }
    if (elements.cancelCardBtn) {
        elements.cancelCardBtn.addEventListener('click', () => hideCardDialog(elements));
    }
    if (elements.cardForm) {
        elements.cardForm.addEventListener('submit', (event) => {
            event.preventDefault();
        });
    }
    if (elements.saveCardBtn) {
        elements.saveCardBtn.addEventListener('click', () => saveCard(elements, showMessage, loadCardsFn, loadTestCardsFn, loadHaikaBindCardsFn));
    }
    if (elements.debugCardBtn) {
        elements.debugCardBtn.addEventListener('click', () => debugCard(elements, showMessage, getBrowserSettingsPatchFn));
    }

    // Random 配置事件
    if (elements.emailRandomType) {
        elements.emailRandomType.addEventListener('change', () => toggleCharsetField('email'));
    }
    if (elements.passwordRandomType) {
        elements.passwordRandomType.addEventListener('change', () => toggleCharsetField('password'));
    }
    if (elements.cardUploadTargetScoreScope) {
        elements.cardUploadTargetScoreScope.addEventListener('change', () => setUploadTargetScoreControlsVisibility(elements));
    }
}

// 导出模块
module.exports = {
    loadCards,
    loadTestCards,
    loadHaikaBindCards,
    ensureCardsLoaded,
    isCardModeLoaded,
    setCardControlMode,
    getCardControlMode,
    isRemoteCardControlMode,
    setRegistrationCardAccessMode,
    buildCardDataFromForm,
    renderDeferredLoadPlaceholder,
    renderCardList,
    selectCard,
    getCurrentCard,
    getCurrentTestCard,
    getCurrentHaikaBindCard,
    setCurrentCard,
    setCurrentTestCard,
    setCurrentHaikaBindCard,
    showCardDialog,
    hideCardDialog,
    saveCard,
    debugCard,
    importCard,
    editSelectedCard,
    deleteSelectedCard,
    setupCardEventListeners,
    resolveUploadTargetScoreConfig
};
