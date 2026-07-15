# Clash Mini 代理稳定化改造规格（Phase 1：Geo/规则集本地化）

> 交接文档 · 面向实现方（另一个 AI / 工程师）。本文自足，无需其它上下文。
> 目标产物：让"网络魔法"开启后的分流变成**确定性、离线可用**，消除"很乱很不稳定"。

---

## 0. TL;DR（一句话）

当前 Clash Mini 的运行配置**在运行时依赖从 `jsdelivr.net` 拉取 Geo 数据库和 4 个规则集（`.mrs`）**。国内该 CDN 时通时断，拉取失败（日志 `pull error … EOF`）时 CN/GEO 分流规则加载不出来，流量落到被"离线兜底"改写成 `MATCH,DIRECT` 的兜底规则上 → 国外站点走直连(CN) → 表现为"开了魔法还是乱、时好时坏"。

**本次改造：把 Geo 库和规则集全部本地化随包内置，规范化阶段把配置里的远程 `geox-url` / `rule-providers` 改写成本地文件，并关闭 geo 自动更新。** 这样 mihomo 启动与分流不再需要联网拉任何东西。

**不改动**：路由策略仍为"国内直连 + 国外走节点"的分流（已与产品方确认保留）。后续版本已删除每窗口右键“直连/代理”死链路，右键菜单现提供“重启浏览器”和“清空浏览器数据”，开发版与打包版行为一致。

---

## 1. 背景与根因（证据）

- **无任何本地 Geo 库**：内置 `app2.1/resources/clash-mini/core/` 只有 `verge-mihomo.exe`；运行目录 `%APPDATA%/clash-mini/` 也没有 `geoip.metadb`/`geosite.dat`。
- **配置把 geo 指向 jsdelivr**（来自服务器下发的订阅 yaml）：
  ```
  geox-url:
    geoip:   https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat
    geosite: https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat
    mmdb:    https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/country.mmdb
  ```
- **4 个 rule-providers 也从 jsdelivr 拉**（`.mrs` 格式）：

  | provider 名 | behavior | 源路径（base = `https://testingcf.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@meta/`） |
  |---|---|---|
  | `cn_ip` | ipcidr | `geo/geoip/cn.mrs` |
  | `cn_domain` | domain | `geo/geosite/cn.mrs` |
  | `private_domain` | domain | `geo/geosite/private.mrs` |
  | `geolocation-!cn` | domain | `geo/geosite/geolocation-!cn.mrs` |

- **失败证据（运行日志）**：`[Provider] cn_ip pull error: Get "…meta-rules-dat@meta/geo/geoip/cn.mrs": EOF`，`cn_domain / private_domain / geolocation-!cn` 同样 `pull error`。
- **加载成功时分流是对的**：`geolocation-!cn) using 三毛机场[2x专线-日本-1]`（国外走节点）、`cn_domain) using DIRECT`（国内直连）。→ 说明问题纯粹是"拉不到规则数据"，不是路由逻辑本身错。
- **缺 geo 库时的退化**：`normalizeClashMiniStartupConfig`（见 §2）在检测到 geo 库缺失时，会删除 GEOIP/GEOSITE 规则，并把订阅的最终 `MATCH,<节点组>` **改写成 `MATCH,DIRECT`** → 未列入规则的国外站点全走直连。日志里 `using DIRECT` 上千次即此。

---

## 2. 涉及代码地图（改造点都在这里）

文件：`app2.1/src/app/main/ipc/register/clash-mini-core.js`

| 函数 | 作用 | 本次是否改 |
|---|---|---|
| `getClashMiniAppRoots()` / `getClashMiniCoreRoots()` / `resolveBundledClashMiniCoreDir()` | 定位内置 core 目录 | 否（读取用） |
| `prepareClashMiniRuntimeDir()` (~L120) | 把内置 core 拷到运行目录 `%APPDATA%/clash-mini`，`copyDirectoryRecursive(..., {overwrite:false})` | **改**：新增 geo/规则资产的强制同步 |
| `getClashMiniGeoDatabaseAvailability(coreDir, config)` (~L806) | 判断 geo 库是否可用（`geoip.metadb` + `geosite.dat`，≥1MB） | 否（本地化后自然返回 true） |
| `normalizeClashMiniStartupConfig(config, coreDir)` (~L834) | 规范化配置：强制 rule 模式、注入国内直连规则、缺 geo 时离线兜底 | **改**：新增 geox-url / rule-providers 本地化 + 关自动更新 |
| `ensureClashMiniRuntimeConfig(coreDir)` (~L986) | 从订阅/profile 生成并写 `config.yaml` | 否（调用 normalize） |
| `startClashMiniProcessOnce(ui, options)` (~L1485) | 准备目录→生成配置→spawn mihomo | **改**：在 prepare 后调用资产同步 |

