@echo off
title IT Skills Lab - Local Development
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\local.ps1"
if errorlevel 1 pause
