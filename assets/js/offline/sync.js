/** Outbox draining, GAS warm-up and manual synchronization. */
import { ApiService } from '../api.js';
import { AuthService } from '../auth.js';
import { ErrorCodes } from '../core/error-codes.js';
import {
  API_URL, MAX_RETRY, SYNC_BATCH_SIZE, BATCH_DELAY_MS, MAX_DRAIN_BATCHES
} from './config.js';
import {
  all, getPendingCount, claimItem, updateItem, markFailed,
  incrementRetry, markSynced
} from './storage.js';
import {
  getCurrentToken, validatePhotoPayloadOffline, pwaToast, quietFailToast,
  auditWrite, notifySwInvalidateOffline_, setLastSyncAttempt,
  getLastSyncAttempt, setFailToastShown, getLastWarm, setLastWarm,
  SYNC_TAB_ID
} from './utils.js';
import { clearCache } from './cache.js';
import { isOutboxPending, OUTBOX_STATUSES } from '../core/outbox-policy.js';

let _syncing = false;
let _syncPromise = null;
  // ========== 暖機與同步 ==========
  function warmGAS() {
    // 🔥 [Bugfix] 未配置 API 端點時直接跳過，避免 fetch('?action=ping') 打到錯誤 URL
    if (!API_URL) return;
    if (Date.now() - getLastWarm() < 5 * 60 * 1000) return;
    setLastWarm(Date.now());
    try {
      // 🔥 [Bugfix] 改回 cors 模式：no-cors 在部分瀏覽器可能被 network layer 攔截或快取，
      // 未必能真正觸發 GAS 冷啟動。cors 模式即使被 GAS CORS 拒絕，請求仍會到達伺服器達到暖機效果。
      // 回應一律忽略（catch 吞掉），不影響主流程。
      fetch(API_URL + '?action=ping', { method: 'GET', mode: 'cors', cache: 'no-store' }).catch(function(){ /* intentionally ignored: optional fallback failure */ });
    } catch (e) { /* intentionally ignored: optional fallback failure */ }
  }

  // 所有入口共用同一個 Promise，避免 online、visibilitychange、輪詢及手動按鈕
  // 同時啟動多條同步連線。同步仍維持佇列順序，確保 inspection/photo 依賴不被打亂。
  function syncOutbox(force) {
    if (!navigator.onLine) return Promise.resolve(0);
    if (_syncPromise) return _syncPromise;
    // 🔥 [Bugfix] 節流時間從 60s 縮短至 15s，確保用戶從離線恢復連線後能更快觸發同步重試
    if (!force && Date.now() - getLastSyncAttempt() < 15 * 1000) return Promise.resolve(0);

    _syncPromise = runSyncOutbox(force).finally(function() {
      _syncPromise = null;
    });
    return _syncPromise;
  }

  // 可选延时：批次间让出主线程并避免 GAS 限流
  function delay_(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

  // 单批次逐笔同步（保持顺序，不并发），返回 {synced, failed, networkStreak, shouldBreak}
  async function processBatch_(batch){
    var synced = 0;
    var failed = 0;
    var networkStreak = 0;
    var shouldBreak = false;
    var reauthCount = 0; // 🔥 限制每批次重新認證重試次數，避免無限循環
    for (var i = 0; i < batch.length; i++) {
      var item = await claimItem(batch[i].id);
      if (!item) continue;
      if (!navigator.onLine) {
        await updateItem(item.id, { status: OUTBOX_STATUSES.QUEUED, syncingAt: null, syncOwner: null }, null, SYNC_TAB_ID);
        shouldBreak = true;
        break;
      }
      if (item.retry >= MAX_RETRY) {
        console.warn('[Sync] 记录超过重试上限，标记为 failed（保留）:', item.id);
        await markFailed(item.id, '超过重试上限(' + MAX_RETRY + '次)');
        auditWrite(item.payload, 'sync', 'failed', '超过重试上限(' + MAX_RETRY + '次)');
        failed++;
        networkStreak = 0;
        continue;
      }
      var photoErr = validatePhotoPayloadOffline(item.payload);
      if (photoErr) {
        console.warn('[Sync] 相片校验失败，标记 failed:', photoErr);
        await markFailed(item.id, photoErr);
        auditWrite(item.payload, 'sync', 'failed', photoErr);
        pwaToast('⚠️ 离线记录相片校验失败：' + photoErr, 4000);
        failed++;
        networkStreak = 0;
        continue;
      }
      var tk = getCurrentToken();
      if (tk) item.payload.token = tk;
      if (AuthService && AuthService.getCsrfToken) {
        var csrfTk = AuthService.getCsrfToken();
        if (csrfTk) item.payload.csrf_token = csrfTk;
      }
      try {
        var res = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(item.payload)
        });
        var json;
        try {
          if (ApiService && ApiService.parseResponse) {
            json = await ApiService.parseResponse(res, 'POST offline sync');
          } else {
            var responseBody = await res.text();
            try { json = responseBody ? JSON.parse(responseBody) : null; } catch (parseError) {
              throw new Error('同步回应不是有效 JSON，请确认 GAS 使用正式 /exec 部署网址。', { cause: parseError });
            }
            if (!res.ok) throw new Error('HTTP ' + res.status);
          }
        } catch (responseError) {
          var responseStatus = responseError.status || res.status;
          var permanentApiError = responseError.noRetry || responseStatus === 401 || responseStatus === 403 || responseStatus === 404;
          var responseMessage = responseError.message || ('HTTP ' + responseStatus);
          if (permanentApiError) {
            console.error('[Sync] API 部署或权限错误，停止自动重试:', responseMessage);
            await markFailed(item.id, responseMessage);
            auditWrite(item.payload, 'sync', 'failed', responseMessage);
            failed++;
            networkStreak = 0;
            continue;
          }
          console.warn('[Sync] 服务器状态/格式错误，稍后重试:', responseMessage);
          quietFailToast('⏳ 后端不稳，记录已安全排队');
          await incrementRetry(item.id, responseMessage, SYNC_TAB_ID);
          auditWrite(item.payload, 'sync', 'retry', responseMessage);
          failed++;
          networkStreak++;
          if (networkStreak >= 3) { shouldBreak = true; }
          continue;
        }
        if (json && (json.ok || json.duplicate === true)) {
          if (json.duplicate === true) console.log('[Sync] 后端回报重复（client_id 已处理），视为成功:', item.id);
          // 🔥 [P0 修復] CSRF 旋轉：同步成功後更新前端 CSRF Token
          if (json.csrf_token && AuthService && AuthService.setCsrfToken) {
            AuthService.setCsrfToken(json.csrf_token);
          }
          await markSynced(item.id);
          auditWrite(item.payload, 'sync', 'synced');
          synced++;
          networkStreak = 0;
        } else if (json && (function(j){var c=String(j.error_code||j.error||''); return c==='UNAUTHORIZED'||c==='CSRF_INVALID'||c==='CSRF_TOKEN_INVALID'||c==='AUTH_FAILED'; })(json)) {
          auditWrite(item.payload, 'sync', 'unauthorized', json.error);
          // 🔥 [P0 修復] 先檢查 AuthService 嘅 CSRF token 是否已被平行請求旋轉咗
          // （另一個寫入成功後已更新 token，唔需要重新登入）
          var csrfRetried = false;
          if (AuthService && AuthService.getCsrfToken) {
            var newCsrf = AuthService.getCsrfToken();
            if (newCsrf && newCsrf !== item.payload.csrf_token) {
              item.payload.csrf_token = newCsrf;
              // 更新 token（可能都更新咗）
              if (AuthService.getToken) {
                var newToken = AuthService.getToken();
                if (newToken) item.payload.token = newToken;
              }
              csrfRetried = true;
              // 直接重試，唔打斷流程
              i--; networkStreak = 0; continue;
            }
          }
          if (!csrfRetried) {
            await updateItem(item.id, { status: OUTBOX_STATUSES.QUEUED, lastError: '登入已过期', syncingAt: null, syncOwner: null }, null, SYNC_TAB_ID);
            if (AuthService && (AuthService.reauthenticate || AuthService.promptAuth)) {
              var reOk = AuthService.reauthenticate ? await AuthService.reauthenticate('登入已过期，请重新输入工作人员密码以继续同步') : await AuthService.promptAuth('登入已过期，请重新输入工作人员密码以继续同步');
              if (reOk) { reauthCount++; if (reauthCount >= 2) { shouldBreak = true; break; } i--; networkStreak = 0; continue; }
            }
            failed++;
            networkStreak = 0;
            shouldBreak = true;
            break;
          }
        } else {
          var bizCode = json && String(json.error_code || json.error || 'UNKNOWN');
          var noRetryCodes = {VALIDATION_FAILED:true, CONFLICT:true, INVALID_LOCATION:true, INVALID_REQUEST:true, INVALID_JSON:true, UNSUPPORTED_OPERATION:true, UPLOAD_FAILED:true};
          var bizMsg = (ErrorCodes.messageForResponse) ? ErrorCodes.messageForResponse(json, bizCode) : bizCode;
          if(noRetryCodes[bizCode]){
            console.warn('[Sync] 永久性业务错误，直接标记 failed:', bizCode);
            await markFailed(item.id, bizCode + ':' + bizMsg);
            auditWrite(item.payload, 'sync', 'failed', bizCode);
          } else {
            console.warn('[Sync] 业务错误（保留重试）:', bizCode);
            await incrementRetry(item.id, bizCode, SYNC_TAB_ID);
            auditWrite(item.payload, 'sync', 'error', bizCode);
          }
          failed++;
          networkStreak = 0;
          continue;
        }
      } catch (err) {
        console.warn('[Sync] 网络不稳，稍后重试');
        quietFailToast('⏳ 网络不稳，记录已安全排队');
        await incrementRetry(item.id, (err && err.message) || '网络不稳', SYNC_TAB_ID);
        auditWrite(item.payload, 'sync', 'retry', (err && err.message) || '网络不稳');
        failed++;
        networkStreak++;
        if (networkStreak >= 3) { shouldBreak = true; break; }
        continue;
      }
    }
    return { synced: synced, failed: failed, networkStreak: networkStreak, shouldBreak: shouldBreak };
  }

  async function runSyncOutbox(force) {
    if (!navigator.onLine || _syncing) return 0;
    // 🔥 [Bugfix] 與 syncOutbox 節流一致（15s）：避免外層已放行但內層 60s 檢查把請求擋住，
    // 導致從離線恢復連線後 60 秒內無法重試同步
    if (!force && Date.now() - getLastSyncAttempt() < 15 * 1000) return 0;
    setLastSyncAttempt(Date.now());
    _syncing = true;
    var totalSynced = 0;
    var totalFailed = 0;
    var batchCount = 0;
    try {
      while (navigator.onLine && batchCount < MAX_DRAIN_BATCHES) {
        var items = await all();
        var pending = items.filter(isOutboxPending);
        if (!pending.length) break;
        if (batchCount > 0) {
          await delay_(BATCH_DELAY_MS);
          if (!navigator.onLine) break;
        }
        console.log('[Sync] 待同步 ' + pending.length + ' 筆（總共 ' + items.length + ' 筆）' + (batchCount ? ' - 第' + (batchCount+1) + '批' : ''));
        var batch = pending.slice(0, SYNC_BATCH_SIZE);
        var result = await processBatch_(batch);
        totalSynced += result.synced;
        totalFailed += result.failed;
        batchCount++;
        if (result.shouldBreak) {
          console.warn('[Sync] 連續網路失敗或登入過期，暫停本輪 drain，待下次觸發');
          break;
        }
        if (result.synced === 0 && result.failed === 0) break;
      }
      console.log('[Sync] 完成：成功 ' + totalSynced + ' 筆，失敗 ' + totalFailed + ' 筆' + (batchCount ? '（共' + batchCount + '批）' : ''));
      if (totalSynced > 0) {
        var remain = await getPendingCount();
        if (remain === 0) pwaToast('✅ 已全部同步 (' + totalSynced + '筆)', 3000);
        else pwaToast('☁️ 已同步 ' + totalSynced + ' 筆，剩餘 ' + remain + ' 筆，繼續同步中…', 3000);
        setFailToastShown(false);
        clearCache();
        notifySwInvalidateOffline_('sync', null);
        try { if(ApiService && ApiService.clearCache) ApiService.clearCache(); } catch(e) { /* intentionally ignored: optional fallback failure */ }
      } else if (totalFailed > 0 && batchCount > 0) {
        pwaToast('⏳ 部分記錄暫時無法同步，已保留重試', 3000);
      }
      return totalSynced;
    } catch (err) {
      console.error('[Sync] 同步流程發生錯誤:', err);
      return totalSynced;
    } finally {
      _syncing = false;
    }
  }

  async function syncNow() {
    if (!navigator.onLine) {
      pwaToast('📴 離線中，無法同步');
      return 0;
    }
    pwaToast('⏳ 正在同步…');
    await syncOutbox(true);
    var count = await getPendingCount();
    if (count === 0) pwaToast('✅ 已全部同步');
    return count;
  }
export { warmGAS, syncOutbox, syncNow };