关键常量/事实：
- `CLASH_MINI_DIR_NAME = 'clash-mini'`；运行目录 = `app.getPath('appData')/clash-mini`。
- `MIN_USABLE_GEO_DATABASE_SIZE = 1MB`（`getClashMiniGeoDatabaseAvailability` 用它判"可用"）。
- 默认 `geodata-mode` 为 false → GEOIP 用 `geoip.metadb`，GEOSITE 用 `geosite.dat`。
- `copyDirectoryRecursive(src, dest, {overwrite})`：`overwrite:false` 会**跳过已存在文件、但拷贝新文件**。

---

## 3. 需要内置的二进制资产（Asset Manifest）

放入目录：`app2.1/resources/clash-mini/core/`（打包时随 `verge-mihomo.exe` 一起进 `resources/clash-mini/core/`）。

```
resources/clash-mini/core/
├── verge-mihomo.exe            (已存在)
├── geoip.metadb                (新增, GEOIP MMDB)
├── geosite.dat                 (新增, GEOSITE)
├── country.mmdb                (新增, 兼容 mmdb key, 保险)
└── providers/                  (新增目录)
    ├── cn_ip.mrs
    ├── cn_domain.mrs
    ├── private_domain.mrs
    └── geolocation-!cn.mrs
```

### 3.1 资产来源（择一，务必用国内可达来源下载后再放进仓库）

上游仓库：`MetaCubeX/meta-rules-dat`。
- Geo 库（`release` 分支/Release 资产）：`geoip.metadb`、`geosite.dat`、`country.mmdb`。
- 规则集 `.mrs`（`meta` 分支）：
  - `cn_ip.mrs` ← `geo/geoip/cn.mrs`
  - `cn_domain.mrs` ← `geo/geosite/cn.mrs`
  - `private_domain.mrs` ← `geo/geosite/private.mrs`
  - `geolocation-!cn.mrs` ← `geo/geosite/geolocation-!cn.mrs`

下载镜像建议（jsdelivr 在国内不稳，换其一）：`https://gh-proxy.com/https://github.com/MetaCubeX/meta-rules-dat/...`、`https://ghproxy.net/...`、`https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@...` 或直接 GitHub Release 页手动下载。**下载后校验：`geoip.metadb`、`geosite.dat` 均应 > 1MB（否则 §2 的可用性判定会当作缺失）。**

> 注意：`.mrs` 的 `behavior` 必须与源匹配（`cn_ip`=ipcidr，其余=domain），本地化时保留（见 §4.2）。

---

## 4. 改造步骤

### 4.1 资产同步：把内置 geo/规则拷进运行目录（覆盖）

问题：`prepareClashMiniRuntimeDir()` 用 `overwrite:false`，首次会拷入新资产；但如果运行目录里已有旧/半截同名文件，不会更新。geo/规则资产必须保证是最新且完整。

**在 `clash-mini-core.js` 新增函数**，并在 `startClashMiniProcessOnce` 的 `prepareClashMiniRuntimeDir()` 成功之后、`ensureClashMiniRuntimeConfig()` 之前调用：

