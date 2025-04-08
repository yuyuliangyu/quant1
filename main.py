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
from init_db import SessionLocal, Trade

app = FastAPI()

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态文件
app.mount("/static", StaticFiles(directory="static"), name="static")

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

@app.get("/")
async def get_index():
    return FileResponse("static/index.html")

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(json.dumps({
                "type": "market_update",
                "data": json.loads(data)
            }))
    except WebSocketDisconnect:
        manager.disconnect(client_id)

@app.get("/api/klines")
async def get_klines(symbol: str = "IC9999", interval: str = "30m", limit: int = 100):  # 注意修改默认参数匹配你的数据
    db = SessionLocal()
    try:
        query = text("""
        SELECT * FROM klines 
        WHERE symbol = :symbol 
        AND interval = :interval
        ORDER BY timestamp DESC 
        LIMIT :limit
        """)
        result = db.execute(query, {"symbol": symbol, "interval": interval, "limit": limit})
        
        # 正确转换方法
        return [row._asdict() for row in result]
        
        # 如果需要处理时间序列化：
        # return [
        #     {
        #         ​**​row._asdict(),
        #         "timestamp": row.timestamp.isoformat()
        #     }
        #     for row in result
        # ]
    finally:
        db.close()

@app.post("/api/trade/open")
async def open_position(
    user_id: str,
    symbol: str,
    side: str,
    size: float,
    price: float
):
    db = SessionLocal()
    try:
        trade = Trade(
            user_id=user_id,
            symbol=symbol,
            side=side,
            size=size,
            entry_price=price,
            entry_time=datetime.utcnow(),
            status="OPEN"
        )
        db.add(trade)
        db.commit()
        db.refresh(trade)
        return trade
    finally:
        db.close()

@app.post("/api/trade/close/{trade_id}")
async def close_position(trade_id: int, exit_price: float):
    db = SessionLocal()
    try:
        trade = db.query(Trade).filter(Trade.id == trade_id).first()
        if not trade:
            raise HTTPException(status_code=404, detail="Trade not found")
        
        trade.exit_price = exit_price
        trade.exit_time = datetime.utcnow()
        trade.status = "CLOSED"
        
        # Calculate PNL
        if trade.side == "LONG":
            trade.pnl = (exit_price - trade.entry_price) * trade.size
        else:
            trade.pnl = (trade.entry_price - exit_price) * trade.size
        
        db.commit()
        db.refresh(trade)
        return trade
    finally:
        db.close()

@app.get("/api/trades/{user_id}")
async def get_trades(user_id: str, status: str = None):
    db = SessionLocal()
    try:
        query = db.query(Trade).filter(Trade.user_id == user_id)
        if status:
            query = query.filter(Trade.status == status)
        trades = query.all()
        return trades
    finally:
        db.close()

# 在原有代码基础上添加以下内容

from init_db import Kline  # 需要导入Kline模型

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
                        "timestamp": row['timestamp'],
                        "open": row['open'],
                        "high": row['high'],
                        "low": row['low'],
                        "close": row['close'],
                        "volume": row['volume']
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

kline_simulator = KlineSimulator()

@app.websocket("/ws/kline")
async def kline_websocket(websocket: WebSocket):
    await kline_simulator.handle_client(websocket)
        
if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8080, reload=True)
