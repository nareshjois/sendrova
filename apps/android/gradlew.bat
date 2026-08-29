@ECHO OFF

@REM ##########################################################################
@REM Gradle startup script for Windows (Sendrova SMS Android)
@REM Requires: JDK 17+, Android SDK. Prefer opening this folder in Android Studio,
@REM which will generate gradle/wrapper/gradle-wrapper.jar if missing.
@REM ##########################################################################

SETLOCAL

SET DIRNAME=%~dp0
IF "%DIRNAME%"=="" SET DIRNAME=.
SET APP_BASE_NAME=%~n0
SET APP_HOME=%DIRNAME%

SET DEFAULT_JVM_OPTS="-Xmx64m" "-Xms64m"

IF DEFINED JAVA_HOME GOTO findJavaFromJavaHome

SET JAVA_EXE=java.exe
WHERE java.exe >NUL 2>&1
IF %ERRORLEVEL% EQU 0 GOTO execute

ECHO ERROR: JAVA_HOME is not set and no java command was found in PATH.
GOTO fail

:findJavaFromJavaHome
SET JAVA_HOME=%JAVA_HOME:"=%
SET JAVA_EXE=%JAVA_HOME%/bin/java.exe
IF EXIST "%JAVA_EXE%" GOTO execute
ECHO ERROR: JAVA_HOME is set to an invalid directory: %JAVA_HOME%
GOTO fail

:execute
SET CLASSPATH=%APP_HOME%\gradle\wrapper\gradle-wrapper.jar
IF NOT EXIST "%CLASSPATH%" (
  ECHO ERROR: Missing gradle\wrapper\gradle-wrapper.jar
  ECHO Open apps/android in Android Studio once to generate the Gradle wrapper, then retry.
  GOTO fail
)

"%JAVA_EXE%" %DEFAULT_JVM_OPTS% %JAVA_OPTS% %GRADLE_OPTS% "-Dorg.gradle.appname=%APP_BASE_NAME%" -classpath "%CLASSPATH%" org.gradle.wrapper.GradleWrapperMain %*

:end
ENDLOCAL
EXIT /B %ERRORLEVEL%

:fail
EXIT /B 1