```js
// 内置 Geo 库/规则集必须以内置版本为准，强制覆盖到运行目录，
// 避免旧缓存或半截下载文件导致分流不稳定。
const LOCAL_GEO_FILES = ['geoip.metadb', 'geosite.dat', 'country.mmdb'];
const LOCAL_PROVIDER_FILES = ['cn_ip.mrs', 'cn_domain.mrs', 'private_domain.mrs', 'geolocation-!cn.mrs'];

function syncLocalGeoAssets(runtimeDir) {
  const bundledCore = resolveBundledClashMiniCoreDir();
  if (!bundledCore) return { ok: false, error: '未找到内置 core 目录' };
  const copied = [];
  const missing = [];
  // geo 库（放 runtimeDir 根）
  for (const name of LOCAL_GEO_FILES) {
    const src = path.join(bundledCore, name);
    if (!fs.existsSync(src)) { missing.push(name); continue; }
    try { fs.copyFileSync(src, path.join(runtimeDir, name)); copied.push(name); } catch (e) { missing.push(name); }
  }
  // 规则集（放 runtimeDir/providers）
  const provDir = path.join(runtimeDir, 'providers');
  try { fs.mkdirSync(provDir, { recursive: true }); } catch (_) {}
  for (const name of LOCAL_PROVIDER_FILES) {
    const src = path.join(bundledCore, 'providers', name);
    if (!fs.existsSync(src)) { missing.push(`providers/${name}`); continue; }
    try { fs.copyFileSync(src, path.join(provDir, name)); copied.push(`providers/${name}`); } catch (e) { missing.push(`providers/${name}`); }
  }
  return { ok: missing.length === 0, copied, missing };
}
```

调用点（`startClashMiniProcessOnce`，L1513 附近）：
```js
const runtimePrep = prepareClashMiniRuntimeDir();
if (!runtimePrep.ok) { /* 原逻辑 */ }

const assetSync = syncLocalGeoAssets(runtimePrep.runtimeDir);
if (!assetSync.ok) {
  emitClashMiniLog(ui, 'warn', `本地 Geo/规则资产缺失: ${assetSync.missing.join(', ')}（将回退到离线兜底）`);
}

const configResult = ensureClashMiniRuntimeConfig(runtimePrep.runtimeDir);
```

> 资产缺失时不阻断启动（仍走现有离线兜底），只告警——保证向后兼容。

> ⚠️ **时序陷阱（必读）**：`normalizeClashMiniStartupConfig` 会读磁盘上的 geo 文件判"可用性"。若在 geo 文件到位**之前**跑 normalize，会判为缺失 → 触发离线兜底把 `MATCH,<节点组>` 改写成 `MATCH,DIRECT`，写进 `config.yaml` 后即成既定事实，之后再规范化也**救不回** `MATCH,节点`。
> 而 normalize 有**两个入口**：
> 1. 启动路径：`startClashMiniProcessOnce → ensureClashMiniRuntimeConfig → normalize`（本文 §4.1 已在此前同步资产 ✅）；
> 2. **服务器下发配置路径**：`clash.js → importDirectClashRuntimeConfig → normalizeDirectClashRuntimeConfig → normalize`（可能在进程启动前就跑，此时资产可能还没同步 ❌）。
>
> **对策（择一，推荐第 1 个）**：
> - 把 `syncLocalGeoAssets(coreDir)` 下沉进 `prepareClashMiniRuntimeDir()` 末尾（返回前调用），并在 `importDirectClashRuntimeConfig` 开头也调一次 `syncLocalGeoAssets(coreDir)`（幂等，重复拷贝无副作用）。确保**任何** normalize 之前，geo 文件已在 `coreDir`。
> - 或：让 `localizeGeoAndProviders`（§4.2）在 geo 文件不存在但**内置资产存在**时，先就地把内置资产拷到 `coreDir` 再判可用性。

### 4.2 规范化：把远程 geox-url / rule-providers 改写成本地文件 + 关自动更新

**在 `normalizeClashMiniStartupConfig(config, coreDir)` 里新增一段本地化转换**。位置：在函数开头 `repairMalformedHttpsUrls` 之后、`getClashMiniGeoDatabaseAvailability` 之前（这样本地化后再判可用性，自然判为 available，跳过离线兜底改写）。

