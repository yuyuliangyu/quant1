from flask import Flask, render_template, jsonify, request
import sqlite3
from datetime import datetime
from waitress import serve  # 生产环境服务器

app = Flask(__name__)

# 模拟交易账户
trading_account = {
    'position': None,  # 'long'/'short'/None
    'entry_price': 0,
    'pnl': 0,
    'balance': 10000
}

def get_market_data(limit=100):
    """从数据库获取市场数据"""
    conn = sqlite3.connect('trading_data.db')
    cursor = conn.cursor()
    cursor.execute("""
        SELECT timestamp, open, high, low, close, volume 
        FROM trading_data 
        ORDER BY timestamp DESC 
        LIMIT ?
    """, (limit,))
    data = cursor.fetchall()
    conn.close()
    
    return [{
        'time': row[0],
        'open': row[1],
        'high': row[2],
        'low': row[3],
        'close': row[4],
        'volume': row[5]
    } for row in reversed(data)]

@app.route('/')
def trading_dashboard():
    return render_template('trading.html')

@app.route('/api/market-data')
def market_data():
    return jsonify(get_market_data())

@app.route('/api/trade', methods=['POST'])
def execute_trade():
    data = request.json
    action = data['action']
    latest_price = get_market_data(1)[0]['close']
    
    # 交易逻辑
    if action == 'open-long':
        trading_account.update({
            'position': 'long',
            'entry_price': latest_price,
            'pnl': 0
        })
    elif action == 'open-short':
        trading_account.update({
            'position': 'short',
            'entry_price': latest_price,
            'pnl': 0
        })
    elif action == 'close':
        if trading_account['position'] == 'long':
            trading_account['pnl'] = latest_price - trading_account['entry_price']
        elif trading_account['position'] == 'short':
            trading_account['pnl'] = trading_account['entry_price'] - latest_price
        
        trading_account['balance'] += trading_account['pnl']
        trading_account.update({
            'position': None,
            'entry_price': 0,
            'pnl': 0
        })
    
    return jsonify(trading_account)

if __name__ == '__main__':
    # 开发模式
    app.run(debug=True, port=5000)
    # 生产模式
    # serve(app, host='0.0.0.0', port=5000)