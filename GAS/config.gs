// 環境注入：優先讀 ScriptProperties，缺省回退至硬編碼預設值
// 在 GAS 編輯器 → 專案設定 → 指令碼屬性 設置 FOLDER_ID / SH_* / TOKEN_EXPIRY_SECONDS 等
function getEnv_(key, fallback) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(key);
    if (v !== null && v !== undefined && String(v).trim() !== '') return String(v).trim();
  } catch (e) {}
  return fallback;
}
function getEnvNumber_(key, fallback) {
  var s = getEnv_(key, null);
  if (s === null || s === undefined) return fallback;
  var n = Number(s);
  return isNaN(n) ? fallback : n;
}

const FOLDER_ID = getEnv_('FOLDER_ID', '1Z0z9p2HC88T8gGy7hdYsq7JzyXhTTGAW');
const SH_TREES = getEnv_('SH_TREES', 'trees');
const SH_INS   = getEnv_('SH_INS', 'inspections');
const SH_CHK   = getEnv_('SH_CHK', 'checkins');
const SH_PRJ   = getEnv_('SH_PRJ', 'projects');
const SH_SPECIES = getEnv_('SH_SPECIES', 'species');
const SPREADSHEET_ID = getEnv_('SPREADSHEET_ID', ''); // standalone GAS: bind to fixed spreadsheet ID

const TOKEN_EXPIRY_SECONDS = getEnvNumber_('TOKEN_EXPIRY_SECONDS', 21600); // Token 有效期 6 小時
const CSRF_EXPIRY_SECONDS = getEnvNumber_('CSRF_EXPIRY_SECONDS', 21600);  // CSRF Token 有效期 6 小時

// 🔥 服務端快取設定（統一來源：GAS/cache-policy.gs → CACHE_POLICY，仍允許 ScriptProperties 覆蓋）
const BOOTSTRAP_CACHE_KEY = getEnv_('BOOTSTRAP_CACHE_KEY', 'bootstrap_data');
const BOOTSTRAP_CACHE_TTL = getEnvNumber_('BOOTSTRAP_CACHE_TTL', (typeof CACHE_POLICY !== 'undefined' && CACHE_POLICY.bootstrap) ? CACHE_POLICY.bootstrap.ttl : 300);
const TREES_CACHE_KEY = getEnv_('TREES_CACHE_KEY', 'trees_all');
const PROJECTS_CACHE_KEY = getEnv_('PROJECTS_CACHE_KEY', 'projects_all');
const INSPECTIONS_CACHE_KEY = getEnv_('INSPECTIONS_CACHE_KEY', 'inspections_all');
const SPECIES_CACHE_KEY = getEnv_('SPECIES_CACHE_KEY', 'species_all');
const CACHE_TTL = getEnvNumber_('CACHE_TTL', (typeof CACHE_POLICY !== 'undefined' && CACHE_POLICY.trees) ? CACHE_POLICY.trees.ttl : 300); // 一般唯讀快取 300 秒
const INSPECTIONS_TTL = getEnvNumber_('INSPECTIONS_TTL', (typeof CACHE_POLICY !== 'undefined' && CACHE_POLICY.inspections) ? CACHE_POLICY.inspections.ttl : 120); // 分頁/巡查短 TTL
const SPECIES_TTL = getEnvNumber_('SPECIES_TTL', (typeof CACHE_POLICY !== 'undefined' && CACHE_POLICY.species) ? CACHE_POLICY.species.ttl : 86400); // 物種長 TTL

const LOGIN_MAX_FAILURES = getEnvNumber_('LOGIN_MAX_FAILURES', 10);
const LOGIN_LOCK_SECONDS = getEnvNumber_('LOGIN_LOCK_SECONDS', 600); // 鎖 10 分鐘

const WGS_A_  = 6378137.0,  WGS_F_ = 1/298.257223563;
const INTL_A_ = 6378388.0,  INTL_F_ = 1/297.0;
const ARC_    = Math.PI/180/3600;