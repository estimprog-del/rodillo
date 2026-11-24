/**
 * audioPlayer.js - Reproductor de audio online (Radio / Podcasts) para RodilloInt
 * Controlador singleton basado en HTMLAudioElement. Persiste entre pantallas,
 * gestiona estados (playing/paused/loading/error) y limpia la fuente al cambiar.
 * Solo acepta URLs https:// (evita Mixed Content).
 * Soporta HLS (.m3u8) mediante hls.js cuando está disponible.
 */

import Hls from "hls.js";

const audio = new Audio();

const _state = { playing: false, paused: false, loading: false, error: null };
const _sourceUrl = { current: null };
let _volume = 1;
const _listeners = new Map();

let _hls = null;
let _wantPlay = false;
let _justDragged = false;
let _currentTitle = "";
let _widgetEl = null;
let _pipWindow = null;
let _pipPlaceholder = null;
let _pipOriginalParent = null;
let _pipSavedStyle = null;

function wEl(id) {
  const w = _widgetEl;
  const doc = (w && w.ownerDocument) ? w.ownerDocument : document;
  return doc.getElementById(id);
}

let _radioStations = [];
let _podcastEpisodes = [];
let _currentTab = "radio";
let _radioIndex = -1;
let _podcastIndex = -1;

let _radioFavs = [];
let _podcastFavs = [];
let _showOnlyFavs = false;

function emit(event, payload = {}) {
  const cbs = _listeners.get(event);
  if (!cbs) return;
  for (const cb of [...cbs]) {
    try { cb(payload); } catch (e) { /* noop */ }
  }
}

function setState(patch) {
  _state.playing = !!patch.playing;
  _state.paused = !!patch.paused;
  _state.loading = !!patch.loading;
  _state.error = patch.error ?? null;
  emit("state", { ..._state, sourceUrl: _sourceUrl.current, volume: _volume, title: _currentTitle });
}

function isHttpsUrl(url) {
  try { return typeof url === "string" && url.trim().toLowerCase().startsWith("https://"); } catch { return false; }
}

const FAV_KEY = "rodilloint_audio_favorites";

function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      _radioFavs = Array.isArray(parsed?.radios) && parsed.radios.every((x) => typeof x === "object" && x !== null)
        ? parsed.radios : [];
      _podcastFavs = Array.isArray(parsed?.podcasts) && parsed.podcasts.every((x) => typeof x === "object" && x !== null)
        ? parsed.podcasts : [];
    }
  } catch (e) { _radioFavs = []; _podcastFavs = []; }
}

function saveFavorites() {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify({ radios: _radioFavs, podcasts: _podcastFavs }));
  } catch (e) { /* noop */ }
}

function toggleRadioFav(station) {
  const idx = _radioFavs.findIndex((f) => f.stationuuid === station.stationuuid);
  if (idx >= 0) _radioFavs.splice(idx, 1);
  else _radioFavs.push(station);
  saveFavorites();
}

function togglePodcastFav(ep) {
  const idx = _podcastFavs.findIndex((f) => f.id === ep.id);
  if (idx >= 0) _podcastFavs.splice(idx, 1);
  else _podcastFavs.push(ep);
  saveFavorites();
}

function play() {
  if (_state.error) { setState({ error: null, loading: false }); }
  audio.play().then(() => setState({ playing: true, paused: false, loading: false, error: null }))
    .catch(() => setState({ playing: false, paused: true, loading: false, error: "play-failed" }));
}

function pause() {
  if (audio && !audio.paused) audio.pause();
  setState({ playing: false, paused: true, loading: false });
}

function resume() {
  if (_state.error) { setState({ error: null, loading: false }); }
  return audio.play().then(() => setState({ playing: true, paused: false, loading: false, error: null }))
    .catch(() => setState({ playing: false, paused: true, loading: false, error: "play-failed" }));
}

function isHlsUrl(url) {
  return typeof url === "string" && /\.m3u8(\?|$)/i.test(url);
}

function destroyHls() {
  if (_hls) {
    try { _hls.destroy(); } catch (e) { /* noop */ }
    _hls = null;
  }
}

