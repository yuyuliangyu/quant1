@echo off
echo 正在安装依赖库...
pip install -r requirements.txt
if errorlevel 1 (
    echo 依赖安装失败！请检查网络或Python环境
    pause
    exit
)
echo 启动交易程序...
start "" python app.py
pause