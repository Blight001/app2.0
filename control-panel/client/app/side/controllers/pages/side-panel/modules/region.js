// 侧边栏 region / 路由信息解析

// 处理：collectRegionText的具体业务逻辑。
function collectRegionText(target, value) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectRegionText(target, item));
    return;
  }

  if (typeof value === 'string') {
    value.split(/[,\|;/]+/).forEach((part) => {
      const text = String(part || '').trim();
      if (text) target.push(text);
    });
    return;
  }

  if (typeof value !== 'object') {
    const text = String(value || '').trim();
    if (text) target.push(text);
  }
}

// 处理：pickFirstRegionText的具体业务逻辑。
function pickFirstRegionText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

// 格式化/规范化：normalizeRegionCandidateInfo的具体业务逻辑。
function normalizeRegionCandidateInfo(candidate) {
  if (!candidate) return null;

  if (typeof candidate === 'string') {
    const regionName = candidate.trim();
    return regionName ? {
      regionName,
      regionCode: '',
      preferredGroupName: '',
      preferredNodeName: '',
      keywords: [regionName],
    } : null;
  }

  if (typeof candidate !== 'object') return null;

  const regionName = pickFirstRegionText(
    candidate.regionInfo,
    candidate.region_info,
    candidate.regionName,
    candidate.region_name,
    candidate.region,
    candidate.area,
    candidate.areaName,
    candidate.area_name,
    candidate.country,
    candidate.countryName,
    candidate.country_name,
    candidate.zone,
    candidate.zoneName,
    candidate.zone_name,
    candidate.location,
    candidate.locationName,
    candidate.location_name,
    candidate.label,
    candidate.title,
    candidate.name,
    candidate.displayName,
    candidate.text,
    candidate.value,
  );
  const regionCode = pickFirstRegionText(
    candidate.regionCode,
    candidate.region_code,
    candidate.code,
    candidate.isoCode,
    candidate.iso_code,
    candidate.countryCode,
    candidate.country_code,
  );
  const preferredGroupName = pickFirstRegionText(
    candidate.preferredGroupName,
    candidate.preferred_group_name,
    candidate.proxyGroup,
    candidate.proxy_group,
    candidate.groupName,
    candidate.group_name,
    candidate.selectorGroup,
    candidate.selector_group,
  );
  const preferredNodeName = pickFirstRegionText(
    candidate.preferredNodeName,
    candidate.preferred_node_name,
    candidate.proxyNode,
    candidate.proxy_node,
    candidate.nodeName,
    candidate.node_name,
    candidate.node,
    candidate.proxyName,
    candidate.proxy_name,
  );

  const keywordSource = [];
  collectRegionText(keywordSource, candidate.keywords);
  collectRegionText(keywordSource, candidate.regionKeywords);
  collectRegionText(keywordSource, candidate.region_keywords);
  collectRegionText(keywordSource, candidate.searchKeywords);
  collectRegionText(keywordSource, candidate.matchKeywords);
  collectRegionText(keywordSource, candidate.match_keywords);
  collectRegionText(keywordSource, candidate.regionInfo);
  collectRegionText(keywordSource, candidate.region_info);
  collectRegionText(keywordSource, candidate.region);
  collectRegionText(keywordSource, candidate.regionData);
  collectRegionText(keywordSource, candidate.region_data);
  collectRegionText(keywordSource, regionName);
  collectRegionText(keywordSource, regionCode);
  collectRegionText(keywordSource, preferredGroupName);
  collectRegionText(keywordSource, preferredNodeName);

  const keywords = Array.from(new Set(keywordSource.filter(Boolean)));
  const displayName = regionName || regionCode || preferredGroupName || preferredNodeName || keywords[0] || '';
  if (!displayName && !regionCode && !preferredGroupName && !preferredNodeName && keywords.length === 0) {
    return null;
  }

  return {
    regionName: displayName,
    regionCode,
    preferredGroupName,
    preferredNodeName,
    keywords,
  };
}

// 处理：collectRegionCandidates的具体业务逻辑。
function collectRegionCandidates(value, target = [], seen = new Set()) {
  if (value == null) return target;
  if (Array.isArray(value)) {
    value.forEach((item) => collectRegionCandidates(item, target, seen));
    return target;
  }

  const normalized = normalizeRegionCandidateInfo(value);
  if (normalized) {
    const signature = [
      normalized.regionName,
      normalized.regionCode,
      normalized.preferredGroupName,
      normalized.preferredNodeName,
      normalized.keywords.join('|'),
    ].join('::');
    if (!seen.has(signature)) {
      seen.add(signature);
      target.push(normalized);
    }
  }

  if (value && typeof value === 'object') {
    collectRegionCandidates(value.regionCandidates, target, seen);
    collectRegionCandidates(value.region_candidates, target, seen);
    collectRegionCandidates(value.regionList, target, seen);
    collectRegionCandidates(value.region_list, target, seen);
    collectRegionCandidates(value.regions, target, seen);
    collectRegionCandidates(value.regionOptions, target, seen);
    collectRegionCandidates(value.region_options, target, seen);
  }

  return target;
}

// 格式化/规范化：normalizeRegionRoutingInfo的具体业务逻辑。
function normalizeRegionRoutingInfo(regionInfo) {
  if (!regionInfo) return null;
  const regionCandidates = collectRegionCandidates(regionInfo);
  if (regionCandidates.length === 0) {
    return null;
  }

  const primary = regionCandidates[0];
  const keywordSet = new Set();
  const regionNames = [];
  const regionCodes = [];
  const groupNames = [];
  const nodeNames = [];

  for (const candidate of regionCandidates) {
    collectRegionText(regionNames, candidate.regionName);
    collectRegionText(regionCodes, candidate.regionCode);
    collectRegionText(groupNames, candidate.preferredGroupName);
    collectRegionText(nodeNames, candidate.preferredNodeName);
    candidate.keywords.forEach((keyword) => keywordSet.add(String(keyword || '').trim()));
  }

  const uniqueRegionNames = Array.from(new Set(regionNames.filter(Boolean)));
  const uniqueRegionCodes = Array.from(new Set(regionCodes.filter(Boolean)));
  const uniqueGroupNames = Array.from(new Set(groupNames.filter(Boolean)));
  const uniqueNodeNames = Array.from(new Set(nodeNames.filter(Boolean)));
  const mergedKeywords = Array.from(keywordSet);

  const regionName = primary?.regionName || uniqueRegionNames[0] || uniqueRegionCodes[0] || uniqueGroupNames[0] || uniqueNodeNames[0] || mergedKeywords[0] || '';
  const regionCode = primary?.regionCode || (uniqueRegionCodes.length === 1 ? uniqueRegionCodes[0] : '');
  const preferredGroupName = primary?.preferredGroupName || (uniqueGroupNames.length === 1 ? uniqueGroupNames[0] : '');
  const preferredNodeName = primary?.preferredNodeName || (uniqueNodeNames.length === 1 ? uniqueNodeNames[0] : '');

  return {
    regionName,
    regionCode,
    preferredGroupName,
    preferredNodeName,
    keywords: mergedKeywords,
    regionCandidates,
  };
}
