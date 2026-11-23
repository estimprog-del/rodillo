/**
 * settingsAudio.js - Ajustes de audio (Fase 5)
 *   - Checkbox/interruptor de Radio & Podcasts (oculta/muestra 📻).
 *   - Selector de voz de Pinganillo (desplegable de voces con idioma).
 *   - Soporte para futuro multilenguaje: cada option tiene dataset.lang.
 */

import * as raceDirector from "./raceDirector.js";

const LANG_PREF_KEY = "rodilloint_language"; // lenguaje futuro de la app

export function isAudioEnabled() {
  try { return localStorage.getItem("rodilloint_audioEnabled") !== "false"; } catch { return true; }
}

export function setAudioEnabled(enabled) {
  try { localStorage.setItem("rodilloint_audioEnabled", enabled ? "true" : "false"); } catch { /* noop */ }
  updateRadioVisibility();
}

function updateRadioVisibility() {
  // Ocultar/mostrar el widget completo cuando la radio está desactivada
  const widget = document.getElementById("audio-player-widget");
  if (widget) widget.style.display = isAudioEnabled() ? "flex" : "none";
}

function populateVoiceDropdown(force = false) {
  const select = document.getElementById("sett-pinganillo-voice");
  if (!select) return;
  if (!force && select._populated && select.children.length > 0) {
    const savedVoice = localStorage.getItem("rodilloint_pinganillo_voice");
    if (savedVoice && [...select.options].some((o) => o.value === savedVoice)) select.value = savedVoice;
    return;
  }
  const voices = raceDirector.getAllVoices();
  const savedVoice = select.value || localStorage.getItem("rodilloint_pinganillo_voice") || "";
  select.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "Automático (español)";
  select.appendChild(def);
  if (voices.length > 0 || force) {
    for (const v of voices) {
      const o = document.createElement("option");
      o.value = v.name;
      o.textContent = `${v.name} (${v.lang || "es"})`;
      o.dataset.lang = v.lang || "";
      select.appendChild(o);
    }
  }
  if (savedVoice && [...select.options].some((o) => o.value === savedVoice)) select.value = savedVoice;
  select._populated = true;
}

export function filterVoiceDropdownByLang(lang) {
  const select = document.getElementById("sett-pinganillo-voice");
  if (!select) return;
  [...select.options].forEach((o) => { o.hidden = false; });
  if (!lang) return;
  const l = lang.toLowerCase();
  [...select.options].forEach((o) => {
    if (o.value === "") return;
    o.hidden = (o.dataset.lang || "").toLowerCase() !== l;
  });
}

export function initAudioSettings() {
  // 1. Radio & Podcasts toggle
  const toggle = document.getElementById("sett-audio-enabled");
  if (toggle) {
    toggle.checked = isAudioEnabled();
    toggle.addEventListener("change", (e) => setAudioEnabled(e.target.checked));
  }
  updateRadioVisibility();

  // 2. Pinganillo on/off checkbox (misma tarjeta)
  const pingCheck = document.getElementById("sett-pinganillo-checkbox");
  if (pingCheck) {
    pingCheck.checked = raceDirector.isPinganilloActive();
    pingCheck.addEventListener("change", () => {
      raceDirector.togglePinganillo(pingCheck.checked);
    });
  }

  // 2. Voice selector
  const select = document.getElementById("sett-pinganillo-voice");
  const playBtn = document.getElementById("sett-pinganillo-play");
  if (select) {
    select.addEventListener("change", () => {
      const v = select.value;
      if (v) raceDirector.setVoice(v);
      else raceDirector.setVoice("");
    });
  }
  if (playBtn) {
    playBtn.addEventListener("click", () => {
      playBtn.textContent = "🔊";
      playBtn.classList.add("speaking");
      raceDirector.testSpeak();
      setTimeout(() => {
        playBtn.classList.remove("speaking");
        playBtn.textContent = "▶";
      }, 4000);
    });
  }
  populateVoiceDropdown();
  window.speechSynthesis?.addEventListener("voiceschanged", () => { populateVoiceDropdown(true); });
  // Retry if voices not loaded yet (Chrome lazy-loads)
  if (raceDirector.getAllVoices().length === 0) {
    let attempts = 0;
    const retry = () => { if (attempts++ < 15 && raceDirector.getAllVoices().length === 0) setTimeout(retry, 300); };
    retry();
  }
  // Show saved voice + apply it
  const savedVoice = localStorage.getItem("rodilloint_pinganillo_voice");
  if (savedVoice && select) select.value = savedVoice;
  if (savedVoice) raceDirector.setVoice(savedVoice);
}
