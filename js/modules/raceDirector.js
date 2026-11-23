/**
 * raceDirector.js - Pinganillo (Director de Equipo por Voz)
 * Implementation using window.speechSynthesis (native, no API keys).
 * Audio Ducking integration with audioPlayer.
 * Cooldowns and priority for urgent announcements.
 */

import { audioPlayer } from "./audioPlayer.js";

const MAX_COOLDOWN_MS = 60000; // 60s cooldown

let _isActive = true; // activo por defecto
let _hasWelcomed = false;
let _lastSpeak = 0;
let _savedVolume = null;
let _ducking = false;
let _forcedVoiceName = null;

export function isPinganilloActive() {
  return _isActive;
}

export function getAllVoices() {
  if (typeof window.speechSynthesis === "undefined") return [];
  return window.speechSynthesis.getVoices();
}

export function setVoice(name) {
  if (name) {
    _forcedVoiceName = name;
    try { localStorage.setItem("rodilloint_pinganillo_voice", name); } catch (e) { /* noop */ }
  } else {
    _forcedVoiceName = null;
    try { localStorage.removeItem("rodilloint_pinganillo_voice"); } catch (e) { /* noop */ }
  }
}

function loadSavedVoice() {
  if (typeof window.speechSynthesis === "undefined") return;
  const saved = localStorage.getItem("rodilloint_pinganillo_voice");
  if (saved && getAllVoices().some((v) => v.name === saved)) setVoice(saved);
}

function getVoice() {
  if (typeof window.speechSynthesis === "undefined") return null;
  const voices = window.speechSynthesis.getVoices();
  if (_forcedVoiceName) {
    const forced = voices.find((v) => v.name === _forcedVoiceName);
    if (forced) return forced;
  }
  const esVoice = voices.find((v) => v.lang === "es-ES");
  const fallback = voices.find((v) => v.lang === "es") || voices[0];
  return esVoice || fallback || null;
}

function updateButtonState() {
  const btn = document.getElementById("btn-pinganillo");
  if (!btn) return;
  btn.classList.toggle("active", _isActive);
  btn.textContent = _isActive ? "🔊" : "🎙️";
  btn.setAttribute("aria-pressed", _isActive ? "true" : "false");
  btn.title = _isActive ? "Pinganillo activado" : "Activar Pinganillo";
}

function speakInternal(text, priority) {
  if (typeof window.speechSynthesis === "undefined") return false;

  // Cooldown for non-priority speaks (avoid overloading the rider)
  const now = Date.now();
  if (!priority && now - _lastSpeak < MAX_COOLDOWN_MS) return false;

  // Priority: cancel ongoing utterances
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = getVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || "es-ES";
  } else {
    utterance.lang = "es-ES";
  }
  utterance.rate = 1.05;
  utterance.pitch = 0.9;
  utterance.volume = 1;

  // Audio Ducking: baja el volumen de radio/podcast al comenzar el speak (si hay reproducción activa)
  utterance.onstart = () => {
    const state = audioPlayer.getState();
    if (state.playing && !_ducking) {
      _savedVolume = state.volume;
      _ducking = true;
      audioPlayer.setVolume(0.25);
    }
  };

  // Restaura volumen cuando termine el último utterance (o se cancelled)
  utterance.onend = () => restoreVolume();
  utterance.onerror = () => restoreVolume();

  _lastSpeak = now;
  window.speechSynthesis.speak(utterance);
  return true;
}

function restoreVolume() {
  try {
    if (_ducking && !window.speechSynthesis.isSpeaking()) {
      if (_savedVolume !== null) {
        audioPlayer.setVolume(_savedVolume);
      }
      _savedVolume = null;
      _ducking = false;
    }
  } catch (e) { /* noop */ }
}

export function speak(text, options = {}) {
  if (!_isActive) return false;
  return speakInternal(text, options.priority === true);
}

/**
 * Reproduce un texto de prueba aunque Pinganillo esté desactivado.
 * Usa la voz forzada si hay una seleccionada en Ajustes.
 */
export function testSpeak(text = "Pinganillo: prueba de voz, ¿recuerdo el nombre de la ruta?", options = {}) {
  return speakInternal(text, true); // Prioridad: permite repetir reproduce al instante sin esperas de cooldown
}

export async function togglePinganillo(force) {
  _isActive = force !== undefined ? !!force : !_isActive;
  updateButtonState();

  if (_isActive) {
    setEnableState(true);
    // On first activation, speak a brief welcome to test voice
    if (!_hasWelcomed) {
      _hasWelcomed = true;
      speakInternal("Pinganillo conectado, listo para rodar.", true);
    }
  } else {
    window.speechSynthesis.cancel();
    restoreVolume();
    setEnableState(false);
  }
  return _isActive;
}

function setEnableState(val) {
  try { localStorage.setItem("rodilloint_pinganillo_enabled", val ? "true" : "false"); } catch (e) { /* noop */ }
}

function loadEnableState() {
  try {
    const v = localStorage.getItem("rodilloint_pinganillo_enabled");
    if (v !== null) {
      _isActive = v === "true";
    }
  } catch (e) { /* noop */ }
}

export function initPinganillo() {
  loadEnableState();
  updateButtonState();
  const btn = document.getElementById("btn-pinganillo");
  if (btn) btn.addEventListener("click", () => togglePinganillo());
}

initPinganillo();
