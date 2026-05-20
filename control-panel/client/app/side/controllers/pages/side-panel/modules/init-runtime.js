let sidePanelRuntimeInitialized = false;

// 创建/初始化：initSidePanelRuntime的具体业务逻辑。
function initSidePanelRuntime() {
  if (sidePanelRuntimeInitialized) {
    return;
  }
  sidePanelRuntimeInitialized = true;

  loadInitialConnectionState();
  loadInitialRuntimeValues();
  syncLatencyButtonState();
}
