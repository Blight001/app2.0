!macro customInstall
  ; Chromium 的 Network Service/AppContainer 必须能读取整个内核目录。
  ; 仅授予读取与执行，不开放写权限。
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR\resources\chromium" /grant *S-1-15-2-1:(OI)(CI)(RX) *S-1-15-2-2:(OI)(CI)(RX) /T /C /Q'
!macroend
