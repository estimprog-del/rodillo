const CONSENT_KEY = "rodilloint_privacy_consent";
const CONSENT_VERSION = 1;
const ANALYTICS_ID = "G-C0JZXF45DE";
let analyticsConfigured = false;

function readConsent() {
  try {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (!stored) return null;
    const consent = JSON.parse(stored);
    if (
      consent?.version !== CONSENT_VERSION ||
      typeof consent.analytics !== "boolean"
    ) {
      return null;
    }
    return consent;
  } catch (error) {
    console.error("No se pudo leer la elección de privacidad:", error);
    return null;
  }
}

function setAnalyticsConsent(allowed) {
  const consent = {
    version: CONSENT_VERSION,
    analytics: allowed,
    updatedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  } catch (error) {
    console.error("No se pudo guardar la elección de privacidad:", error);
    window.alert("No se pudo guardar tu elección de privacidad en este navegador.");
    return false;
  }

  if (allowed) {
    enableAnalytics();
  } else if (typeof window.gtag === "function") {
    window.gtag("consent", "update", {
      analytics_storage: "denied",
    });
  }

  return true;
}

function enableAnalytics() {
  if (typeof window.gtag !== "function") {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
    window.gtag("js", new Date());
  }
  window.gtag("consent", "update", {
    analytics_storage: "granted",
  });
  if (!analyticsConfigured) {
    window.gtag("config", ANALYTICS_ID);
    analyticsConfigured = true;
  }

  if (!document.querySelector(`script[data-rodilloint-analytics="${ANALYTICS_ID}"]`)) {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_ID}`;
    script.dataset.rodillointAnalytics = ANALYTICS_ID;
    document.head.appendChild(script);
  }
}

function closePrivacyModal() {
  const modal = document.getElementById("modal-privacy");
  if (!modal) return;
  modal.classList.remove("active");
  modal.style.display = "none";
}

function openPrivacyModal(isFirstVisit = false) {
  const modal = document.getElementById("modal-privacy");
  const checkbox = document.getElementById("privacy-analytics-consent");
  const closeButton = document.getElementById("btn-privacy-close");
  const title = document.getElementById("privacy-title");
  const eyebrow = document.getElementById("privacy-eyebrow");
  if (!modal || !checkbox || !closeButton || !title || !eyebrow) return;

  const consent = readConsent();
  checkbox.checked = consent?.analytics === true;
  closeButton.hidden = isFirstVisit;
  title.textContent = isFirstVisit
    ? "Bienvenido a RodilloInt"
    : "Privacidad y preferencias";
  eyebrow.textContent = isFirstVisit ? "BIENVENIDA" : "PRIVACIDAD";
  modal.style.display = "flex";
  modal.classList.add("active");
  document.getElementById("btn-privacy-essential")?.focus();
}

export function initPrivacyConsent() {
  const modal = document.getElementById("modal-privacy");
  if (!modal) return;

  const consent = readConsent();
  if (consent?.analytics) enableAnalytics();
  if (!consent) openPrivacyModal(true);

  document.getElementById("btn-open-privacy")?.addEventListener("click", () => {
    openPrivacyModal();
  });
  document.getElementById("btn-settings-privacy")?.addEventListener("click", () => {
    const settings = document.getElementById("modal-settings");
    if (settings) {
      settings.classList.remove("active");
      settings.style.display = "none";
    }
    openPrivacyModal();
  });
  document.getElementById("btn-privacy-close")?.addEventListener("click", closePrivacyModal);
  document.getElementById("btn-privacy-essential")?.addEventListener("click", () => {
    if (setAnalyticsConsent(false)) closePrivacyModal();
  });
  document.getElementById("btn-privacy-accept")?.addEventListener("click", () => {
    if (setAnalyticsConsent(true)) closePrivacyModal();
  });
  document.getElementById("btn-privacy-save")?.addEventListener("click", () => {
    const checkbox = document.getElementById("privacy-analytics-consent");
    if (setAnalyticsConsent(checkbox?.checked === true)) closePrivacyModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !modal.classList.contains("active")) return;
    if (document.getElementById("btn-privacy-close")?.hidden) return;
    closePrivacyModal();
  });
}
