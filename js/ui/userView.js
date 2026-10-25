// js/ui/userView.js - Gestión de perfiles de usuario
import { DbManager } from "../db.js";
import { state, loadWorkoutLayoutForUser } from "../modules/state.js";
import { hideModal } from "../modules/ui.js";
import { showToast, showConfirm } from "../modules/toast.js";
import { loadDashboardHeader } from "./dashboard.js";
import { processAvatarImage } from "../utils/imageUtils.js";

let _navigateTo = null;
let newAvatarDataUrl = null;
let editAvatarDataUrl = null;

export function initUserView({ navigateTo }) {
  _navigateTo = navigateTo;
  initAvatarUploadControls();
}

/**
 * Resetea los controles del modal de añadir perfil
 */
export function resetAddUserAvatar() {
  newAvatarDataUrl = null;
  const fileInput = document.getElementById("new-user-avatar-input");
  if (fileInput) fileInput.value = "";
  const preview = document.getElementById("new-user-avatar-preview");
  if (preview) {
    preview.innerHTML = '<span class="avatar-preview-placeholder">👤</span>';
  }
  const removeBtn = document.getElementById("new-user-avatar-remove");
  if (removeBtn) removeBtn.style.display = "none";
}

/**
 * Prepara los controles del modal de editar perfil con la foto actual del usuario
 */
export function prepareEditUserAvatar() {
  const u = state.currentUser;
  editAvatarDataUrl = u?.avatarUrl || u?.imageUri || null;

  const fileInput = document.getElementById("edit-user-avatar-input");
  if (fileInput) fileInput.value = "";

  const preview = document.getElementById("edit-user-avatar-preview");
  const removeBtn = document.getElementById("edit-user-avatar-remove");

  if (preview) {
    if (editAvatarDataUrl) {
      preview.innerHTML = `<img src="${editAvatarDataUrl}" alt="${u?.name || 'Avatar'}" class="avatar-img" />`;
    } else {
      const initials = (u?.name || "")
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase();
      preview.innerHTML = `<span class="avatar-preview-placeholder">${initials || "👤"}</span>`;
    }
  }

  if (removeBtn) {
    removeBtn.style.display = editAvatarDataUrl ? "inline-flex" : "none";
  }
}

/**
 * Inicializa los eventos para la carga de avatar (input file, preview, remove)
 */
function initAvatarUploadControls() {
  // 1. Modal Añadir Usuario
  const newFileInput = document.getElementById("new-user-avatar-input");
  if (newFileInput) {
    newFileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await processAvatarImage(file, 180, 0.85);
        newAvatarDataUrl = dataUrl;
        const preview = document.getElementById("new-user-avatar-preview");
        if (preview) {
          preview.innerHTML = `<img src="${dataUrl}" alt="Avatar Preview" class="avatar-img" />`;
        }
        const removeBtn = document.getElementById("new-user-avatar-remove");
        if (removeBtn) removeBtn.style.display = "inline-flex";
      } catch (err) {
        console.error("Error al procesar avatar:", err);
        showToast(err.message || "Error al procesar la imagen.", "error");
      }
    });
  }

  const newRemoveBtn = document.getElementById("new-user-avatar-remove");
  if (newRemoveBtn) {
    newRemoveBtn.addEventListener("click", () => {
      resetAddUserAvatar();
    });
  }

  // 2. Modal Editar Usuario
  const editFileInput = document.getElementById("edit-user-avatar-input");
  if (editFileInput) {
    editFileInput.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await processAvatarImage(file, 180, 0.85);
        editAvatarDataUrl = dataUrl;
        const preview = document.getElementById("edit-user-avatar-preview");
        if (preview) {
          preview.innerHTML = `<img src="${dataUrl}" alt="Avatar Preview" class="avatar-img" />`;
        }
        const removeBtn = document.getElementById("edit-user-avatar-remove");
        if (removeBtn) removeBtn.style.display = "inline-flex";
      } catch (err) {
        console.error("Error al procesar avatar:", err);
        showToast(err.message || "Error al procesar la imagen.", "error");
      }
    });
  }

  const editRemoveBtn = document.getElementById("edit-user-avatar-remove");
  if (editRemoveBtn) {
    editRemoveBtn.addEventListener("click", () => {
      editAvatarDataUrl = null;
      if (editFileInput) editFileInput.value = "";
      const preview = document.getElementById("edit-user-avatar-preview");
      if (preview) {
        const initials = (state.currentUser?.name || "")
          .split(" ")
          .map((n) => n[0])
          .slice(0, 2)
          .join("")
          .toUpperCase();
        preview.innerHTML = `<span class="avatar-preview-placeholder">${initials || "👤"}</span>`;
      }
      editRemoveBtn.style.display = "none";
    });
  }
}