function setSource(url, forceHls = false) {
  if (!isHttpsUrl(url)) {
    setState({ loading: false, playing: false, error: "invalid-source" });
    return false;
  }
  try { audio.pause(); } catch (e) { /* noop */ }
  destroyHls();
  _sourceUrl.current = url;
  const useHls = forceHls || isHlsUrl(url);
  if (useHls && (Hls.isSupported() || audio.canPlayType("application/vnd.apple.mpegurl"))) {
    if (Hls.isSupported()) {
      _hls = new Hls();
      _hls.loadSource(url);
      _hls.attachMedia(audio);
      _hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setState({ loading: false, playing: false, paused: false, error: null });
        if (_wantPlay) {
          _wantPlay = false;
          audio.play().then(() => setState({ playing: true, paused: false, loading: false, error: null }))
            .catch(() => setState({ playing: false, paused: true, loading: false, error: "play-failed" }));
        }
      });
      _hls.on(Hls.Events.ERROR, (event, data) => {
        if (data && data.fatal) {
          setState({ loading: false, playing: false, paused: true, error: "hls-error" });
        }
      });
    } else {
      // Safari native HLS
      audio.src = url;
      audio.load();
    }
    setState({ loading: true, playing: false, paused: false, error: null });
    return true;
  }
  // Native (MP3/AAC/etc.)
  audio.src = url;
  audio.load();
  setState({ loading: true, playing: false, paused: false, error: null });
  return true;
}

function setVolume(volume) {
  const v = Math.max(0, Math.min(1, Number(volume) || 0));
  _volume = v;
  audio.volume = v;
  setState({ ..._state, volume: v });
  return v;
}

function getState() {
  return { ..._state, sourceUrl: _sourceUrl.current, volume: _volume, title: _currentTitle };
}

function setWidgetTitle(title) {
  _currentTitle = title || "";
  const el = wEl("audio-widget-title");
  if (el) el.textContent = _currentTitle;
  if (el) el.title = _currentTitle;
}

function on(event, cb) {
  if (typeof cb !== "function") return () => {};
  if (!(_listeners.has(event))) _listeners.set(event, new Set());
  const set = _listeners.get(event);
  set.add(cb);
  return () => { set.delete(cb); };
}

function destroy() {
  try { audio.pause(); } catch (e) { /* noop */ }
  destroyHls();
  _listeners.clear();
  _sourceUrl.current = null;
  _state.playing = false;
  _state.paused = false;
  _state.loading = false;
  _state.error = null;
}

export const audioPlayer = { play, pause, resume, setSource, setVolume, getState, on, destroy, stepCurrent, togglePlay };

