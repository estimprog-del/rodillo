/* js/core/userProfile.js
 * Gestión de perfiles de usuario (CRUD y selección).
 * Extraído de app.js para reducir su tamaño (Fix 1 - God File).
 */

import { state, loadWorkoutLayoutForUser } from '../modules/state.js';
import { showToast, showConfirm } from '../modules/toast.js';
import { getEditUserAvatar, getNewUserAvatar, resetAddUserAvatar } from '../ui/userView.js';
import { isAvatarDataUrl } from '../utils/imageUtils.js';

/** Carga y renderiza la cuadrícula de perfiles en la pantalla de selección */
export async function loadProfilesGrid() {
  const users = await DbManager.getAllUsers();
  const container = document.getElementById('users-grid-container');
  container.innerHTML = '';

  if (users.length === 0) return;

  users.forEach((u) => {
    const card = document.createElement('div');
    card.className = 'glass-card user-card';
    card.addEventListener('click', () => {
      // navigateTo se pasa desde app.js después de importar
      if (window._navigateTo) window._navigateTo('dashboard');
      selectUser(u);
    });

    const name = typeof u.name === 'string' ? u.name : '';
    const initials = name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'user-card-delete';
    deleteBtn.title = 'Eliminar Perfil';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void deleteProfileFromSelectScreen(u.id, name);
    });

    const avatar = document.createElement('div');
    avatar.className = 'user-avatar';
    const avatarUrl = u.avatarUrl || u.imageUri;
    if (isAvatarDataUrl(avatarUrl)) {
      const image = document.createElement('img');
      image.src = avatarUrl;
      image.alt = `Avatar de ${name}`;
      image.className = 'avatar-img';
      avatar.appendChild(image);
    } else {
      avatar.textContent = initials;
    }

    const userName = document.createElement('div');
    userName.className = 'user-name';
    userName.textContent = name;

    const metadata = document.createElement('div');
    metadata.className = 'user-meta';
    metadata.textContent = `${u.weight} kg • FTP ${u.ftp}W`;

    card.append(deleteBtn, avatar, userName, metadata);
    container.appendChild(card);
  });
}

export async function deleteProfileFromSelectScreen(id, name) {
  const confirmDel = await showConfirm(
    `¿Estás seguro de que quieres eliminar el perfil de ${name}? Esto borrará sus datos permanentemente.`,
  );
  if (confirmDel) {
    try {
      await DbManager.deleteUser(id);
      await loadProfilesGrid();
    } catch (e) {
      console.error('Error al eliminar perfil:', e);
    }
  }
}

/** Selecciona un usuario y actualiza el estado global */
export function selectUser(user) {
  state.currentUser = user;
  loadWorkoutLayoutForUser(user);
  localStorage.setItem('rodilloint_userId', user.id);
}

export function handleLogout() {
  state.currentUser = null;
  localStorage.removeItem('rodilloint_userId');
  loadProfilesGrid();
  if (window._navigateTo) window._navigateTo('user-select');
}

export async function handleAddUserSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('new-user-name').value.trim();
  const weight = parseFloat(document.getElementById('new-user-weight').value);
  const ftp = parseInt(document.getElementById('new-user-ftp').value);
  const maxHeartRate = parseInt(document.getElementById('new-user-maxhr').value);
  const age = parseInt(document.getElementById('new-user-age').value);
  const height = parseInt(document.getElementById('new-user-height').value);

  if (name.length > 0 && name.length <= 80) {
    try {
      const avatarUrl = getNewUserAvatar();
      const newId = await DbManager.insertUser({
        name,
        weight,
        ftp,
        maxHeartRate,
        age,
        height,
        avatarUrl,
        imageUri: avatarUrl,
      });
      const user = await DbManager.getUserById(newId);
      // Cerrar modal (usa la función global importada en app.js)
      document.getElementById('modal-add-user')?.classList.remove('active');
      document.getElementById('form-add-user')?.reset();
      resetAddUserAvatar();
      selectUser(user);
      if (window._navigateTo) window._navigateTo('dashboard');
    } catch (e) {
      console.error(e);
      showToast('Error al crear perfil.', 'error');
    }
  } else {
    showToast('El nombre debe tener entre 1 y 80 caracteres.', 'warning');
  }
}