```js
// —— Geo/规则本地化：只要内置资产存在，就把配置指向本地文件，杜绝运行时联网 ——
function localizeGeoAndProviders(cfg, coreDir, stats) {
  const has = (rel) => { try { return fs.statSync(path.join(coreDir, rel)).size > 0; } catch (_) { return false; } };
  const next = { ...cfg };

  // 1) 关闭 geo 自动更新，避免运行中再去拉
  if (next['geo-auto-update'] !== false) { next['geo-auto-update'] = false; stats.geoLocalized = true; }

  // 2) geox-url：本地库齐全就整体删除（mihomo 有本地文件即用本地，不再下载）
  if (has('geoip.metadb') && has('geosite.dat')) {
    if (next['geox-url']) { delete next['geox-url']; stats.geoLocalized = true; }
  }

  // 3) rule-providers：远程 url → type:file 本地路径（按文件名映射到内置 .mrs）
  const providerFileByName = {
    cn_ip: 'providers/cn_ip.mrs',
    cn_domain: 'providers/cn_domain.mrs',
    private_domain: 'providers/private_domain.mrs',
    'geolocation-!cn': 'providers/geolocation-!cn.mrs',
  };
  const rp = next['rule-providers'];
  if (rp && typeof rp === 'object' && !Array.isArray(rp)) {
    const localized = {};
    for (const [name, def] of Object.entries(rp)) {
      const rel = providerFileByName[name];
      if (rel && has(rel) && def && typeof def === 'object') {
        // 保留 behavior/format，改成本地文件，去掉 url/interval/proxy
        const { url, interval, proxy, ...rest } = def;
        localized[name] = { ...rest, type: 'file', path: `./${rel}`, format: rest.format || 'mrs' };
        stats.providersLocalized = (stats.providersLocalized || 0) + 1;
      } else {
        localized[name] = def; // 无对应内置文件的 provider 原样保留（回退联网）
      }
    }
    next['rule-providers'] = localized;
  }
  return next;
}
```

在 `normalizeClashMiniStartupConfig` 里接线（新增 stats 字段 + 调用）：
```js
const stats = { /* 原字段 */ geoLocalized: false, providersLocalized: 0 };
let next = repairMalformedHttpsUrls(config, stats);
next = localizeGeoAndProviders(next, coreDir, stats);   // ← 新增
if (String(next.mode || '').trim().toLowerCase() !== CLASH_MINI_RULE_MODE) { /* 原逻辑 */ }
const geoAvailability = getClashMiniGeoDatabaseAvailability(coreDir, next);  // 现在会判 available
// …后续离线兜底逻辑保持不变（本地库齐全时它自然不触发）
```

并把 `stats.changed` 的判定加上新字段：
```js
stats.changed = stats.controlFieldAdded || stats.ruleModeForced || stats.domesticDirectRulesAdded > 0
  || stats.fixedUrls > 0 || stats.removedGeoRules > 0 || stats.offlineMatchDirectRulesRewritten > 0
  || stats.disabledDnsGeoFilter || stats.geoLocalized || stats.providersLocalized > 0;   // ← 新增
```

> `path: './providers/xxx.mrs'` 相对 mihomo 的工作目录（`-d <runtimeDir>`，见 `spawn(exePath, ['-d', runtimeDir], { cwd: runtimeDir })`），即运行目录根。与 §4.1 拷贝位置一致。

### 4.3 兜底策略确认（无需改代码，验证即可）

本地库齐全后，`getClashMiniGeoDatabaseAvailability` 返回 `{geoIp:true, geoSite:true}` → §2 离线兜底整段跳过 → 注入的 `GEOSITE,CN,DIRECT` / `GEOIP,CN,DIRECT` 保留、订阅 `MATCH,<节点组>` **不再被改写成 DIRECT**。这就是"国内直连 + 其余走节点"的确定性分流。

---

## 5. 验收标准（Acceptance Criteria）

实现方必须逐条验证：

1. **无联网拉取**：断网或用防火墙阻断 `jsdelivr.net` 后，开启网络魔法，Clash Mini 日志**不再出现** `Provider … pull error` / geo 下载。
2. **生成的 config.yaml**：
   - `geo-auto-update: false`；
   - 无 `geox-url`（或指向本地）；
   - `rule-providers` 里 `cn_ip/cn_domain/private_domain/geolocation-!cn` 均为 `type: file` + `path: ./providers/*.mrs`，无 `url`；
   - 最终规则仍是 `MATCH,<节点组>`（**不是** `MATCH,DIRECT`）。