function makeDraggable(el) {
  if (!el) return;
  let startX = 0, startY = 0, startRight = 0, startBottom = 0, moved = false, active = false;
  el.style.touchAction = "none";
  el.addEventListener("pointerdown", (e) => {
    active = true;
    moved = false;
    startX = e.clientX;
    startY = e.clientY;
    const rect = el.getBoundingClientRect();
    startRight = window.innerWidth - rect.right;
    startBottom = window.innerHeight - rect.bottom;
    const onMove = (ev) => {
      if (!active) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
        moved = true;
        el.classList.add("dragging");
      }
      if (moved) {
        const rect2 = el.getBoundingClientRect();
        const w = rect2.width;
        const h = rect2.height;
        let newRight = startRight - dx;
        let newBottom = startBottom - dy;
        const maxRight = window.innerWidth - w;
        const maxBottom = window.innerHeight - h;
        if (newRight < 0) newRight = 0;
        if (newBottom < 0) newBottom = 0;
        if (newRight > maxRight) newRight = maxRight;
        if (newBottom > maxBottom) newBottom = maxBottom;
        el.style.right = newRight + "px";
        el.style.bottom = newBottom + "px";
        el.style.left = "auto";
        el.style.top = "auto";
      }
    };
    const onUp = (ev) => {
      active = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (moved) {
        ev.preventDefault();
        ev.stopPropagation();
        _justDragged = true;
        setTimeout(() => { _justDragged = false; }, 300);
        try { localStorage.setItem("rodilloint_audio_widget_pos", JSON.stringify({ right: el.style.right, bottom: el.style.bottom })); } catch (err) { /* noop */ }
      }
      el.classList.remove("dragging");
      moved = false;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
  // restore saved position (right/bottom anchored)
  try {
    const raw = localStorage.getItem("rodilloint_audio_widget_pos");
    if (raw) {
      const pos = JSON.parse(raw);
      if (pos && (pos.right || pos.bottom)) {
        el.style.right = pos.right || "16px";
        el.style.bottom = pos.bottom || "16px";
        el.style.left = "auto";
        el.style.top = "auto";
      } else if (pos && pos.left && pos.top) {
        // migrate old left/top saved positions
        const rect = el.getBoundingClientRect();
        const left = parseInt(pos.left, 10);
        const top = parseInt(pos.top, 10);
        el.style.right = Math.max(0, window.innerWidth - left - rect.width) + "px";
        el.style.bottom = Math.max(0, window.innerHeight - top - rect.height) + "px";
        el.style.left = "auto";
        el.style.top = "auto";
      }
    }
  } catch (e) { /* noop */ }
}

function tryAutoAdvance() {
  if (_currentTab === "podcasts" && _podcastEpisodes.length > 0 && _podcastIndex >= 0) {
    const nextIdx = _podcastIndex + 1;
    if (nextIdx < _podcastEpisodes.length) {
      _podcastIndex = nextIdx;
      playPodcastEpisode(_podcastEpisodes[nextIdx]);
      return true;
    }
  }
  if (_currentTab === "radio" && _radioStations.length > 0 && _radioIndex >= 0) {
    const nextIdx = (_radioIndex + 1) % _radioStations.length;
    _radioIndex = nextIdx;
    playRadio(_radioStations[nextIdx]);
    return true;
  }
  return false;
}

export function initAudioPlayer() {
  try {
    loadFavorites();
    audio.preload = "none";
    audio.volume = _volume;
    audio.addEventListener("timeupdate", () => emit("timeupdate", { time: audio.currentTime }));
    audio.addEventListener("ended", () => {
      const advanced = tryAutoAdvance();
      if (!advanced) {
        setState({ playing: false, paused: false, error: null });
      }
    });
    audio.addEventListener("error", () => setState({ loading: false, playing: false, error: "audio-error" }));
  } catch (e) { /* noop */ }

  // --- UI wiring: mini widget + explorador modal ---
  _widgetEl = document.getElementById("audio-player-widget");
  const widget = _widgetEl;
  if (widget) {
    makeDraggable(widget);
    widget.addEventListener("click", (e) => {
      if (_justDragged) { e.preventDefault(); e.stopPropagation(); return; }
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.id === "audio-widget-play") { togglePlay(); }
      else if (btn.id === "audio-widget-explorer") { openExplorer("radio"); }
      else if (btn.id === "audio-widget-toggle") { toggleAudioWidget(); }
      else if (btn.id === "audio-widget-prev") { stepCurrent(-1); }
      else if (btn.id === "audio-widget-next") { stepCurrent(1); }
      else if (btn.id === "audio-widget-pip") { togglePip(); }
    });
    const vol = wEl("audio-widget-volume");
    if (vol) {
      vol.addEventListener("input", () => setVolume(Number(vol.value) / 100));
      vol.value = Math.round(_volume * 100);
    }
    // Mostrar botón PiP solo si la API está disponible
    const pipBtn = wEl("audio-widget-pip");
    if (pipBtn) {
      pipBtn.style.display = ("documentPictureInPicture" in window) ? "" : "none";
    }
  }
  const explorerClose = document.getElementById("btn-audio-explorer-close");
  if (explorerClose) {
    explorerClose.addEventListener("click", () => closeExplorer());
  }

  // Tabs del explorador
  for (const tab of ["radio", "podcasts"]) {
    const tabBtn = document.getElementById(`audio-tab-${tab}`);
    if (tabBtn) {
      tabBtn.addEventListener("click", () => openExplorer(tab));
    }
  }

  const searchBtn = document.getElementById("audio-explorer-search-btn");
  const searchInput = document.getElementById("audio-explorer-search-input");
  const doSearch = () => {
    const q = (searchInput?.value || "").trim();
    if (_currentTab === "radio") loadRadioExplorer(q);
    else loadPodcastsExplorer(q);
  };
  if (searchBtn) searchBtn.addEventListener("click", doSearch);
  if (searchInput) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); doSearch(); }
    });
  }

  const favFilterBtn = document.getElementById("audio-explorer-fav-filter");
  if (favFilterBtn) {
    favFilterBtn.classList.toggle("active", _showOnlyFavs);
    favFilterBtn.addEventListener("click", () => {
      _showOnlyFavs = !_showOnlyFavs;
      favFilterBtn.classList.toggle("active", _showOnlyFavs);
      const q = (searchInput?.value || "").trim();
      if (_currentTab === "radio") loadRadioExplorer(q);
      else loadPodcastsExplorer(q);
    });
  }

  // Listener de estado → aviso en widget si un stream falla + icono play/pause
  audioPlayer.on("state", (s) => {
    const errEl = wEl("audio-widget-error");
    if (errEl) {
      if (s && s.error) {
        errEl.textContent = `Error de audio: ${s.error}`;
        errEl.classList.add("visible");
      } else {
        errEl.classList.remove("visible");
        errEl.textContent = "";
      }
    }
    const playBtn = wEl("audio-widget-play");
    if (playBtn) {
      playBtn.textContent = (s && s.playing) ? "⏸" : "▶";
      playBtn.setAttribute("aria-label", (s && s.playing) ? "Pausar" : "Reproducir");
    }
  });

  return audioPlayer;
}

