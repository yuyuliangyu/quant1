import asyncio
from websockets.sync.client import connect
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import pandas as pd
import json
from datetime import datetime, timedelta
import asyncio
from typing import List, Dict
import uvicorn
from init_db import SessionLocal, Trade, Kline
import time  # 用于测试时间间隔

app = FastAPI()

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态文件目录
app.mount("/static", StaticFiles(directory="static", html=True), name="static")

# WebSocket连接管理
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    def disconnect(self, client_id: str):
        self.active_connections.pop(client_id, None)

    async def send_personal_message(self, message: str, client_id: str):
        if client_id in self.active_connections:
            await self.active_connections[client_id].send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections.values():
            await connection.send_text(message)

manager = ConnectionManager()


class KlineSimulator:
    def __init__(self):
        # 读取CSV数据
        self.df = pd.read_csv('数据/中证1000主连_30min.csv')
        self.df['timestamp'] = pd.to_datetime(self.df['timestamp'])
        self.df = self.df.sort_values('timestamp')
        self.current_idx = 0
        self.symbol = "IC9999"
        self.interval = "30m"
        
        # 新增数据库写入
        self._init_database()

    def _init_database(self):
        db = SessionLocal()
        try:
            # 检查是否已有数据
            existing = db.query(Kline).filter(
                Kline.symbol == self.symbol,
                Kline.interval == self.interval
            ).first()
            
            if not existing:
                # 批量插入数据
                records = []
                for _, row in self.df.iterrows():
                    records.append({
                        "symbol": self.symbol,
                        "interval": self.interval,
                        "timestamp": row['timestamp'],  # 已经是datetime格式
                        "open": float(row['open']),
                        "high": float(row['high']),
                        "low": float(row['low']),
                        "close": float(row['close']),
                        "volume": float(row['volume'])
                    })
                
                # 使用批量插入优化性能
                db.execute(
                    Kline.__table__.insert(),
                    records
                )
                db.commit()
                print(f"Inserted {len(records)} klines into database")
        finally:
            db.close()

    async def handle_client(self, websocket: WebSocket):
        await websocket.accept()
        try:
            while True:
                # 每次发送一个新的K线
                if self.current_idx < len(self.df):
                    kline = self.df.iloc[self.current_idx]
                    await websocket.send_json({
                        "type": "kline_update",
                        "data": {
                            "timestamp": kline['timestamp'].isoformat(),
                            "open": float(kline['open']),
                            "high": float(kline['high']),
                            "low": float(kline['low']),
                            "close": float(kline['close']),
                            "volume": float(kline['volume'])
                        }
                    })
                    self.current_idx += 1
                await asyncio.sleep(1)  # 每秒更新一次
        except WebSocketDisconnect:
            print("Client disconnected")


def test_websocket_push():
    # 启动模拟器服务（需提前启动FastAPI服务）
    simulator = KlineSimulator()
    
    # 模拟客户端连接
    with connect("ws://localhost:8000/ws") as websocket:
        received_data = []
        start_time = time.time()
        
        # 接收10条消息
        for _ in range(10):
            data = websocket.recv()
            received_data.append(json.loads(data))
            print(f"Received: {data}")
        
        # 检查推送顺序
        timestamps = [item['data']['timestamp'] for item in received_data]
        assert timestamps == sorted(timestamps), "时间戳未按顺序推送"
        
        # 检查时间间隔
        duration = time.time() - start_time
        assert 9 <= duration <= 11, f"预期10秒内收到10条数据，实际耗时{duration}秒"