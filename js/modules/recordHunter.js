/**
 * recordHunter.js - Cazador de Récords en segundo plano (Mean Maximal Power)
 * Array circular de samples de power de la sesión; evalúa MAs:
 * 5s (Sprint), 60s (Anaeróbico), 5min (VO2Max), 20min (FTP).
 * Si supera el mejor historico guardado en DBManager: guarda nuevo record y
 * lanza alerta sonora discreta + aviso al final de la sesión.
 */

import { DbManager } from "../db.js";
import { showToast } from "./toast.js";
import { playWorkoutBeep } from "../core/workoutEngine.js";

const RECORD_TYPES = [
  { key: "sprint_5s", windowSec: 5, minSamples: 5, label: "Sprint 5s" },
  { key: "anaerobic_1min", windowSec: 60, minSamples: 60, label: "Anaeróbico 1min" },
  { key: "vo2max_5m", windowSec: 300, minSamples: 300, label: "VO2Max 5min" },
  { key: "ftp_20m", windowSec: 1200, minSamples: 1200, label: "FTP 20min" },
];

let _userId = null;
let _active = false;
let _samples = [];          // [{ value, ts }] samples of the session (in memory)
let _bestByType = {};       // best per type loaded from DB at session start
let _newRecords = [];       // new records beat during the session

export function isRecordHunterActive() {
  return _active;
}

export const recordHunter = {
  isActive: isRecordHunterActive,
  getBestRecords,
  startSession,
  update,
  stopSession,
};

export function getBestRecords() {
  return { ..._bestByType };
}

function computeMA(n) {
  if (_samples.length < n) return null;
  const window = _samples.slice(-n);
  return Math.round(window.reduce((a, b) => a + b, 0) / window.length);
}

export function startSession(userId) {
  if (!userId) return;
  _userId = userId;
  _active = true;
  _samples = [];
  _newRecords = [];
  DbManager.getBestRecords(userId)
    .then((recs) => {
      const bests = {};
      for (const r of recs) bests[r.type] = Math.max(bests[r.type] ?? 0, r.value);
      _bestByType = bests;
    })
    .catch(() => { _bestByType = {}; });
}

export function update(power) {
  if (!_active) return;
  const p = Math.max(0, Math.round(Number(power) || 0));
  _samples.push({ value: p, ts: Date.now() });

  // bound buffer memory (max of any window + margin)
  const maxSamples = Math.max(...RECORD_TYPES.map((t) => t.minSamples));
  if (_samples.length > maxSamples) _samples.splice(0, _samples.length - maxSamples);

  for (const type of RECORD_TYPES) {
    const ma = computeMA(type.minSamples);
    if (ma === null) continue;
    const best = _bestByType[type.key] ?? 0;
    if (ma > best) {
      _bestByType[type.key] = ma;
      _newRecords.push({ type: type.key, value: ma });
      // Save immediately to DB
      if (_userId) DbManager.saveRecord(_userId, type.key, ma).catch(() => {});
    }
  }
}

export function stopSession() {
  if (!_active) return;
  _active = false;
  const newRecords = _newRecords;
  _newRecords = [];
  _samples = [];

  if (newRecords.length > 0) {
    // Alerta sonora discreta
    try { playWorkoutBeep(740, 0.25, 0.3); } catch (e) { /* noop */ }
    const parts = newRecords.map((r) => {
      const t = RECORD_TYPES.find((x) => x.key === r.type);
      return `${t?.label ?? r.type}: ${r.value} W`;
    });
    showToast(`🏆 Nuevo(s) récords!!! ${parts.join(", ")}`, "success", 6000);
  }
}