export function openExplorer(tab = "radio") {
  _currentTab = (tab === "podcasts") ? "podcasts" : "radio";
  const modal = document.getElementById("modal-audio-explorer");
  if (!modal) return;
  modal.style.display = "flex";
  modal.classList.add("active");
  document.querySelectorAll(".audio-explorer-tab").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-audio-tab") === _currentTab);
  });
  if (_currentTab === "radio") loadRadioExplorer();
  else loadPodcastsExplorer();
}

function renderRadioItem(body, s) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "audio-explorer-item";
  btn.setAttribute("data-audio-type", "radio");
  btn.setAttribute("data-audio-uuid", s.stationuuid || "");
  if (s.favicon) {
    const img = document.createElement("img");
    img.src = s.favicon;
    img.alt = "";
    img.className = "audio-explorer-item-img";
    img.loading = "lazy";
    img.onerror = () => { img.style.display = "none"; };
    btn.appendChild(img);
  }
  const info = document.createElement("div");
  info.className = "audio-explorer-item-info";
  const t = document.createElement("span"); t.className = "audio-explorer-item-title"; t.textContent = s.name || "Radio";
  const sub = document.createElement("span"); sub.className = "audio-explorer-item-sub"; sub.textContent = [s.country, s.language, s.codec].filter(Boolean).join(" · ");
  info.append(t, sub);
  const fav = document.createElement("button");
  fav.type = "button";
  fav.className = "audio-explorer-fav" + (_radioFavs.some((f) => f.stationuuid === s.stationuuid) ? " active" : "");
  fav.textContent = _radioFavs.some((f) => f.stationuuid === s.stationuuid) ? "⭐" : "☆";
  fav.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleRadioFav(s);
    const nowFav = _radioFavs.some((f) => f.stationuuid === s.stationuuid);
    fav.textContent = nowFav ? "⭐" : "☆";
    fav.classList.toggle("active", nowFav);
  });
  btn.append(info, fav);
  btn.addEventListener("click", async () => {
    const st = _radioStations.find((x) => x.stationuuid === s.stationuuid);
    if (st) { await playRadio(st); _radioIndex = _radioStations.indexOf(st); closeExplorer(); }
  });
  body.appendChild(btn);
}

export async function loadRadioExplorer(query = "") {
  const body = document.getElementById("audio-explorer-content");
  if (body) body.innerHTML = '<p class="audio-explorer-status">Cargando emisoras...</p>';
  try {
    let stations;
    const q = (query || "").trim();
    if (_showOnlyFavs) {
      stations = [..._radioFavs];
    } else {
      stations = q
        ? await searchRadios(`is_https=true&hidebroken=true&name=${encodeURIComponent(q)}&order=clickcount&limit=50`)
        : await searchTopRadios("ES", 50);
    }
    _radioStations = stations.filter((s) => s && s.url_resolved && isHttpsUrl(s.url_resolved));
    _radioIndex = -1;
    if (body) {
      body.innerHTML = "";
      if (_radioStations.length === 0) {
        body.innerHTML = '<p class="audio-explorer-status">No se encontraron emisoras.</p>';
      } else {
        if (_showOnlyFavs) {
          const favHeader = document.createElement("p");
          favHeader.className = "audio-explorer-status";
          favHeader.textContent = "⭐ Favoritos";
          body.appendChild(favHeader);
        }
        for (const s of _radioStations) renderRadioItem(body, s);
      }
    }
    return stations;
  } catch (e) {
    if (body) body.innerHTML = `<p class="audio-explorer-status">Error al cargar emisoras: ${e?.message || "desconocido"}</p>`;
  }
}