3. **分流正确**（选中一个国外节点后）：
   - 访问国外站点 → mihomo 日志 `using <节点>`；国内站点 → `using DIRECT`；
   - 悬停某浏览器窗口，提示的"地区/来源IP"显示**节点所在地**（如日本），不再是 CN（配合已实现的出口校验 `browser-profile.js`）。
4. **确定性**：连续冷启动 5 次（清掉 `%APPDATA%/clash-mini/config.yaml` 后重开魔法），每次分流结果一致。
5. **资产缺失回退**：临时移除内置某个 `.mrs`，应仅告警并对该 provider 回退，不崩溃。

### 5.1 快速自测命令（PowerShell / bash）
```bash
# 生成后的配置检查
CFG="$APPDATA/clash-mini/config.yaml"
grep -E "geo-auto-update|geox-url|type: file|MATCH," "$CFG"
# 运行时确认没有 provider 联网错误
grep -c "pull error" "$APPDATA/ai-free/logs/"$(ls -t "$APPDATA/ai-free/logs" | head -1)   # 期望 0
```

---

## 6. 风险与回滚

- **风险：内置 `.mrs`/geo 库过期**。缓解：随版本更新资产；`geo-auto-update:false` 只影响自动更新，手动换文件即可。域名库轻度过期不影响"CN 直连/其余走节点"的大分流。
- **风险：仓库体积增大**（geo 库约几十 MB）。可接受；如介意，Geo 库可只留 `geoip.metadb`+`geosite.dat`，`country.mmdb` 视 mihomo 是否报缺再加。
- **回滚**：删除 §4.1/§4.2 新增代码 + 资产文件即恢复原行为（离线兜底仍在）。改动集中在单文件 `clash-mini-core.js` + 资产目录，易回滚。

---

## 7. 构建与生效

- 改的是 `app2.1/src/**` 源码 + `app2.1/resources/clash-mini/core/**` 资产。
- **用户运行的是 `appbuild` 打包版，必须 `npm run build:win` 重新构建后才生效**（打包会把 `resources/clash-mini` 带进 `resources/`）。
- 构建前确认 electron-builder 的 `files`/`extraResources` 配置包含 `resources/clash-mini/**`（若资产未进包，运行目录就拿不到内置文件 → 回退联网）。检查 `app2.1/package.json` 的 build 配置。

---

## 8. 超出本次范围（Phase 2/3，勿在本次做）

- Phase 2：开魔法时自动测速选最快节点 + 死节点自动切换（`collectClashMiniProxyDelays` / `probeClashMiniProxyDelay` 已有基建）。
- Phase 3：订阅自动刷新/到期重拉、节点分组切换 UI。

---

## 9. 复盘：改造后仍报"代理未改变出口"的原因与两个残留修复点

> 现场实测结论（应用运行时，通过 Clash Mini 端口 7890 实测）：
> - **真直连**（`curl --noproxy '*'`）cloudflare trace → `ip=220.195.204.135 loc=CN`（本机真实 CN 出口）
> - **经 7890** cloudflare trace → `ip=103.62.49.178 colo=NRT loc=JP`（**日本节点出口**）
> - mihomo 日志已从 `match Match using DIRECT` 变为 `match GeoIP(cn) using DIRECT`
>
> **⇒ 结论：geo 本地化生效了，代理对真实国外流量确实生效（cloudflare 走了日本节点）。** 但仍报"代理未改变出口/CN"，原因是下面两个残留点。

### 9.1 残留点 A（主因）：探测端点自身被直连路由 → 悬停提示量错了

`browser-profile.js` 的出口探测用 `api.ip.sb / ipwho.is / ipinfo.io` 三个端点。实测这三个经 7890 时**被 CN 规则直连路由**（它们经国内 DNS 解析/geo 归类落到 CN），返回的是本机 CN IP，于是出口校验（对比"经代理 IP == 直连基线 IP"）**正确地**判为"未过节点"。但这只反映这三个探测端点的路由，不代表真实浏览（cloudflare 已证明走了日本节点）。

**修复：把探测改为使用"确定走节点"的端点**（`app2.1/src/app/main/utils/browser-profile.js`）：

