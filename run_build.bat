@echo off
cd /d "%~dp0"
echo Building shop analytics (funnel, cohorts, segments)...
python scripts/build_analytics.py
if errorlevel 1 pause & exit /b 1
echo.
echo Done. To view dashboard: cd dashboard ^& python -m http.server 8080
echo Then open http://localhost:8080
pause
