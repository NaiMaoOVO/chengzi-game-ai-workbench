property nodePath : "@@NODE_PATH@@"
property projectPath : "@@PROJECT_PATH@@"
property logDirectory : "@@LOG_DIRECTORY@@"

on «event GURLGURL» schemeURL
	if schemeURL is "gameops://start" then
		my launchScript("start-demo.js", "start")
	else if schemeURL is "gameops://restart" then
		my launchScript("restart-demo.js", "restart")
	end if
end «event GURLGURL»

on launchScript(scriptName, actionName)
	set scriptPath to projectPath & "/" & scriptName
	set logPath to logDirectory & "/" & actionName & ".log"
	if actionName is "start" then
		set commandText to "/bin/mkdir -p " & quoted form of logDirectory & " && (/usr/bin/curl -fsS http://127.0.0.1:8793/health 2>/dev/null | /usr/bin/grep -q '\"service\":\"gameops-local-controller\"' || GAMEOPS_NO_OPEN=1 /usr/bin/nohup " & quoted form of nodePath & " " & quoted form of scriptPath & " >> " & quoted form of logPath & " 2>&1 </dev/null &)"
	else
		set commandText to "/bin/mkdir -p " & quoted form of logDirectory & " && GAMEOPS_NO_OPEN=1 /usr/bin/nohup " & quoted form of nodePath & " " & quoted form of scriptPath & " >> " & quoted form of logPath & " 2>&1 </dev/null &"
	end if
	«event sysoexec» commandText
end launchScript
