const FOLDER_ID = '1Z0z9p2HC88T8gGy7hdYsq7JzyXhTTGAW';
const SH_TREES = 'trees';
const SH_INS   = 'inspections';
const SH_CHK   = 'checkins';
const SH_PRJ   = 'projects';

const TOKEN_EXPIRY_SECONDS = 21600; // Token 有效期 6 小時
const CSRF_EXPIRY_SECONDS = 21600;  // CSRF Token 有效期 6 小時

// 🔥 服務端快取設定
const BOOTSTRAP_CACHE_KEY = 'bootstrap_data';
const BOOTSTRAP_CACHE_TTL = 300;
const TREES_CACHE_KEY = 'trees_all';
const PROJECTS_CACHE_KEY = 'projects_all';
const INSPECTIONS_CACHE_KEY = 'inspections_all';
const CACHE_TTL = 300; // 一般唯讀快取 300 秒

const LOGIN_MAX_FAILURES = 10;
const LOGIN_LOCK_SECONDS = 600; // 鎖 10 分鐘

const WGS_A_  = 6378137.0,  WGS_F_ = 1/298.257223563;
const INTL_A_ = 6378388.0,  INTL_F_ = 1/297.0;
const ARC_    = Math.PI/180/3600;