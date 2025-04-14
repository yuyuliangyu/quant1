@echo off
echo 检查Python虚拟环境...

REM 检查虚拟环境目录是否存在
if not exist "venv\" (
    echo 未找到虚拟环境，正在创建...
    python -m venv venv
    if errorlevel 1 (
        echo 创建虚拟环境失败！请检查Python是否正确安装
        pause
        exit
    )
    echo 虚拟环境创建成功！
) else (
    echo 检测到现有虚拟环境
)

echo 正在激活虚拟环境...
call venv\Scripts\activate

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