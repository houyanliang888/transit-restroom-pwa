# 高德 API 实战踩坑记录（出行助手项目）

> 记录于 2026-10-25。全部结论均由真实接口返回验证，非文档推测。

## 一、两把 Key 的区别与各自鉴权方式

| Key 类型 | 用途 | 鉴权 | 域名限制 |
|---|---|---|---|
| **Web端(JS API)** | 前端 JS SDK（地图展示、JS 插件） | key + `securityJsCode` | **服务端接口强校验域名白名单** |
| **Web服务** | 前端直接调 restapi（JSONP） | 只需 key | **不校验域名** ← 推广首选 |

**本项目用的两把**：
- JS API Key：`52acfdb74e31a72793d0b8bfd459aa88` + 安全密钥 `fcb59b20ee438f984b347c10b035c1cf`
- Web服务 Key：`8c7f3a832c406cfed4d74b8ed0a94b02`（无需安全密钥）

## 二、关键坑

### 坑1：curl 直连 restapi 测试「Web端(JS API)」Key 会误判
JS API 类型的 Key 走 restapi 直连**必然**返回 `INVALID_USER_KEY (10001)`，与白名单无关。
→ **不能用 curl 结果判断白名单是否生效**，必须用真实浏览器（Playwright）测。

### 坑2：`INVALID_USER_KEY` 有三种成因，别只盯着白名单
1. 域名白名单不匹配
2. **Key 尚未被服务端接受**（新实名认证账号 + 新建 Key，通常需数小时同步）← 本次真实原因
3. Key/安全密钥不匹配或已失效

**排除法**：连 `/v3/ip`（不涉及白名单）都失败 → 问题在 Key 本身，不在白名单。

### 坑3：Web服务 API 限流
连续快速调用会返回 `CUQPS_HAS_EXCEEDED_THE_LIMIT (10021)`。测试时需间隔几秒。

### 坑4：`location` 字段格式随 `extensions` 变化
- `extensions=base` → `location` 是**字符串** `"113.118366,36.193563"`
- `extensions=all` → 有时是对象 `{lng, lat}`
→ 统一用 `parseLoc()` 兼容解析。

### 坑5：公交/地铁 POI 类型码查不到
`types=150100`（公交站）、`types=150200`（地铁站）在 place/around 中**查不到结果**。
→ **改用 keywords**（如 `keywords=公交站`），返回名称带"(公交站)"后缀，可自行过滤。
→ `types=120302`（公共厕所）**有效**，但必须用类型码——纯关键词会混入住宅区。

### 坑6：查线接口字段名有坑
`/v3/bus/linename?extensions=all`：
- `buslines` 在**返回体顶层**，不是 `result.buslines`
- 站点字段是 **`busstops`**（不是 `stations`），含 `id/location/name/sequence`
- 有 `start_stop` / `end_stop` 首末站名、`type` 类型
- `extensions=base` 时有 buslines 但**无站点** → 用 `all`

### 坑7：公交路径规划字段结构（`/v3/direction/transit/integrated`）
- 结果在 **`d.route.transits[]`**（不是 `d.plans[]`）
- `segments[]` 里：公交信息在 **`segment.bus.buslines[]`**，步行路径在 **`segment.walking.steps[].polyline`**
- 公交线路名在 `b.name`，站点数在 `b.via_num`，首末站在 `b.departure_stop` / `b.arrival_stop`
- 必须 `extensions=all` 才有 buslines
- `duration` 单位是**秒**（÷60 得分钟）

### 坑8：JSONP 跨域调用
Web服务 API 支持 `callback=xxx` 参数返回 JSONP，前端用 `<script>` 注入即可，绕过 CORS。

## 三、验证工具
- Playwright + Chromium（本机 node workspace 已有 playwright + chromium-1234）
- 测试脚本位置：`_tmp_frames/probe.js`（单接口）、`_tmp_frames/e2e.js`（端到端三大功能）
- 注意：Playwright 的 `waitUntil: 'networkidle'` 会超时（地图有持续请求），改用 `'domcontentloaded'` + 固定等待
