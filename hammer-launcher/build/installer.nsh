; Hammer Launcher – additions to the NSIS installer made by electron-builder.

; Uninstalling: the entry „Uruchamiaj razem z Windows” goes too (src/main/main.js → applyLoginItem writes it under
; this name). Not during an update – electron-builder runs the old uninstaller then as well, and the new version
; keeps starting with Windows.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Hammer Launcher"
  ${endIf}
!macroend
