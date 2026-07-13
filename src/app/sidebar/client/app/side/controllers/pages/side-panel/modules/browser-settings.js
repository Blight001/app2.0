(function initAiFreeBrowserSettingsModule() {
  let loaded = false;
  let current = {};
  const el = (id) => document.getElementById(id);
  const value = (id, fallback = '') => el(id)?.value ?? fallback;
  const checked = (id) => el(id)?.checked === true;
  const setValue = (id, next) => { if (el(id)) el(id).value = next ?? ''; };
  const setChecked = (id, next) => { if (el(id)) el(id).checked = next === true; };
  const number = (id, fallback = 0) => Number.isFinite(Number(value(id))) ? Number(value(id)) : fallback;
  const randomItem = (items) => items[Math.floor(Math.random() * items.length)];
  const randomSeed = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
  const readPath = (source, path) => path.split('.').reduce((result, key) => result?.[key], source);
  const writePath = (source, path, next) => {
    const keys = path.split('.'); let target = source;
    keys.slice(0, -1).forEach((key) => { target[key] ||= {}; target = target[key]; });
    target[keys.at(-1)] = next;
  };

  function setStatus(message, type = '') {
    const target = el('ai-free-settings-status'); if (!target) return;
    target.textContent = String(message || '');
    target.classList.toggle('is-error', type === 'error');
    target.classList.toggle('is-success', type === 'success');
  }

  function setSegment(path, next) {
    document.querySelectorAll(`.segmented[data-field="${path}"] button`).forEach((button) => {
      button.classList.toggle('active', button.dataset.value === String(next));
    });
    writePath(current, path, next === 'true' ? true : next === 'false' ? false : next);
    syncConditionalFields();
  }

  function getSegment(path, fallback = '') {
    return document.querySelector(`.segmented[data-field="${path}"] button.active`)?.dataset.value ?? fallback;
  }

  function syncConditionalFields() {
    if (el('custom-proxy-fields')) el('custom-proxy-fields').hidden = getSegment('proxy.mode') !== 'custom';
    if (el('homepage-url')) el('homepage-url').hidden = getSegment('homepage.mode') !== 'custom';
    if (el('browser-user-agent')) el('browser-user-agent').disabled = getSegment('ua.mode') !== 'custom';
    if (el('sec-ch-ua-brands')) el('sec-ch-ua-brands').hidden = getSegment('secChUa.mode') !== 'custom';
    if (el('browser-locale')) el('browser-locale').hidden = checked('language-by-ip');
    if (el('browser-timezone')) el('browser-timezone').hidden = checked('timezone-by-ip');
    if (el('custom-geolocation')) el('custom-geolocation').hidden = checked('geolocation-by-ip') || getSegment('geolocation.permission') === 'block';
    if (el('custom-resolution')) el('custom-resolution').hidden = getSegment('resolution.mode') !== 'custom';
    if (el('webgl-metadata-fields')) el('webgl-metadata-fields').hidden = getSegment('webglMetadata.mode') !== 'custom';
    if (el('launch-args')) el('launch-args').hidden = getSegment('launchArgs.mode') !== 'custom';
  }

  function fillVersions(runtimeInfo = {}, settings = {}) {
    const major = Number(String(runtimeInfo.chromiumVersion || '').split('.')[0]) || 147;
    const browserSelect = el('browser-version');
    if (browserSelect && browserSelect.options.length <= 1) {
      Array.from(new Set([major + 2, major + 1, major, major - 1, major - 2, 147].filter((item) => item > 80)))
        .sort((a, b) => b - a).forEach((item) => browserSelect.add(new Option(String(item), String(item))));
    }
    const kernelSelect = el('kernel-version');
    if (kernelSelect && runtimeInfo.chromiumVersion && kernelSelect.options.length <= 1) {
      kernelSelect.add(new Option(`当前内核 ${runtimeInfo.chromiumVersion}`, runtimeInfo.chromiumVersion));
    }
    setValue('browser-version', settings.browserVersion || '');
    setValue('kernel-version', settings.kernelVersion || 'auto');
  }

  function fillForm(settings, runtimeInfo = {}) {
    current = JSON.parse(JSON.stringify(settings || {}));
    ['os','proxy.mode','homepage.mode','ua.mode','secChUa.mode','webrtc.mode','geolocation.permission','resolution.mode','fonts.mode','canvas.mode','webglImage.mode','webglMetadata.mode','webgpu.mode','audioContext.mode','clientRects.mode','speechVoices.mode','deviceName.mode','macAddress.mode','sslEnabled','portScanProtection.enabled','launchArgs.mode']
      .forEach((path) => setSegment(path, readPath(current, path)));
    fillVersions(runtimeInfo, current);
    setValue('proxy-protocol', current.proxy?.protocol); setValue('proxy-host', current.proxy?.host); setValue('proxy-port', current.proxy?.port);
    setValue('proxy-username', current.proxy?.username); setValue('proxy-password', current.proxy?.password); setValue('proxy-api-url', current.proxy?.apiUrl);
    setValue('browser-cookies', current.cookies || '[]'); setValue('homepage-url', current.homepage?.url);
    setValue('browser-user-agent', current.ua?.value); setValue('sec-ch-ua-brands', JSON.stringify(current.secChUa?.brands || [], null, 2));
    setChecked('language-by-ip', current.language?.mode === 'ip'); setValue('browser-locale', current.language?.value);
    setChecked('timezone-by-ip', current.timezone?.mode === 'ip'); setValue('browser-timezone', current.timezone?.value);
    setChecked('geolocation-by-ip', current.geolocation?.mode === 'ip'); setValue('geo-longitude', current.geolocation?.longitude); setValue('geo-latitude', current.geolocation?.latitude); setValue('geo-accuracy', current.geolocation?.accuracy);
    setValue('resolution-width', current.resolution?.width); setValue('resolution-height', current.resolution?.height);
    setValue('browser-webgl-vendor', current.webglMetadata?.vendor); setValue('browser-webgl-renderer', current.webglMetadata?.renderer);
    setValue('browser-cpu', current.cpu); setValue('browser-memory', current.memory); setValue('device-name', current.deviceName?.value); setValue('mac-address', current.macAddress?.value);
    setChecked('do-not-track', current.doNotTrack); setValue('port-scan-allow-list', (current.portScanProtection?.allowList || []).join(',')); setChecked('hardware-acceleration', current.hardwareAcceleration);
    setValue('launch-args', current.launchArgs?.value); syncConditionalFields();
  }

  function collectForm() {
    let brands = []; try { brands = JSON.parse(value('sec-ch-ua-brands', '[]')); } catch (_) { brands = []; }
    const setting = {
      ...current, os: getSegment('os', 'win11'), browserVersion: value('browser-version'), kernelVersion: value('kernel-version', 'auto'),
      proxy: { mode: getSegment('proxy.mode','default'), protocol: value('proxy-protocol','http'), host: value('proxy-host'), port: value('proxy-port'), username: value('proxy-username'), password: value('proxy-password'), apiUrl: value('proxy-api-url') },
      cookies: value('browser-cookies','[]'), homepage: { mode: getSegment('homepage.mode','default'), url: value('homepage-url') },
      ua: { mode: getSegment('ua.mode','default'), value: value('browser-user-agent') }, secChUa: { mode: getSegment('secChUa.mode','default'), brands },
      language: { mode: checked('language-by-ip') ? 'ip' : 'custom', value: value('browser-locale') }, timezone: { mode: checked('timezone-by-ip') ? 'ip' : 'custom', value: value('browser-timezone') },
      webrtc: { mode: getSegment('webrtc.mode','replace') }, geolocation: { permission: getSegment('geolocation.permission','ask'), mode: checked('geolocation-by-ip') ? 'ip' : 'custom', longitude: number('geo-longitude'), latitude: number('geo-latitude'), accuracy: number('geo-accuracy',100) },
      resolution: { mode: getSegment('resolution.mode','follow'), width: number('resolution-width',1366), height: number('resolution-height',768) },
      fonts: { mode: getSegment('fonts.mode','system'), seed: current.fonts?.seed }, canvas: { mode: getSegment('canvas.mode','noise'), seed: current.canvas?.seed },
      webglImage: { mode: getSegment('webglImage.mode','noise'), seed: current.webglImage?.seed }, webglMetadata: { mode: getSegment('webglMetadata.mode','custom'), vendor: value('browser-webgl-vendor'), renderer: value('browser-webgl-renderer') },
      webgpu: { mode: getSegment('webgpu.mode','webgl') }, audioContext: { mode: getSegment('audioContext.mode','noise'), seed: current.audioContext?.seed }, clientRects: { mode: getSegment('clientRects.mode','noise'), seed: current.clientRects?.seed }, speechVoices: { mode: getSegment('speechVoices.mode','noise'), seed: current.speechVoices?.seed },
      cpu: number('browser-cpu',8), memory: number('browser-memory',8), deviceName: { mode: getSegment('deviceName.mode','default'), value: value('device-name') }, macAddress: { mode: getSegment('macAddress.mode','default'), value: value('mac-address') },
      doNotTrack: checked('do-not-track'), sslEnabled: getSegment('sslEnabled') === 'true', portScanProtection: { enabled: getSegment('portScanProtection.enabled') === 'true', allowList: value('port-scan-allow-list').split(/[\s,;]+/).filter(Boolean) }, hardwareAcceleration: checked('hardware-acceleration'), launchArgs: { mode: getSegment('launchArgs.mode','default'), value: value('launch-args') },
    };
    return setting;
  }

  function validateSettings(setting) {
    let cookies;
    try { cookies = JSON.parse(String(setting.cookies || '[]')); } catch (_) { throw new Error('Cookie 必须是有效的 JSON 数组'); }
    if (!Array.isArray(cookies)) throw new Error('Cookie 顶层必须是数组');
    if (setting.secChUa?.mode === 'custom') {
      try { if (!Array.isArray(JSON.parse(value('sec-ch-ua-brands', '[]')))) throw new Error(); } catch (_) { throw new Error('Sec-CH-UA 必须是有效的 JSON 数组'); }
    }
    if (setting.proxy?.mode === 'custom' && (!setting.proxy.host || !Number(setting.proxy.port))) throw new Error('自定义代理需要填写主机和端口');
    if (setting.ua?.mode === 'custom' && !String(setting.ua.value || '').trim()) throw new Error('自定义 User Agent 不能为空');
    if (setting.homepage?.mode === 'custom') {
      try { const parsed = new URL(setting.homepage.url); if (!/^https?:$/.test(parsed.protocol)) throw new Error(); } catch (_) { throw new Error('启动主页必须是有效的 HTTP/HTTPS 地址'); }
    }
    if (setting.macAddress?.mode === 'custom' && !/^([0-9A-F]{2}[-:]){5}[0-9A-F]{2}$/i.test(setting.macAddress.value || '')) throw new Error('MAC 地址格式不正确');
  }

  function randomIdentity() {
    const os = randomItem(['win10','win11']); const version = randomItem([145,146,147,148,149,150]);
    setSegment('os', os); setValue('browser-version', version); setSegment('ua.mode','custom');
    setSegment('secChUa.mode','custom'); setSegment('webglMetadata.mode','custom'); setSegment('deviceName.mode','custom'); setSegment('macAddress.mode','custom');
    setValue('browser-user-agent', `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version}.0.0.0 Safari/537.36`);
    setValue('sec-ch-ua-brands', JSON.stringify([{brand:'Chromium',version:String(version)},{brand:'Google Chrome',version:String(version)},{brand:'Not_A Brand',version:'24'}], null, 2));
    const gpu = randomItem([['Google Inc. (Intel)','ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'],['Google Inc. (NVIDIA)','ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Direct3D11 vs_5_0 ps_5_0, D3D11)'],['Google Inc. (AMD)','ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)']]);
    setValue('browser-webgl-vendor',gpu[0]); setValue('browser-webgl-renderer',gpu[1]); setValue('browser-cpu',randomItem([4,6,8,12,16])); setValue('browser-memory',randomItem([4,8,16,32]));
    ['fonts','canvas','webglImage','audioContext','clientRects','speechVoices'].forEach((key) => { current[key] ||= {}; current[key].seed = randomSeed(); });
    setValue('device-name', `DESKTOP-${Math.random().toString(36).slice(2,9).toUpperCase()}`); setValue('mac-address', Array.from({length:6},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('-').toUpperCase());
    setStatus('已生成一组匹配的系统、UA、硬件与噪声种子。');
  }

  async function loadSettings(force = false) {
    if (loaded && !force) return; setStatus('正在读取本地参数…');
    try { const response = await window.electronAPI.invoke('get-ai-free-browser-settings'); if (!response?.ok) throw new Error(response?.error || '读取参数失败'); fillForm(response.settings,response.runtimeInfo); el('ai-free-settings-runtime').textContent = response.activeTab ? `当前环境：${response.activeTab.title} · ${response.activeTab.runtimeType === 'chromium' ? 'Chromium Fork（内核项需重启）' : 'Electron BrowserView（页面指纹可即时应用）'}` : '当前没有浏览器环境；保存后作为新环境默认配置。'; loaded = true; setStatus('参数已从本机载入'); } catch (error) { setStatus(error?.message || String(error),'error'); }
  }

  async function saveSettings(event) {
    event?.preventDefault?.(); const button=el('save-ai-free-settings'); if(button)button.disabled=true; setStatus('正在保存并应用…');
    try { const settings=collectForm();validateSettings(settings);const response=await window.electronAPI.invoke('set-ai-free-browser-settings',{settings,applyToActive:checked('apply-settings-to-active'),restartChromium:checked('restart-chromium-settings')}); if(!response?.ok)throw new Error(response?.error||'保存失败'); fillForm(response.settings,response.runtimeInfo); const result=response.activeResult; setStatus(result?.restarted?'已保存并重启 Chromium 环境。':result?.restartRequired?'已保存并应用页面参数；部分内核项需重启后生效。':result?.applied?'已保存并应用到当前环境。':'已保存为默认环境配置。','success'); } catch(error){setStatus(error?.message||String(error),'error');} finally{if(button)button.disabled=false;}
  }

  async function resetSettings(){try{const response=await window.electronAPI.invoke('reset-ai-free-browser-settings',{applyToActive:checked('apply-settings-to-active'),restartChromium:checked('restart-chromium-settings')});if(response?.ok){fillForm(response.settings,response.runtimeInfo);setStatus('已恢复默认配置。','success');}else throw new Error(response?.error||'恢复默认失败');}catch(error){setStatus(error?.message||String(error),'error');}}
  async function testProxy(){setStatus('正在检测代理…');const response=await window.electronAPI.invoke('test-ai-free-proxy',{proxy:collectForm().proxy});setStatus(response?.ok?`代理可用：${response.ip||'连接成功'}（${response.elapsedMs||0}ms）`:response?.error||'代理不可用',response?.ok?'success':'error');}
  async function extractProxy(){const response=await window.electronAPI.invoke('extract-ai-free-proxy',{apiUrl:value('proxy-api-url')});if(response?.ok){setValue('proxy-protocol',response.proxy.protocol);setValue('proxy-host',response.proxy.host);setValue('proxy-port',response.proxy.port);setValue('proxy-username',response.proxy.username);setValue('proxy-password',response.proxy.password);setStatus('已从 API 提取代理。','success');}else setStatus(response?.error||'提取代理失败','error');}

  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('.segmented').forEach((group)=>group.addEventListener('click',(event)=>{const button=event.target.closest('button[data-value]');if(button)setSegment(group.dataset.field,button.dataset.value);}));
    ['language-by-ip','timezone-by-ip','geolocation-by-ip'].forEach((id)=>el(id)?.addEventListener('change',syncConditionalFields));
    el('ai-free-settings-form')?.addEventListener('submit',saveSettings); el('randomize-ai-free-settings')?.addEventListener('click',randomIdentity); el('randomize-user-agent')?.addEventListener('click',randomIdentity); el('reset-ai-free-settings')?.addEventListener('click',()=>void resetSettings());
    el('test-ai-free-proxy')?.addEventListener('click',()=>void testProxy()); el('extract-ai-free-proxy')?.addEventListener('click',()=>void extractProxy());
    document.querySelectorAll('[data-random-target]').forEach((button)=>button.addEventListener('click',()=>{if(button.dataset.randomTarget==='device-name')setValue('device-name',`DESKTOP-${Math.random().toString(36).slice(2,9).toUpperCase()}`);else setValue('mac-address',Array.from({length:6},()=>Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join('-').toUpperCase());}));
    document.querySelector('[data-tab="ai-free-settings-panel"]')?.addEventListener('click',()=>void loadSettings());
  });
}());