1. 端点表加入 cloudflare trace（非 CN 归类、实测走节点），放在最前：
   ```js
   const GEO_IP_ENDPOINTS = [
     'https://www.cloudflare.com/cdn-cgi/trace', // 走节点，代理场景能量到节点真实出口
     'https://ipwho.is/',
     'https://ipinfo.io/json',
     'https://api.ip.sb/geoip',
   ];
   ```
2. `buildGeoProfile(response, endpoint)` 开头加 trace 文本解析（它返回 `key=value` 文本，不是 JSON）：
   ```js
   // cloudflare trace 是纯文本 ip=.../loc=... —— 归一成 buildGeoProfile 认识的字段
   function parseCloudflareTrace(raw) {
     const text = typeof raw === 'string' ? raw : (raw && typeof raw.raw === 'string' ? raw.raw : '');
     if (!/(^|\n)\s*loc=/.test(text) || !/(^|\n)\s*ip=/.test(text)) return null;
     const kv = Object.fromEntries(text.split('\n').map((l) => l.split('=')).filter((a) => a.length === 2)
       .map(([k, v]) => [k.trim(), v.trim()]));
     if (!kv.ip || !kv.loc) return null;
     return { ip: kv.ip, country_code: kv.loc, country: kv.loc }; // loc 是两位国家码
   }
   ```
   然后在 `buildGeoProfile` 里，若 `response.body` 不是可用 JSON 对象，就先尝试 `parseCloudflareTrace(response.body)` 得到 `{ip,country_code}` 再往下走（`inferRegionFromCountry('JP')→'jp'`，时区/语言由 region 预设补全）。
3. 出口校验（"拒绝==直连基线 IP"）**保持不变**——它是对的。加了走节点的端点后，经代理的 cloudflare 返回节点 IP（≠ 基线 CN IP）会被正确采纳，提示显示节点地区（如日本）。

> 注意：`httpGetUniversal` 默认 `Accept: application/json` 且会 `JSON.parse`；trace 是 `text/plain`，实现方需确保拿得到原始文本（parse 失败时保留 raw），否则解析不到。

### 9.2 残留点 B：provider 本地化只做了一半（§4.2 下半段未落地）

实测生成的 `config.yaml`：`geo-auto-update: false` ✅、无 `geox-url` ✅，但 **`type: file` 计数 = 0、仍残留 5 个远程 provider url**（`jsdelivr/meta-rules-dat`）。说明 §4.2 里"把 rule-providers 改成 `type: file` 本地文件"**没实现**，只做了 geo 库那半。

- 影响：GEOIP 已能撑起"CN 直连 / 其余走节点"的**主分流**（所以 cloudflare 能走节点）；但 `cn_domain / geolocation-!cn / private_domain` 这些**基于域名的分流仍依赖 jsdelivr**，会继续 `pull error: EOF`、域名级分流不稳。
- 修复：按 §3 内置对应 `.mrs`、按 §4.2 的 `localizeGeoAndProviders` 把 rule-providers 逐个改成 `type: file` + 本地 `path`，并确认 §4.1 的资产同步在 §4.2 之前执行（§4.1 的时序陷阱）。

### 9.3 验收补充

- 经代理探测应量到**节点地区**：`curl --noproxy '' --proxy http://127.0.0.1:7890 https://www.cloudflare.com/cdn-cgi/trace` 的 `loc` 应为节点所在国（非 CN）；悬停提示地区随之显示节点地区。
- 生成的 `config.yaml` 里 `grep -c "type: file"` 应 = provider 数量、`grep -cE "jsdelivr|meta-rules-dat"` 应 = 0。

---

## 附：关键文件路径速查

- 主改造文件：`app2.1/src/app/main/ipc/register/clash-mini-core.js`
- 资产目录：`app2.1/resources/clash-mini/core/`（含新增 `providers/`）
- 运行目录（生成物）：`%APPDATA%/clash-mini/`（`config.yaml` 每次启动重生成）
- 相关（本次不改，仅联动）：`app2.1/src/app/main/utils/browser-profile.js`（出口校验，已实现）、`app2.1/src/app/main/ipc/register/clash.js`（订阅导入入口）