export async function loadPodcastsExplorer(query = "ciclismo") {
  const body = document.getElementById("audio-explorer-content");
  if (body) body.innerHTML = '<p class="audio-explorer-status">Cargando podcasts...</p>';
  try {
    let episodes;
    if (_showOnlyFavs) {
      episodes = [..._podcastFavs];
    } else {
      episodes = await searchPodcasts((query || "ciclismo").trim() || "ciclismo");
    }
    _podcastEpisodes = episodes;
    _podcastIndex = -1;
    if (body) {
      body.innerHTML = "";
      if (!episodes || episodes.length === 0) {
        body.innerHTML = '<p class="audio-explorer-status">No se encontraron podcasts.</p>';
        return episodes;
      }
      for (const ep of episodes) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "audio-explorer-item";
        btn.setAttribute("data-audio-type", "podcast");
        btn.setAttribute("data-audio-idx", String(_podcastEpisodes.indexOf(ep)));
        const imageCol = document.createElement("div");
        imageCol.className = "audio-explorer-item-image";
        if (ep.art) {
          const img = document.createElement("img");
          img.src = ep.art;
          img.alt = "";
          img.className = "audio-explorer-item-img";
          img.loading = "lazy";
          img.onerror = () => { img.style.display = "none"; };
          imageCol.appendChild(img);
        }
        const info = document.createElement("div");
        info.className = "audio-explorer-item-info";
        const t = document.createElement("span"); t.className = "audio-explorer-item-title"; t.textContent = `${ep.podcast} - ${ep.episode}`;
        const sub = document.createElement("span"); sub.className = "audio-explorer-item-sub"; sub.textContent = "";
        info.append(t, sub);
        const dur = formatDuration(ep.duration);
        if (dur) {
          const durEl = document.createElement("span");
          durEl.className = "audio-explorer-item-duration";
          durEl.textContent = dur;
          imageCol.appendChild(durEl);
        }
        btn.appendChild(imageCol);
        const fav = document.createElement("button");
        fav.type = "button";
        fav.className = "audio-explorer-fav" + (_podcastFavs.some((f) => f.id === ep.id) ? " active" : "");
        fav.textContent = _podcastFavs.some((f) => f.id === ep.id) ? "⭐" : "☆";
        fav.addEventListener("click", (e) => {
          e.stopPropagation();
          togglePodcastFav(ep);
          const nowFav = _podcastFavs.some((f) => f.id === ep.id);
          fav.textContent = nowFav ? "⭐" : "☆";
          fav.classList.toggle("active", nowFav);
        });
        btn.append(info, fav);
        btn.addEventListener("click", async () => {
          const e2 = _podcastEpisodes[Number(btn.getAttribute("data-audio-idx"))];
          if (e2) { await playPodcastEpisode(e2); _podcastIndex = Number(btn.getAttribute("data-audio-idx")); closeExplorer(); }
        });
        body.appendChild(btn);
      }
    }
    return episodes;
  } catch (e) {
    if (body) body.innerHTML = `<p class="audio-explorer-status">Error al cargar podcasts: ${e?.message || "desconocido"}</p>`;
  }
}

function stepCurrent(delta) {
  if (_currentTab === "radio") {
    if (_radioStations.length === 0) return false;
    const nextIdx = (_radioIndex < 0 ? 0 : _radioIndex + delta + _radioStations.length) % _radioStations.length;
    _radioIndex = nextIdx;
    return playRadio(_radioStations[nextIdx]);
  }
  if (_currentTab === "podcasts") {
    if (_podcastEpisodes.length === 0) return false;
    const nextIdx = (_podcastIndex < 0 ? 0 : _podcastIndex + delta + _podcastEpisodes.length) % _podcastEpisodes.length;
    _podcastIndex = nextIdx;
    return playPodcastEpisode(_podcastEpisodes[nextIdx]);
  }
  return false;
}

