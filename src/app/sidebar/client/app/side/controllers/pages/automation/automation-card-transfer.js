'use strict';

{
  function candidates(parsed) {
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.cards)) return parsed.cards;
    if (Array.isArray(parsed?.items)) return parsed.items.map((item) => item?.cardData || item);
    if (parsed?.cardData && typeof parsed.cardData === 'object') return [parsed.cardData];
    return [parsed];
  }

  async function importFiles(files) {
    const cards = [];
    for (const file of Array.from(files || [])) {
      const parsed = JSON.parse(await file.text());
      cards.push(...candidates(parsed).filter((card) => card && typeof card === 'object'));
    }
    if (!cards.length) throw new Error('导入文件中没有有效卡片');
    return cards;
  }

  function exportCard(card) {
    const name = String(card?.name || 'automation-card')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80);
    const blob = new Blob([`${JSON.stringify(card, null, 2)}\n`], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name || 'automation-card'}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  window.AutomationCardTransfer = Object.freeze({ exportCard, importFiles });
}
