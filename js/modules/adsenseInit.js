/**
 * adsenseInit.js - Inicialización de Google AdSense + Consent Mode v2.
 * Se carga como módulo para no violar la CSP (script-src 'self' sin 'unsafe-inline').
 */
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
window.gtag = gtag;

// Consent Mode v2: por defecto denegado (GDPR). Se actualiza al elegir en el banner.
gtag("consent", "default", {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  functionality_storage: "granted",
  personalization_storage: "denied",
  security_storage: "granted",
  wait_for_update: 500,
});

window.adsbygoogle = window.adsbygoogle || [];

function initAd() {
  try {
    if (window.adsbygoogle) window.adsbygoogle.push({});
  } catch (e) { /* noop */ }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAd);
} else {
  initAd();
}
