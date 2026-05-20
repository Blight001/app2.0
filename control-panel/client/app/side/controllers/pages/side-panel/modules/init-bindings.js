let sidePanelBindingsInitialized = false;

// 创建/初始化：initSidePanelBindings的具体业务逻辑。
function initSidePanelBindings() {
  if (sidePanelBindingsInitialized) {
    return;
  }
  sidePanelBindingsInitialized = true;

  initAnnouncementListener();
  initSidebarUiListeners();
  initSidebarAnimationListener();
  initPluginSwitches();
  bindClashMiniControls();
  bindLicenseValidationControls();
  bindServerAccountCookieListener();
  bindAccountPanel();
  bindTutorialLink();
  bindBackToLicenseButton();
  bindSecondaryEntryButtons();
  bindRuntimeValueListeners();
}