export function closeExplorer() {
  const modal = document.getElementById("modal-audio-explorer");
  if (modal) { modal.style.display = "none"; modal.classList.remove("active"); }
}

export function togglePlay() {
  if (_state.playing) { pause(); return false; }
  return resume();
}

export function toggleAudioWidget() {
  const widget = _widgetEl || document.getElementById("audio-player-widget");
  if (!widget) return;
  const collapsed = widget.classList.toggle("collapsed");
  const toggle = wEl("audio-widget-toggle");
  if (toggle) toggle.textContent = collapsed ? "📻" : "×";
  if (collapsed) closeExplorer();
}

export function hideAudioWidget() {
  const widget = _widgetEl || document.getElementById("audio-player-widget");
  if (widget) widget.style.display = "none";
}

export function showAudioWidget() {
  const widget = _widgetEl || document.getElementById("audio-player-widget");
  if (widget) widget.style.display = "flex";
}

// --- Picture-in-Picture (Document PiP) ---
export async function togglePip() {
  if (!("documentPictureInPicture" in window)) return;
  if (_pipWindow) {
    try { _pipWindow.close(); } catch (e) { /* noop */ }
    return;
  }
  await enterPip();
}

async function enterPip() {
  if (!("documentPictureInPicture" in window)) return;
  const widget = _widgetEl;
  if (!widget) return;
  try {
    const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 400, height: 110 });
    _pipWindow = pipWindow;
    // Copiar estilos del documento principal (hrefs absolutos para que carguen en about:blank)
    [...document.querySelectorAll('link[rel="stylesheet"], style')].forEach((node) => {
      try {
        if (node.tagName === "LINK") {
          const clone = node.cloneNode(true);
          const href = clone.getAttribute("href");
          if (href) clone.setAttribute("href", new URL(href, location.href).href);
          pipWindow.document.head.appendChild(clone);
        } else {
          pipWindow.document.head.appendChild(node.cloneNode(true));
        }
      } catch (e) { /* noop */ }
    });
    // Fondo oscuro en el body del PiP
    pipWindow.document.body.style.background = "#0b1410";
    pipWindow.document.body.style.margin = "0";
    pipWindow.document.body.style.display = "flex";
    pipWindow.document.body.style.alignItems = "center";
    pipWindow.document.body.style.justifyContent = "center";
    pipWindow.document.body.style.height = "100vh";
    // Guardar estilos inline del widget y resetear para el PiP
    _pipSavedStyle = {
      position: widget.style.position,
      left: widget.style.left,
      top: widget.style.top,
      right: widget.style.right,
      bottom: widget.style.bottom,
      display: widget.style.display,
    };
    widget.style.position = "static";
    widget.style.left = "";
    widget.style.top = "";
    widget.style.right = "";
    widget.style.bottom = "";
    widget.style.display = "flex";
    // Placeholder para restaurar la posición
    _pipOriginalParent = widget.parentNode;
    _pipPlaceholder = document.createElement("div");
    _pipPlaceholder.id = "audio-widget-placeholder";
    _pipPlaceholder.style.display = "none";
    if (_pipOriginalParent) _pipOriginalParent.insertBefore(_pipPlaceholder, widget);
    // Mover el widget al body del PiP
    pipWindow.document.body.appendChild(widget);
    // Ocultar el botón de desacoplar mientras está en PiP
    const pipBtn = wEl("audio-widget-pip");
    if (pipBtn) pipBtn.style.display = "none";
    // Restaurar al cerrar
    pipWindow.addEventListener("pagehide", () => {
      restoreWidget();
    });
  } catch (e) {
    _pipWindow = null;
    _pipPlaceholder = null;
    _pipOriginalParent = null;
    _pipSavedStyle = null;
  }
}

