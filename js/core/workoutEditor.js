import { state, saveStateToLocalStorage } from "../modules/state.js";
import { showToast } from "../modules/toast.js";
import {
  parseWorkoutFile,
  saveUserWorkout,
  getAllWorkouts,
  formatDuration,
  renderWorkoutThumbnailSvg,
  serializeWorkoutAsZwo,
} from "./workoutLibrary.js";

export function createWorkoutEditorController({ refreshLibrary }) {
  let editorMode = "create";
  let editorSourceId = null;
  let editorUnit = "ftp";

  function exportWorkoutAsZwo(workout) {
    try {
      const xml = serializeWorkoutAsZwo({
        ...workout,
        author: workout.author || state.currentUser?.name || "RodilloInt",
      }, state.currentUser?.ftp);
      const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = String(workout.name || "entrenamiento")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
        .trim() || "entrenamiento";
      link.href = url;
      link.download = `${safeName}.zwo`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      showToast(`Entrenamiento exportado: ${safeName}.zwo`, "success");
    } catch (error) {
      console.error("No se pudo exportar el entrenamiento ZWO:", error);
      showToast("No se pudo exportar el entrenamiento.", "error");
    }
  }

  function addWorkoutEditorGroup({ repeat = 1, steps = [] } = {}) {
    const container = document.getElementById("workout-editor-steps");
    if (!container) return null;
    const group = document.createElement("section");
    group.className = "workout-editor-group";
    group.innerHTML = `
      <div class="workout-editor-group-header">
        <label>Repetir este grupo
          <input data-workout-group-repeat type="number" min="1" max="50" step="1" value="${repeat}" required />
        </label>
        <button class="btn btn-dark btn-sm workout-editor-remove-group" type="button" aria-label="Eliminar grupo">Eliminar grupo</button>
      </div>
      <div class="workout-editor-group-steps"></div>
      <button class="btn btn-dark btn-sm workout-editor-add-group-step" type="button">＋ Añadir bloque al grupo</button>
    `;
    container.append(group);
    const stepContainer = group.querySelector(".workout-editor-group-steps");
    steps.forEach((step) => addWorkoutEditorStep(step, stepContainer));
    return group;
  }

  function addWorkoutEditorStep(step = {}, groupSteps = null) {
    const container = groupSteps || addWorkoutEditorGroup()?.querySelector(".workout-editor-group-steps");
    if (!container) return;
    const durationSecondsValue = Number(step.durationSeconds);
    const durationSeconds = Number.isFinite(durationSecondsValue) && durationSecondsValue > 0
      ? Math.round(durationSecondsValue)
      : 300;
    const powerStartValue = Number(step.powerStart);
    const powerStart = Number.isFinite(powerStartValue) ? powerStartValue : 60;
    const powerEndValue = Number(step.powerEnd ?? step.powerStart);
    const powerEnd = Number.isFinite(powerEndValue) ? powerEndValue : powerStart;
    const cadenceValue = Number(step.cadence);
    const cadence = Number.isFinite(cadenceValue) ? cadenceValue : "";
    const row = document.createElement("div");
    row.className = "workout-editor-step";
    row.innerHTML = `
      <label>Tipo
        <select data-workout-field="type">
          <option value="warmup">Calentamiento</option>
          <option value="steady">Sostenido</option>
          <option value="interval">Intervalo</option>
          <option value="ramp">Rampa</option>
          <option value="cooldown">Recuperación</option>
        </select>
      </label>
      <label>Duración (min)
        <input data-workout-field="minutes" type="number" min="0" max="600" step="1" value="${Math.floor(durationSeconds / 60)}" />
      </label>
      <label>Segundos
        <input data-workout-field="seconds" type="number" min="0" max="59" step="1" value="${durationSeconds % 60}" />
      </label>
      <label><span class="workout-editor-power-start-label">Potencia inicial</span>
        <input data-workout-field="powerStart" type="number" min="0" max="1200" step="1" value="${powerStart}" required />
      </label>
      <label><span class="workout-editor-power-end-label">Potencia final</span>
        <input data-workout-field="powerEnd" type="number" min="0" max="1200" step="1" value="${powerEnd}" required />
      </label>
      <label>Cadencia rpm
        <input data-workout-field="cadence" type="number" min="0" max="200" step="1" placeholder="Opcional" value="${cadence}" />
      </label>
      <button class="btn btn-dark btn-sm workout-editor-remove" type="button" aria-label="Eliminar bloque">✕</button>
    `;
    const typeInput = row.querySelector('[data-workout-field="type"]');
    if (typeInput) typeInput.value = step.type || "steady";
    container.append(row);
    updateWorkoutEditorUnitLabels();
    updateWorkoutEditorPreview();
  }

  function getWorkoutEditorSteps() {
    const unit = document.getElementById("workout-editor-unit")?.value || "ftp";
    const steps = [];
    document.querySelectorAll("#workout-editor-steps .workout-editor-group").forEach((group) => {
      const repeat = Math.max(1, Math.min(50, Math.trunc(Number(group.querySelector("[data-workout-group-repeat]")?.value) || 1)));
      const groupSteps = [...group.querySelectorAll(".workout-editor-step")].map((row) => {
        const value = (field) => row.querySelector(`[data-workout-field="${field}"]`)?.value;
        const durationSeconds = Number(value("minutes")) * 60 + Number(value("seconds"));
        const rawStart = Number(value("powerStart"));
        const rawEnd = Number(value("powerEnd"));
        const rawCadence = value("cadence");
        return {
          type: value("type"),
          durationSeconds,
          powerStart: unit === "ftp" ? rawStart / 100 : rawStart,
          powerEnd: unit === "ftp" ? rawEnd / 100 : rawEnd,
          cadence: rawCadence === "" ? undefined : Number(rawCadence),
        };
      });
      for (let repetition = 0; repetition < repeat; repetition++) {
        groupSteps.forEach((step) => steps.push({
          ...step,
          id: `step-${steps.length + 1}`,
        }));
      }
    });
    return steps;
  }

  function updateWorkoutEditorPreview() {
    const steps = getWorkoutEditorSteps();
    const chart = document.getElementById("workout-editor-chart");
    const summary = document.getElementById("workout-editor-summary");
    if (!chart || !summary) return;
    const totalDurationSeconds = steps.reduce((total, step) => total + (step.durationSeconds || 0), 0);
    const previewWorkout = { steps, totalDurationSeconds };
    chart.innerHTML = steps.length
      ? renderWorkoutThumbnailSvg(previewWorkout, state.currentUser?.ftp || 200, 640, 100)
      : "";
    summary.textContent = `${steps.length} bloques · ${formatDuration(totalDurationSeconds)}`;
  }

  function updateWorkoutEditorUnitLabels() {
    const suffix = editorUnit === "watts" ? "(W)" : "(% FTP)";
    document.querySelectorAll(".workout-editor-power-start-label").forEach((label) => {
      label.textContent = `Potencia inicial ${suffix}`;
    });
    document.querySelectorAll(".workout-editor-power-end-label").forEach((label) => {
      label.textContent = `Potencia final ${suffix}`;
    });
  }

  function changeWorkoutEditorUnit(nextUnit) {
    if (nextUnit === editorUnit) return;
    const ftp = Number(state.currentUser?.ftp) > 30 ? Number(state.currentUser.ftp) : 200;
    const multiplier = editorUnit === "ftp" ? ftp / 100 : 100 / ftp;
    document.querySelectorAll("#workout-editor-steps .workout-editor-step").forEach((row) => {
      ["powerStart", "powerEnd"].forEach((field) => {
        const input = row.querySelector(`[data-workout-field="${field}"]`);
        if (input && input.value !== "") {
          input.value = String(Math.round(Number(input.value) * multiplier * 10) / 10);
        }
      });
    });
    editorUnit = nextUnit;
    updateWorkoutEditorUnitLabels();
    updateWorkoutEditorPreview();
  }

  function openWorkoutEditor(workout = null, mode = "create") {
    const editor = document.getElementById("workout-editor");
    const rows = document.getElementById("workout-editor-steps");
    if (!editor || !rows) return;
    editorMode = mode;
    editorSourceId = mode === "edit" ? workout?.id || null : null;
    editor.hidden = false;
    rows.replaceChildren();
    const isEditing = mode === "edit";
    const canUseFtp = workout?.steps?.every((step) =>
      Number(step.powerStart) <= 3 &&
      Number(step.powerEnd ?? step.powerStart) <= 3
    ) ?? true;
    document.getElementById("workout-editor-title").textContent = isEditing
      ? "Editar entrenamiento"
      : mode === "copy" ? "Crear copia de entrenamiento" : "Crear entrenamiento";
    document.getElementById("btn-save-created-workout").textContent = isEditing
      ? "Guardar cambios"
      : mode === "copy" ? "Guardar copia" : "Guardar entrenamiento";
    document.getElementById("workout-editor-name").value = mode === "copy" && workout
      ? `${workout.name} (copia)`
      : workout?.name || "";
    document.getElementById("workout-editor-description").value = workout?.description || "";
    editorUnit = canUseFtp ? "ftp" : "watts";
    document.getElementById("workout-editor-unit").value = editorUnit;
    if (workout?.steps?.length) {
      workout.steps.forEach((step) => {
        const factor = canUseFtp ? 100 : 1;
        addWorkoutEditorStep({
          ...step,
          powerStart: Number(step.powerStart) * factor,
          powerEnd: Number(step.powerEnd ?? step.powerStart) * factor,
        });
      });
    } else {
      addWorkoutEditorStep({ type: "warmup", durationSeconds: 300, powerStart: 50, powerEnd: 70 });
      addWorkoutEditorStep({ type: "steady", durationSeconds: 600, powerStart: 85, powerEnd: 85 });
      addWorkoutEditorStep({ type: "cooldown", durationSeconds: 300, powerStart: 60, powerEnd: 45 });
    }
    updateWorkoutEditorUnitLabels();
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeWorkoutEditor() {
    const editor = document.getElementById("workout-editor");
    if (editor) editor.hidden = true;
    editorMode = "create";
    editorSourceId = null;
  }

  function saveCreatedWorkout() {
    const saveMode = editorMode;
    const nameInput = document.getElementById("workout-editor-name");
    const editor = document.getElementById("workout-editor");
    const name = nameInput?.value.trim();
    const steps = getWorkoutEditorSteps();
    const isFtpUnit = document.getElementById("workout-editor-unit")?.value === "ftp";
    if (!name) {
      showToast("Escribe un nombre para el entrenamiento.", "warning");
      nameInput?.focus();
      return;
    }
    const invalidInput = [...(editor?.querySelectorAll("input") || [])].find((input) => !input.checkValidity());
    if (invalidInput) {
      invalidInput.reportValidity();
      return;
    }
    if (steps.length === 0 || steps.some((step) =>
      !Number.isFinite(step.durationSeconds) || step.durationSeconds <= 0 ||
      !Number.isFinite(step.powerStart) || !Number.isFinite(step.powerEnd) ||
      step.powerStart < 0 || step.powerEnd < 0 ||
      (isFtpUnit && (step.powerStart > 3 || step.powerEnd > 3)) ||
      (!isFtpUnit && (step.powerStart > 1200 || step.powerEnd > 1200)) ||
      (step.cadence !== undefined && (!Number.isFinite(step.cadence) || step.cadence < 0 || step.cadence > 200))
    )) {
      showToast("Revisa los bloques: cada uno debe tener duración y potencias válidas.", "warning");
      return;
    }

    const totalDurationSeconds = steps.reduce((total, step) => total + step.durationSeconds, 0);
    const existingWorkout = saveMode === "edit"
      ? getAllWorkouts("user").find((workout) => workout.id === editorSourceId)
      : null;
    if (saveMode === "edit" && !existingWorkout) {
      showToast("No se encontró el entrenamiento que intentas editar.", "error");
      closeWorkoutEditor();
      return;
    }
    const workout = {
      id: existingWorkout?.id || `custom-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`,
      name,
      description: document.getElementById("workout-editor-description")?.value.trim() || "Entrenamiento creado en Rodillo Interactivo Ciclismo.",
      author: existingWorkout?.author || state.currentUser?.name || "Usuario",
      totalDurationSeconds,
      steps,
    };
    try {
      saveUserWorkout(workout);
      if (saveMode !== "edit" || state.currentWorkout?.id === workout.id) {
        state.currentWorkout = workout;
      }
      if (saveMode !== "edit") state.currentMode = "ERG";
      saveStateToLocalStorage();
      closeWorkoutEditor();
      refreshLibrary("user");
      showToast(
        saveMode === "edit"
          ? `Entrenamiento actualizado: ${workout.name}`
          : saveMode === "copy"
            ? `Copia creada: ${workout.name}`
            : `Entrenamiento creado: ${workout.name}`,
        "success",
      );
    } catch (error) {
      console.error("No se pudo guardar el entrenamiento creado:", error);
      showToast("No se pudo guardar el entrenamiento. Comprueba el espacio disponible en el navegador.", "error");
    }
  }

  async function handleWorkoutFileImport(event) {
    const file = event.target?.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const workout = parseWorkoutFile(text, file.name);
      saveUserWorkout(workout);
      state.currentWorkout = workout;
      state.currentMode = "ERG";
      state.connectionsReturnScreen = "workouts";
      saveStateToLocalStorage();
      showToast(`Entrenamiento importado: ${workout.name}`, "success");
      refreshLibrary("user");
    } catch (error) {
      console.error("No se pudo importar el entrenamiento:", error);
      showToast(error?.message || "No se pudo importar el entrenamiento.", "error");
    } finally {
      event.target.value = "";
    }
  }

  function bindEvents() {
    document.getElementById("workout-library-filter")?.addEventListener("change", (event) => {
      refreshLibrary(event.target.value);
    });
    document.getElementById("workout-file-input")?.addEventListener("change", handleWorkoutFileImport);
    document.getElementById("btn-create-workout")?.addEventListener("click", () => openWorkoutEditor());
    document.getElementById("btn-close-workout-editor")?.addEventListener("click", closeWorkoutEditor);
    document.getElementById("btn-cancel-workout-editor")?.addEventListener("click", closeWorkoutEditor);
    document.getElementById("btn-add-workout-step")?.addEventListener("click", () => addWorkoutEditorStep());
    document.getElementById("btn-save-created-workout")?.addEventListener("click", saveCreatedWorkout);
    document.getElementById("workout-editor-unit")?.addEventListener("change", (event) => {
      changeWorkoutEditorUnit(event.target.value);
    });
    document.getElementById("workout-editor-steps")?.addEventListener("input", updateWorkoutEditorPreview);
    document.getElementById("workout-editor-steps")?.addEventListener("change", updateWorkoutEditorPreview);
    document.getElementById("workout-editor-steps")?.addEventListener("click", (event) => {
      const target = event.target;
      if (target.closest(".workout-editor-remove-group")) {
        target.closest(".workout-editor-group")?.remove();
        updateWorkoutEditorPreview();
      } else if (target.closest(".workout-editor-remove")) {
        const group = target.closest(".workout-editor-group");
        target.closest(".workout-editor-step")?.remove();
        if (group && !group.querySelector(".workout-editor-step")) group.remove();
        updateWorkoutEditorPreview();
      } else if (target.closest(".workout-editor-add-group-step")) {
        addWorkoutEditorStep({}, target.closest(".workout-editor-group")?.querySelector(".workout-editor-group-steps"));
      }
    });
    document.getElementById("btn-add-workout-repeat")?.addEventListener("click", () => {
      const workPower = editorUnit === "ftp" ? 100 : Math.round((state.currentUser?.ftp || 200) * 1.0);
      const recoveryPower = editorUnit === "ftp" ? 50 : Math.round((state.currentUser?.ftp || 200) * 0.5);
      addWorkoutEditorGroup({
        repeat: 3,
        steps: [
          { type: "interval", durationSeconds: 120, powerStart: workPower, powerEnd: workPower },
          { type: "interval", durationSeconds: 120, powerStart: recoveryPower, powerEnd: recoveryPower },
        ],
      });
    });
  }

  return {
    exportWorkoutAsZwo,
    openWorkoutEditor,
    bindEvents,
  };
}
