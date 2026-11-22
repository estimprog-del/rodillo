/**
 * consent.js - Banner de consentimiento GDPR (España/EU) para RodilloInt
 * Implementa Google Consent Mode v2. La elección se guarda en localStorage.
 */

const CONSENT_KEY = "rodilloint_consent";
const CONSENT_DETAIL_KEY = "rodilloint_consent_detail";

export function getConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
}

export function getConsentDetail() {
  try {
    const raw = localStorage.getItem(CONSENT_DETAIL_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* noop */ }
  const c = getConsent();
  if (c === "granted") return { ad: true, analytics: true };
  if (c === "denied") return { ad: false, analytics: false };
  return null;
}

export function setConsent(choice, detail) {
  try { localStorage.setItem(CONSENT_KEY, choice); } catch (e) { /* noop */ }
  if (detail) {
    try { localStorage.setItem(CONSENT_DETAIL_KEY, JSON.stringify(detail)); } catch (e) { /* noop */ }
  }
  const ad = detail ? !!detail.ad : (choice === "granted");
  const analytics = detail ? !!detail.analytics : (choice === "granted");
  if (typeof window.gtag === "function") {
    window.gtag("consent", "update", {
      ad_storage: ad ? "granted" : "denied",
      ad_user_data: ad ? "granted" : "denied",
      ad_personalization: ad ? "granted" : "denied",
      analytics_storage: analytics ? "granted" : "denied",
      functionality_storage: "granted",
      personalization_storage: ad ? "granted" : "denied",
      security_storage: "granted",
    });
  }
}

function applyStoredConsent() {
  const choice = getConsent();
  if (choice === "granted" || choice === "denied") {
    setConsent(choice, choice === "granted" ? { ad: true, analytics: true } : { ad: false, analytics: false });
    return true;
  }
  if (choice === "custom") {
    const d = getConsentDetail() || { ad: false, analytics: false };
    setConsent("custom", d);
    return true;
  }
  return false;
}

function createBanner() {
  // Eliminar banner previo si existe
  const existing = document.getElementById("consent-banner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "consent-banner";
  banner.className = "consent-banner";

  const showMain = () => {
    banner.innerHTML = `
      <div class="consent-banner-text">
        Usamos cookies y tecnologías similares para mostrar anuncios y analizar el uso.
        Puedes aceptar, rechazar o personalizar. <a href="#" id="consent-more" style="color: var(--accent-green, #2ecc71);">Más info</a>
      </div>
      <div class="consent-banner-actions">
        <button id="consent-reject" class="consent-btn consent-btn-reject" type="button">Rechazar todo</button>
        <button id="consent-custom" class="consent-btn consent-btn-custom" type="button">Personalizar</button>
        <button id="consent-accept" class="consent-btn consent-btn-accept" type="button">Aceptar todo</button>
      </div>
    `;
    const accept = banner.querySelector("#consent-accept");
    const reject = banner.querySelector("#consent-reject");
    const custom = banner.querySelector("#consent-custom");
    const more = banner.querySelector("#consent-more");
    if (accept) accept.addEventListener("click", () => { setConsent("granted", { ad: true, analytics: true }); banner.remove(); });
    if (reject) reject.addEventListener("click", () => { setConsent("denied", { ad: false, analytics: false }); banner.remove(); });
    if (custom) custom.addEventListener("click", showCustom);
    if (more) more.addEventListener("click", (e) => { e.preventDefault(); alert("Usamos Google AdSense para mostrar anuncios. Puedes cambiar tu elección aquí o borrando los datos del sitio."); });
  };

  const showCustom = () => {
    const d = getConsentDetail() || { ad: false, analytics: false };
    banner.innerHTML = `
      <div class="consent-banner-text">
        Personaliza tu consentimiento:
      </div>
      <div class="consent-banner-actions" style="flex-direction: column; align-items: flex-start; gap: 8px;">
        <label style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
          <input type="checkbox" id="consent-ad" ${d.ad ? "checked" : ""} /> Anuncios personalizados
        </label>
        <label style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
          <input type="checkbox" id="consent-analytics" ${d.analytics ? "checked" : ""} /> Analítica
        </label>
        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <button id="consent-save" class="consent-btn consent-btn-accept" type="button">Guardar</button>
          <button id="consent-back" class="consent-btn consent-btn-reject" type="button">Volver</button>
        </div>
      </div>
    `;
    const save = banner.querySelector("#consent-save");
    const back = banner.querySelector("#consent-back");
    if (save) save.addEventListener("click", () => {
      const ad = banner.querySelector("#consent-ad")?.checked || false;
      const analytics = banner.querySelector("#consent-analytics")?.checked || false;
      setConsent("custom", { ad, analytics });
      banner.remove();
    });
    if (back) back.addEventListener("click", showMain);
  };

  showMain();
  document.body.appendChild(banner);
}

export function reopenConsent() {
  if (typeof window.openPrivacyModal === "function") {
    window.openPrivacyModal();
  } else {
    createBanner();
  }
}

export function initConsent() {
  if (!applyStoredConsent()) {
    // Sin elección previa: derivar del consentimiento de privacidad (GA) si existe
    try {
      const raw = localStorage.getItem("rodilloint_privacy_consent");
      if (raw) {
        const pc = JSON.parse(raw);
        if (pc?.analytics === true) setConsent("granted", { ad: true, analytics: true });
        else if (pc?.analytics === false) setConsent("denied", { ad: false, analytics: false });
      }
    } catch (e) { /* noop */ }
  }
  // No hay botones de gestión separados; el modal de Privacidad es único
  if (typeof window.openPrivacyModal === "function") {
    const btnPrivacy = document.getElementById("btn-privacy-manage-ads");
    if (btnPrivacy) btnPrivacy.addEventListener("click", () => window.openPrivacyModal());
  }
}

initConsent();
