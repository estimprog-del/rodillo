/**
 * adsenseInit.js - Inicialización de Google AdSense + Consent Mode v2.
 * Se carga como módulo para no violar la CSP (script-src 'self' sin 'unsafe-inline').
 */
window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
window.gtag = gtag;

// Consent Mode v2: denegado por defecto solo en EEA/UK/CH (GDPR).
// En el resto de regiones (incluido el crawler de AdSense, habitualmente US)
// se permite por defecto para que los anuncios puedan mostrarse.
const EEA_UK_CH = [
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE",
  "IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE","IS",
  "LI","NO","GB","CH",
];
gtag("consent", "default", {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  functionality_storage: "granted",
  personalization_storage: "denied",
  security_storage: "granted",
  wait_for_update: 500,
  region: EEA_UK_CH,
});
gtag("consent", "default", {
  ad_storage: "granted",
  ad_user_data: "granted",
  ad_personalization: "granted",
  analytics_storage: "granted",
  functionality_storage: "granted",
  personalization_storage: "granted",
  security_storage: "granted",
});

window.adsbygoogle = window.adsbygoogle || [];

function initAd() {
  try {
    if (!window.adsbygoogle) return;
    // Un push por cada unidad de anuncio presente en la página.
    const units = document.querySelectorAll("ins.adsbygoogle");
    units.forEach(() => {
      try { window.adsbygoogle.push({}); } catch (e) { /* noop */ }
    });
    if (units.length === 0) window.adsbygoogle.push({});
  } catch (e) { /* noop */ }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAd);
} else {
  initAd();
}
