import sqlite3
import csv
from datetime import datetime

def csv_to_sqlite(csv_file, db_file):
    """将CSV数据导入SQLite数据库"""
    # 连接数据库
    conn = sqlite3.connect(db_file)
    cursor = conn.cursor()
    
    # 创建表
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS trading_data (
        timestamp TEXT PRIMARY KEY,
        open REAL,
        high REAL,
        low REAL,
        close REAL,
        volume INTEGER
    )
    """)
    
    # 读取CSV并插入数据
    with open(csv_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            # 转换时间格式（如果需要）
            try:
                dt = datetime.strptime(row['timestamp'], '%Y-%m-%d %H:%M:%S')
                formatted_time = dt.strftime('%Y-%m-%d %H:%M:%S')
            except ValueError:
                formatted_time = row['timestamp']  # 保持原格式
            
            cursor.execute("""
            INSERT OR REPLACE INTO trading_data 
            (timestamp, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (
                formatted_time,
                float(row['open']),
                float(row['high']),
                float(row['low']),
                float(row['close']),
                int(row['volume'])
            ))
    
    conn.commit()
    conn.close()
    print(f"数据已成功导入 {db_file}")

if __name__ == '__main__':
    # 配置路径
    csv_path = "data\\中证1000主连_30min.csv"  # 你的CSV文件路径
    db_path = "trading_data.db"         # 输出的数据库文件
    
    # 执行转换
    csv_to_sqlite(csv_path, db_path)