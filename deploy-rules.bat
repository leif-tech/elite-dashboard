@echo off
echo === Deploying Firestore Security Rules ===
echo.
echo Step 1: Logging into Firebase (browser will open)...
call npx firebase login
if errorlevel 1 (
    echo Login failed. Exiting.
    pause
    exit /b 1
)
echo.
echo Step 2: Deploying rules to elite-228d6...
call npx firebase deploy --only firestore:rules --project elite-228d6
if errorlevel 1 (
    echo Deploy failed.
    pause
    exit /b 1
)
echo.
echo === Done! Firestore rules deployed successfully. ===
pause
