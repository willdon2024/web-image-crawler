#!/bin/bash

# 安装依赖
python3 -m pip install -r requirements.txt

# 创建下载目录
mkdir -p downloads

# 启动服务器
python3 app.py 