/**
 * Carga y renderiza el grid de tarjetas de perfil de usuario
 */
export async function loadProfilesGrid() {
  const users = await DbManager.getAllUsers();
  const container = document.getElementById("users-grid-container");
  if (!container) return;
  container.innerHTML = "";

  if (users.length === 0) {
    return;
  }

  users.forEach((u) => {
    const card = document.createElement("div");
    card.className = "glass-card user-card";
    card.onclick = () => {
      selectUser(u);
      if (_navigateTo) _navigateTo("dashboard");
    };

    const initials = u.name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

    const avatarSrc = u.avatarUrl || u.imageUri;
    const avatarContent = avatarSrc
      ? `<img src="${avatarSrc}" alt="${u.name}" class="avatar-img" />`
      : initials;

    card.innerHTML = `
      <button class="user-card-delete" title="Eliminar Perfil">&times;</button>
      <div class="user-avatar">${avatarContent}</div>
      <div class="user-name">${u.name}</div>
      <div class="user-meta">${u.weight} kg • FTP ${u.ftp}W</div>
    `;

    const deleteBtn = card.querySelector(".user-card-delete");
    if (deleteBtn) {
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deleteProfileFromSelectScreen(u.id, u.name);
      };
    }

    container.appendChild(card);
  });
}

/**
 * Elimina un perfil desde la pantalla de selección
 */
export async function deleteProfileFromSelectScreen(id, name) {
  const confirmDel = await showConfirm(
    `¿Estás seguro de que quieres eliminar el perfil de ${name}? Esto borrará sus datos permanentemente.`,
  );
  if (confirmDel) {
    try {
      await DbManager.deleteUser(id);
      await loadProfilesGrid();
    } catch (e) {
      console.error("Error al eliminar perfil:", e);
      showToast("Error al eliminar perfil.", "error");
    }
  }
}

/**
 * Selecciona un usuario activo
 */
export function selectUser(user) {
  state.currentUser = user;
  loadWorkoutLayoutForUser(user);
  localStorage.setItem("rodilloint_userId", user.id);
  if (_navigateTo) {
    _navigateTo("dashboard");
  } else {
    console.warn("navigateTo no está definido, no se puede navegar a dashboard.");
  }
}

/**
 * Cierra la sesión del perfil actual
 */
export function handleLogout() {
  state.currentUser = null;
  localStorage.removeItem("rodilloint_userId");
  loadProfilesGrid();
  if (_navigateTo) _navigateTo("user-select");
}

/**
 * Crea un nuevo perfil a partir del formulario
 */
export async function handleAddUserSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  const nameInput = document.getElementById("new-user-name");
  const weightInput = document.getElementById("new-user-weight");
  const ftpInput = document.getElementById("new-user-ftp");
  const maxhrInput = document.getElementById("new-user-maxhr");
  const ageInput = document.getElementById("new-user-age");
  const heightInput = document.getElementById("new-user-height");

  const name = nameInput?.value.trim() || "";
  const weight = parseFloat(weightInput?.value) || 70;
  const ftp = parseInt(ftpInput?.value, 10) || 200;
  const maxHeartRate = parseInt(maxhrInput?.value, 10) || 190;
  const age = parseInt(ageInput?.value, 10) || 30;
  const height = parseInt(heightInput?.value, 10) || 175;

  if (name.length > 0) {
    try {
      const newId = await DbManager.insertUser({
        name,
        weight,
        ftp,
        maxHeartRate,
        age,
        height,
        avatarUrl: newAvatarDataUrl,
        imageUri: newAvatarDataUrl,
      });
      const user = await DbManager.getUserById(newId);
      hideModal("add-user");
      const form = document.getElementById("form-add-user");
      if (form) form.reset();
      resetAddUserAvatar();
      selectUser(user);
    } catch (err) {
      console.error(err);
      showToast("Error al crear perfil.", "error");
    }
  }
}

