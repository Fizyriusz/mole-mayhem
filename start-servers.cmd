@echo off
REM Uruchamia oba serwery w OSOBNYCH oknach, ktore zyja niezaleznie od tego,
REM czy Claude Code / IDE jest otwarte. Zamkniecie okna = zatrzymanie serwera.
cd /d "%~dp0"

echo Startuje relay sesji (Cloudflare Worker) na porcie 1999...
start "Mole Mayhem - Relay :1999" cmd /k npm run relay:dev

echo Startuje Vite (gra) na porcie 5175...
start "Mole Mayhem - Gra :5175" cmd /k npm run dev

echo.
echo ================================================================
echo  Oba serwery startuja w osobnych oknach.
echo.
echo  Na tym komputerze:   http://localhost:5175
echo  Przez Tailscale:     http://100.112.91.99:5175
echo.
echo  W grze, zakladka "Wieloosobowa", pole "Adres serwera"
echo  wypelni sie samo adresem tego hosta + :1999
echo ================================================================
echo.
pause
