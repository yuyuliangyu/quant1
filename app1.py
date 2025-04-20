from flask import Flask, render_template, send_from_directory
import os

app = Flask(__name__)

# 根路径返回主页面
@app.route('/')
def trading_dashboard():
    return render_template('trading1.html')

# 静态文件（数据库）
@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(os.path.join(app.root_path, 'static'), filename)

if __name__ == '__main__':
    # 开发模式
    app.run(debug=True, port=5000)