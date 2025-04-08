import asyncio
import websockets
import json
import pandas as pd
from datetime import datetime

class KlineSimulator:
    def __init__(self):
        # 读取CSV数据
        self.df = pd.read_csv('C:\\Users\\yuyu\\Desktop\\量化\\量化模拟交易\\quant\\数据\\中证1000主连_30min.csv')
        self.df['timestamp'] = pd.to_datetime(self.df['timestamp'])
        self.df = self.df.sort_values('timestamp')
        self.current_idx = 0
        self.symbol = "IC9999"
        self.interval = "30m"


    async def handle_client(self, websocket):
        """处理客户端连接"""
        print("Client connected")
        try:
            # Send initial batch of 40 K-lines
            initial_klines = []
            end_idx = min(self.current_idx + 40, len(self.df))
            for i in range(self.current_idx, end_idx):
                kline = self.df.iloc[i]
                initial_klines.append({
                    "symbol": self.symbol,
                    "interval": self.interval,
                    "timestamp": kline['timestamp'].isoformat(),
                    "open": float(kline['open']),
                    "high": float(kline['high']),
                    "low": float(kline['low']),
                    "close": float(kline['close']),
                    "volume": float(kline['volume'])
                })
            
            await websocket.send(json.dumps({
                "type": "initial_klines",
                "data": initial_klines
            }))

            async for message in websocket:
                data = json.loads(message)
                if data.get('action') == 'next_kline' and self.current_idx + 40 < len(self.df):
                    self.current_idx += 1
                    window_klines = []
                    for i in range(self.current_idx, self.current_idx + 40):
                        kline = self.df.iloc[i]
                        window_klines.append({
                            "symbol": self.symbol,
                            "interval": self.interval,
                            "timestamp": kline['timestamp'].isoformat(),
                            "open": float(kline['open']),
                            "high": float(kline['high']),
                            "low": float(kline['low']),
                            "close": float(kline['close']),
                            "volume": float(kline['volume'])
                        })
                    
                    await websocket.send(json.dumps({
                        "type": "kline_window_update",
                        "data": window_klines
                    }))
        except websockets.exceptions.ConnectionClosed:
            print("Client disconnected")

async def main():
    simulator = KlineSimulator()
    server = await websockets.serve(simulator.handle_client, "localhost", 8765)
    print("Kline simulator running on ws://localhost:8765")
    await server.wait_closed()

if __name__ == "__main__":
    asyncio.run(main())
