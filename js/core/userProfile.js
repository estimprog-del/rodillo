/* js/core/userProfile.js
 * Punto de entrada unificado para gestión de perfiles.
 * Todas las implementaciones están en js/ui/userView.js.
 * Este archivo re-exporta para mantener compatibilidad con los imports existentes en app.js.
 */

export {
  loadProfilesGrid,
  selectUser,
  handleLogout,
  handleAddUserSubmit,
  handleEditUserSubmit,
  handleImportUserSubmit,
  handleDeleteProfile,
  handleExportProfile,
  deleteProfileFromSelectScreen,
  prepareEditUserAvatar,
  resetAddUserAvatar,
  getNewUserAvatar,
  getEditUserAvatar,
  initUserView,
} from '../ui/userView.js';