/**
 * Actualiza los datos del perfil activo
 */
export async function handleEditUserSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (!state.currentUser) return;

  const name = document.getElementById("edit-user-name")?.value.trim() || state.currentUser.name;
  const weight = parseFloat(document.getElementById("edit-user-weight")?.value) || state.currentUser.weight;
  const ftp = parseInt(document.getElementById("edit-user-ftp")?.value, 10) || state.currentUser.ftp;
  const maxHeartRate = parseInt(document.getElementById("edit-user-maxhr")?.value, 10) || state.currentUser.maxHeartRate;
  const age = parseInt(document.getElementById("edit-user-age")?.value, 10) || state.currentUser.age;
  const height = parseInt(document.getElementById("edit-user-height")?.value, 10) || state.currentUser.height;

  const updatedUser = {
    ...state.currentUser,
    name,
    weight,
    ftp,
    maxHeartRate,
    age,
    height,
    avatarUrl: editAvatarDataUrl,
    imageUri: editAvatarDataUrl,
  };

  try {
    await DbManager.updateUser(updatedUser);
    state.currentUser = updatedUser;
    hideModal("edit-user");
    loadDashboardHeader();
    showToast("Perfil actualizado correctamente.", "success");
  } catch (err) {
    console.error(err);
    showToast("Error al guardar ajustes.", "error");
  }
}

/**
 * Importa un perfil desde JSON
 */
export async function handleImportUserSubmit() {
  const jsonInput = document.getElementById("import-json-data");
  const jsonStr = jsonInput?.value.trim() || "";
  if (jsonStr.length === 0) return;

  try {
    const profile = JSON.parse(jsonStr);
    if (!profile.name || !profile.ftp) {
      showToast("Formato de perfil no válido. Faltan campos obligatorios (name, ftp).", "warning");
      return;
    }
    const newId = await DbManager.insertUser({
      uuid: profile.uuid || undefined,
      name: profile.name,
      weight: profile.weight || 75.0,
      ftp: profile.ftp || 200,
      maxHeartRate: profile.maxHeartRate || 190,
      age: profile.age || 30,
      height: profile.height || 175,
      avatarUrl: profile.avatarUrl || profile.imageUri || null,
      imageUri: profile.avatarUrl || profile.imageUri || null,
    });

    const user = await DbManager.getUserById(newId);
    hideModal("import-user");
    if (jsonInput) jsonInput.value = "";
    selectUser(user);
  } catch (err) {
    console.error(err);
    showToast("Formato JSON no válido.", "error");
  }
}

/**
 * Elimina el perfil actualmente autenticado
 */
export async function handleDeleteProfile() {
  if (!state.currentUser) return;
  const confirmDel = await showConfirm(
    `¿Estás seguro de que quieres eliminar el perfil de ${state.currentUser.name}? Esto borrará sus datos permanentemente.`,
  );
  if (confirmDel) {
    try {
      await DbManager.deleteUser(state.currentUser.id);
      hideModal("edit-user");
      handleLogout();
    } catch (err) {
      console.error(err);
      showToast("Error al eliminar perfil.", "error");
    }
  }
}

/**
 * Exporta el perfil actual como JSON al portapapeles
 */
export function handleExportProfile() {
  if (!state.currentUser) return;
  const profile = {
    uuid: state.currentUser.uuid,
    name: state.currentUser.name,
    weight: state.currentUser.weight,
    ftp: state.currentUser.ftp,
    maxHeartRate: state.currentUser.maxHeartRate,
    age: state.currentUser.age,
    height: state.currentUser.height,
    avatarUrl: state.currentUser.avatarUrl || state.currentUser.imageUri || null,
  };
  const jsonStr = JSON.stringify(profile, null, 2);

  navigator.clipboard
    .writeText(jsonStr)
    .then(() => {
      showToast("¡Código de Perfil copiado al portapapeles! Pégalo en otro dispositivo para importarlo.", "success");
    })
    .catch(() => {
      showToast("Código de perfil copiado al portapapeles.", "success");
      try { navigator.clipboard.writeText(jsonStr); } catch (e) {}
    });
}