export async function handleEditUserSubmit(e) {
  e.preventDefault();
  if (!state.currentUser) return;

  const name = document.getElementById('edit-user-name').value.trim();
  const weight = parseFloat(document.getElementById('edit-user-weight').value);
  const ftp = parseInt(document.getElementById('edit-user-ftp').value);
  const maxHeartRate = parseInt(document.getElementById('edit-user-maxhr').value);
  const age = parseInt(document.getElementById('edit-user-age').value);
  const height = parseInt(document.getElementById('edit-user-height').value);

  if (!name || name.length > 80) {
    showToast('El nombre debe tener entre 1 y 80 caracteres.', 'warning');
    return;
  }

  const avatarUrl = getEditUserAvatar();
  const updatedUser = {
    ...state.currentUser,
    name,
    weight,
    ftp,
    maxHeartRate,
    age,
    height,
    avatarUrl,
    imageUri: avatarUrl,
  };

  try {
    await DbManager.updateUser(updatedUser);
    state.currentUser = updatedUser;
    document.getElementById('modal-edit-user')?.classList.remove('active');
    // Recargar header del dashboard
    if (window._loadDashboardHeader) window._loadDashboardHeader(state);
  } catch (e) {
    console.error(e);
    showToast('Error al guardar ajustes.', 'error');
  }
}

export async function handleImportUserSubmit() {
  const jsonStr = document.getElementById('import-json-data').value.trim();
  if (jsonStr.length === 0) return;

  try {
    const profile = JSON.parse(jsonStr);
    if (typeof profile.name !== 'string' || !profile.name.trim() ||
        profile.name.trim().length > 80 || !profile.ftp) {
      showToast('Formato de perfil no válido. Revisa el nombre y el FTP.', 'warning');
      return;
    }
    const newId = await DbManager.insertUser({
      uuid: profile.uuid || undefined,
      name: profile.name.trim(),
      weight: profile.weight || 75.0,
      ftp: profile.ftp || 200,
      maxHeartRate: profile.maxHeartRate || 190,
      age: profile.age || 30,
      height: profile.height || 175,
      avatarUrl: isAvatarDataUrl(profile.avatarUrl)
        ? profile.avatarUrl
        : isAvatarDataUrl(profile.imageUri)
        ? profile.imageUri
        : null,
      imageUri: isAvatarDataUrl(profile.avatarUrl)
        ? profile.avatarUrl
        : isAvatarDataUrl(profile.imageUri)
        ? profile.imageUri
        : null,
    });

    const user = await DbManager.getUserById(newId);
    document.getElementById('modal-import-user')?.classList.remove('active');
    document.getElementById('import-json-data').value = '';
    selectUser(user);
    if (window._navigateTo) window._navigateTo('dashboard');
  } catch (e) {
    console.error(e);
    showToast('Formato JSON no válido.', 'error');
  }
}

export async function handleDeleteProfile() {
  if (!state.currentUser) return;
  const confirmDel = await showConfirm(
    `¿Estás seguro de que quieres eliminar el perfil de ${state.currentUser.name}? Esto borrará sus datos permanentemente.`,
  );
  if (confirmDel) {
    try {
      await DbManager.deleteUser(state.currentUser.id);
      document.getElementById('modal-edit-user')?.classList.remove('active');
      handleLogout();
    } catch (e) {
      console.error(e);
    }
  }
}

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
    avatarUrl: isAvatarDataUrl(state.currentUser.avatarUrl || state.currentUser.imageUri)
      ? state.currentUser.avatarUrl || state.currentUser.imageUri
      : null,
  };
  const jsonStr = JSON.stringify(profile, null, 2);

  navigator.clipboard
    .writeText(jsonStr)
    .then(() => {
      showToast('¡Código de Perfil copiado al portapapeles! Pégalo en otro dispositivo para importarlo.', 'success');
    })
    .catch(() => {
      showToast('Código de perfil copiado al portapapeles.', 'success');
      try { navigator.clipboard.writeText(jsonStr); } catch (_) {}
    });
}
