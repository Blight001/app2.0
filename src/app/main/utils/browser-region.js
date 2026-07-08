const REGION_PRESETS = {
    cn: {
        label: '中国大陆',
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        acceptLanguage: 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    hk: {
        label: '中国香港',
        locale: 'zh-HK',
        timezoneId: 'Asia/Hong_Kong',
        acceptLanguage: 'zh-HK,zh;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    tw: {
        label: '中国台湾',
        locale: 'zh-TW',
        timezoneId: 'Asia/Taipei',
        acceptLanguage: 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    jp: {
        label: '日本',
        locale: 'ja-JP',
        timezoneId: 'Asia/Tokyo',
        acceptLanguage: 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    kr: {
        label: '韩国',
        locale: 'ko-KR',
        timezoneId: 'Asia/Seoul',
        acceptLanguage: 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    sg: {
        label: '新加坡',
        locale: 'en-SG',
        timezoneId: 'Asia/Singapore',
        acceptLanguage: 'en-SG,en;q=0.9,en-US;q=0.8'
    },
    us: {
        label: '美国',
        locale: 'en-US',
        timezoneId: 'America/New_York',
        acceptLanguage: 'en-US,en;q=0.9'
    },
    gb: {
        label: '英国',
        locale: 'en-GB',
        timezoneId: 'Europe/London',
        acceptLanguage: 'en-GB,en;q=0.9,en-US;q=0.8'
    },
    de: {
        label: '德国',
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        acceptLanguage: 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    fr: {
        label: '法国',
        locale: 'fr-FR',
        timezoneId: 'Europe/Paris',
        acceptLanguage: 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    ca: {
        label: '加拿大',
        locale: 'en-CA',
        timezoneId: 'America/Toronto',
        acceptLanguage: 'en-CA,en;q=0.9,en-US;q=0.8'
    },
    au: {
        label: '澳大利亚',
        locale: 'en-AU',
        timezoneId: 'Australia/Sydney',
        acceptLanguage: 'en-AU,en;q=0.9,en-US;q=0.8'
    },
    nl: {
        label: '荷兰',
        locale: 'nl-NL',
        timezoneId: 'Europe/Amsterdam',
        acceptLanguage: 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    in: {
        label: '印度',
        locale: 'en-IN',
        timezoneId: 'Asia/Kolkata',
        acceptLanguage: 'en-IN,en;q=0.9,en-US;q=0.8'
    },
    ru: {
        label: '俄罗斯',
        locale: 'ru-RU',
        timezoneId: 'Europe/Moscow',
        acceptLanguage: 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
    },
    th: {
        label: '泰国',
        locale: 'th-TH',
        timezoneId: 'Asia/Bangkok',
        acceptLanguage: 'th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7'
    }
};

const GENERIC_DNS_SERVERS = [
    'https://dns.google/dns-query',
    'https://cloudflare-dns.com/dns-query'
];

const CHINA_DNS_SERVERS = [
    'https://dns.alidns.com/dns-query',
    'https://doh.pub/dns-query'
];

const JAPAN_DNS_SERVERS = [
    'https://public.dns.iij.jp/dns-query'
];

const REGION_DNS_SERVERS = {
    cn: CHINA_DNS_SERVERS,
    jp: JAPAN_DNS_SERVERS
};

const NODE_REGION_PATTERNS = {
    cn: [
        /\bcn\b/,
        /\bchina\b/,
        /\bprc\b/,
        /\bmainland\b/,
        /中国/,
        /大陆/
    ],
    hk: [
        /\bhk\b/,
        /\bhong\s*kong\b/,
        /香港/
    ],
    tw: [
        /\btw\b/,
        /\btaiwan\b/,
        /\btaipei\b/,
        /台湾/,
        /臺灣/,
        /台灣/,
        /台北/
    ],
    jp: [
        /\bjp\b/,
        /\bjpn\b/,
        /\bjapan\b/,
        /\btokyo\b/,
        /\bosaka\b/,
        /\bkyoto\b/,
        /\bnagoya\b/,
        /\bhnd\b/,
        /\bnrt\b/,
        /\bosa\b/,
        /日本/,
        /東京/,
        /东京/,
        /大阪/,
        /名古屋/
    ],
    kr: [
        /\bkr\b/,
        /\bkorea\b/,
        /\bseoul\b/,
        /韩国/,
        /韓國/,
        /首尔/,
        /首爾/
    ],
    sg: [
        /\bsg\b/,
        /\bsingapore\b/,
        /新加坡/
    ],
    us: [
        /\bus\b/,
        /\busa\b/,
        /\bunited\s*states\b/,
        /\bamerica\b/,
        /\bnew\s*york\b/,
        /\blos\s*angeles\b/,
        /\bsan\s*francisco\b/,
        /\bchicago\b/,
        /美国/
    ],
    gb: [
        /\bgb\b/,
        /\buk\b/,
        /\bunited\s*kingdom\b/,
        /\bbritain\b/,
        /\blondon\b/,
        /英国/,
        /英國/
    ],
    de: [
        /\bde\b/,
        /\bgermany\b/,
        /\bberlin\b/,
        /\bfrankfurt\b/,
        /德国/,
        /德國/
    ],
    fr: [
        /\bfr\b/,
        /\bfrance\b/,
        /\bparis\b/,
        /法国/,
        /法國/
    ],
    ca: [
        /\bca\b/,
        /\bcanada\b/,
        /\btoronto\b/,
        /\bmontreal\b/,
        /\bvancouver\b/
    ],
    au: [
        /\bau\b/,
        /\baustralia\b/,
        /\bsydney\b/,
        /\bmelbourne\b/,
        /澳大利亚/,
        /澳洲/
    ],
    nl: [
        /\bnl\b/,
        /\bnetherlands\b/,
        /\bamsterdam\b/,
        /荷兰/,
        /荷蘭/
    ],
    in: [
        /\bin\b/,
        /\bindia\b/,
        /\bmumbai\b/,
        /\bdelhi\b/,
        /印度/
    ],
    ru: [
        /\bru\b/,
        /\brussia\b/,
        /\bmoscow\b/,
        /俄罗斯/,
        /俄羅斯/
    ],
    th: [
        /\bth\b/,
        /\bthailand\b/,
        /\bbangkok\b/,
        /泰国/,
        /泰國/
    ]
};

// 格式化/规范化：normalizeBrowserRegionKey的具体业务逻辑。
function normalizeBrowserRegionKey(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

// 获取/读取/解析：getBrowserRegionPreset的具体业务逻辑。
function getBrowserRegionPreset(region) {
    const key = normalizeBrowserRegionKey(region);
    if (!key || key === 'auto' || key === 'system') {
        return null;
    }

    const preset = REGION_PRESETS[key];
    if (!preset) {
        return null;
    }

    return {
        key,
        ...preset
    };
}

// 获取/读取/解析：getBrowserRegionOptions的具体业务逻辑。
function getBrowserRegionOptions() {
    return [
        { value: '', label: '自动/系统' },
        ...Object.entries(REGION_PRESETS).map(([value, preset]) => ({
            value,
            label: preset.label
        }))
    ];
}

// 处理：inferBrowserRegionKeyFromLocale的具体业务逻辑。
function inferBrowserRegionKeyFromLocale(locale) {
    const raw = String(locale || '').trim().replace('_', '-').toLowerCase();
    if (!raw) {
        return null;
    }

    const [language, territory = ''] = raw.split('-');
    const normalizedTerritory = territory.toUpperCase();

    switch (language) {
        case 'zh':
            if (normalizedTerritory === 'HK') return 'hk';
            if (normalizedTerritory === 'TW') return 'tw';
            return 'cn';
        case 'ja':
            return 'jp';
        case 'ko':
            return 'kr';
        case 'en':
            if (normalizedTerritory === 'SG') return 'sg';
            if (normalizedTerritory === 'GB' || normalizedTerritory === 'UK') return 'gb';
            if (normalizedTerritory === 'CA') return 'ca';
            if (normalizedTerritory === 'AU') return 'au';
            if (normalizedTerritory === 'IN') return 'in';
            return 'us';
        case 'de':
            return 'de';
        case 'fr':
            return 'fr';
        case 'nl':
            return 'nl';
        case 'ru':
            return 'ru';
        case 'th':
            return 'th';
        default:
            return null;
    }
}

// 处理：inferBrowserRegionKeyFromNodeName的具体业务逻辑。
function inferBrowserRegionKeyFromNodeName(nodeName) {
    const normalizedNodeName = String(nodeName || '')
        .trim()
        .toLowerCase()
        .replace(/[_|/\\,;:·•]+/g, ' ')
        .replace(/\s+/g, ' ');

    if (!normalizedNodeName) {
        return null;
    }

// 比较/匹配：matchesAnyPattern的具体业务逻辑。
    const matchesAnyPattern = (patterns) => Array.isArray(patterns) && patterns.some((pattern) => (
        pattern instanceof RegExp
            ? pattern.test(normalizedNodeName)
            : String(pattern || '').trim() && normalizedNodeName.includes(String(pattern).trim().toLowerCase())
    ));

    for (const [regionKey, patterns] of Object.entries(NODE_REGION_PATTERNS)) {
        if (matchesAnyPattern(patterns)) {
            return regionKey;
        }
    }

    return null;
}

// 获取/读取/解析：resolveBrowserRegionKeyFromSettings的具体业务逻辑。
function resolveBrowserRegionKeyFromSettings(settings = {}) {
    const normalizedRegion = normalizeBrowserRegionKey(
        settings.region
        || settings.browser_region
        || settings.browserRegion
        || settings.proxy_region
        || settings.proxyRegion
        || ''
    );

    if (normalizedRegion && REGION_PRESETS[normalizedRegion]) {
        return normalizedRegion;
    }

    const nodeRegion = inferBrowserRegionKeyFromNodeName(
        settings.currentNode
        || settings.current_node
        || settings.nodeName
        || settings.node_name
        || settings.clashNode
        || settings.clash_node
        || settings.proxyNode
        || settings.proxy_node
        || settings.selectedNode
        || settings.selected_node
        || ''
    );

    if (nodeRegion && REGION_PRESETS[nodeRegion]) {
        return nodeRegion;
    }

    const localeRegion = inferBrowserRegionKeyFromLocale(
        settings.locale
        || settings.browser_locale
        || settings.browserLocale
        || ''
    );

    if (localeRegion && REGION_PRESETS[localeRegion]) {
        return localeRegion;
    }

    return null;
}

// 获取/读取/解析：getBrowserRegionDnsConfig的具体业务逻辑。
function getBrowserRegionDnsConfig(regionOrSettings = {}) {
    const regionKey = typeof regionOrSettings === 'string'
        ? normalizeBrowserRegionKey(regionOrSettings)
        : resolveBrowserRegionKeyFromSettings(regionOrSettings);

    const dnsServers = REGION_DNS_SERVERS[regionKey] || GENERIC_DNS_SERVERS;

    return {
        enable: true,
        'enhanced-mode': 'fake-ip',
        'respect-rules': true,
        'use-hosts': true,
        nameserver: dnsServers,
        fallback: dnsServers
    };
}

module.exports = {
    REGION_PRESETS,
    getBrowserRegionPreset,
    inferBrowserRegionKeyFromLocale,
};
