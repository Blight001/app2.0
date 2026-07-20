function resolveImportedCardCandidates(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.cards)) return parsed.cards;
    if (Array.isArray(parsed?.items)) return parsed.items.map((item) => item?.cardData || item);
    return [parsed?.cardData || parsed];
}

export function parseImportedCardText(rawText = '', sourceName = '粘贴导入') {
    const text = String(rawText || '').trim();
    if (!text) throw new Error('请输入卡片流程数据');
    let parsed;
    try { parsed = JSON.parse(text); } catch (_error) { throw new Error('卡片流程数据不是有效的 JSON'); }
    const candidates = resolveImportedCardCandidates(parsed);
    const validCandidates = candidates.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    if (validCandidates.length === 0) throw new Error('未识别到自动化卡片数据');
    const normalizeCardData = globalThis.CookieCaptureAutomationWorkbench?.normalizeCardData;
    if (typeof normalizeCardData !== 'function') throw new Error('自动化卡片工作台尚未就绪');
    return validCandidates.map((cardData, index) => {
        const fallbackName = validCandidates.length === 1 ? sourceName : `${sourceName}#${index + 1}`;
        const normalized = normalizeCardData(cardData, fallbackName, { allowEmptySteps: true });
        Object.defineProperty(normalized, '__importSourceName', { value: sourceName, enumerable: false, configurable: true });
        return normalized;
    });
}
