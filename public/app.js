'use strict';

/* ============================================================
   NOVA — boot
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => {
    console.error(err);
    try {
      const msg = err && err.message ? err.message : String(err);
      toast(typeof t === 'function' ? t('initError', { err: msg }) : msg, 'error', 9000);
    } catch {
      // UI may not be ready
    }
    if (typeof setStatus === 'function') {
      setStatus(typeof t === 'function' ? t('errorStatus') : 'Error', 'error');
    }
  });
});
