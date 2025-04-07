from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import pandas as pd
import json
from datetime import datetime, timedelta
import asyncio
from typing import List, Dict
import uvicorn

app = FastAPI()

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 数据库连接配置
DATABASE_URL = "sqlite:///trading_data.db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 存储活跃的WebSocket连接
active_connections: List[WebSocket] = []

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # 处理接收到的数据
            await manager.broadcast(f"Message text was: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/api/klines")
async def get_klines(symbol: str = "BTCUSDT", interval: str = "1m", limit: int = 100):
    db = SessionLocal()
    try:
        # 从数据库获取K线数据
        query = f"""
        SELECT * FROM klines 
        WHERE symbol = '{symbol}' 
        AND interval = '{interval}'
        ORDER BY timestamp DESC 
        LIMIT {limit}
        """
        df = pd.read_sql(query, db.bind)
        return df.to_dict(orient="records")
    finally:
        db.close()

@app.get("/api/position")
async def get_position():
    # 模拟持仓数据
    return {
        "position": "BTCUSDT",
        "side": "LONG",
        "size": 0.1,
        "entry_price": 50000,
        "current_price": 51000,
        "pnl": 100,
        "pnl_percentage": 2.0
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)