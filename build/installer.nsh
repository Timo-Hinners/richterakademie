; Laufende Richterakademie vor Installation/Update schließen (ohne PowerShell-Abhängigkeit)
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  Pop $0
  Sleep 500
!macroend