function restoreWidget() {
  const widget = _widgetEl;
  if (!widget) return;
  if (_pipPlaceholder && _pipPlaceholder.parentNode) {
    _pipPlaceholder.parentNode.insertBefore(widget, _pipPlaceholder);
    _pipPlaceholder.remove();
  } else if (_pipOriginalParent) {
    _pipOriginalParent.appendChild(widget);
  }
  // Restaurar estilos inline
  if (_pipSavedStyle) {
    widget.style.position = _pipSavedStyle.position;
    widget.style.left = _pipSavedStyle.left;
    widget.style.top = _pipSavedStyle.top;
    widget.style.right = _pipSavedStyle.right;
    widget.style.bottom = _pipSavedStyle.bottom;
    widget.style.display = _pipSavedStyle.display || "flex";
    _pipSavedStyle = null;
  }
  _pipPlaceholder = null;
  _pipOriginalParent = null;
  _pipWindow = null;
  const pipBtn = wEl("audio-widget-pip");
  if (pipBtn && ("documentPictureInPicture" in window)) pipBtn.style.display = "";
}

// --- Fase 3: fuentes de datos (Radio Browser + Podcasts) ---

const RADIO_PRIMARY = "https://de1.api.radio-browser.info";
const RADIO_FALLBACK = "https://at1.api.radio-browser.info";

export async function searchTopRadios(countryCode = "ES", limit = 50) {
  const params = `limit=${limit}&countrycode=${countryCode}&hidebroken=true`;
  const urls = [
    `${RADIO_PRIMARY}/json/stations/topclick?${params}`,
    `${RADIO_FALLBACK}/json/stations/topclick?${params}`,
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const stations = Array.isArray(data) ? data : [];
      const usable = stations
        .filter((s) => s && s.url_resolved && isHttpsUrl(s.url_resolved))
        .map((s) => ({ ...s, url: s.url_resolved || s.url }));
      return usable;
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error("No se pudo cargar el top de radios.");
}

export async function searchRadios(params = "is_https=true&hidebroken=true&order=clickcount&reverse=true&limit=30") {
  const urls = [
    `${RADIO_PRIMARY}/json/stations/search?${params}`,
    `${RADIO_FALLBACK}/json/stations/search?${params}`,
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const stations = Array.isArray(data) ? data : [];
      const usable = stations
        .filter((s) => s && s.url_resolved && isHttpsUrl(s.url_resolved))
        .map((s) => ({ ...s, url: s.url_resolved || s.url }));
      return usable;
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error("No se pudo cargar la lista de radios.");
}

export async function playRadio(station) {
  // Click tracking: fire-and-forget para no perder el gesto de usuario
  fetch(`${RADIO_PRIMARY}/json/url/${station.stationuuid}`, { method: "GET" }).catch(() => {});
  const url = station.url_resolved || station.url;
  setWidgetTitle(station.name || "Radio");
  const isHls = station.hls === 1 || isHlsUrl(url);
  _wantPlay = true;
  const ok = setSource(url, isHls);
  if (ok && !isHls) play();
  return ok;
}

export async function searchPodcasts(query = "fitness", limit = 20) {
  const term = encodeURIComponent(query);
  const url = `https://itunes.apple.com/search?term=${term}&entity=podcastEpisode&limit=${limit}&country=es`;
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);
  const data = await res.json();
  const results = Array.isArray(data?.results) ? data.results : [];
  const out = [];
  for (const r of results) {
    // iTunes devuelve episodeUrl (URL directa del MP3) para podcastEpisode
    const audioUrl = (typeof r.episodeUrl === "string" && r.episodeUrl.startsWith("https://")) ? r.episodeUrl : null;
    const ms = typeof r.trackTimeMillis === "number" ? r.trackTimeMillis : 0;
    out.push({
      id: r.trackId ?? r.collectionId ?? null,
      podcast: r.collectionName || r.artistName || "Podcast",
      episode: r.trackName || "Episodio",
      art: r.artworkUrl100 || r.artworkUrl600 || null,
      audioUrl,
      duration: ms > 0 ? ms : null,
    });
  }
  return out;
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return "";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export async function playPodcastEpisode(episode) {
  if (!episode || !episode.audioUrl) { setState({ error: "invalid-source" }); return false; }
  setWidgetTitle(episode.episode || episode.podcast || "Podcast");
  _wantPlay = true;
  const ok = setSource(episode.audioUrl, isHlsUrl(episode.audioUrl));
  if (ok && !isHlsUrl(episode.audioUrl)) play();
  return ok;
}

initAudioPlayer();
