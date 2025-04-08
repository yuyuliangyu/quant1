from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime

DATABASE_URL = "sqlite:///trading_data.db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Kline(Base):
    __tablename__ = "klines"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String, index=True)
    interval = Column(String, index=True)
    timestamp = Column(DateTime, index=True)
    open = Column(Float)
    high = Column(Float)
    low = Column(Float)
    close = Column(Float)
    volume = Column(Float)

class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)
    symbol = Column(String)
    side = Column(String)  # LONG or SHORT
    size = Column(Float)
    entry_price = Column(Float)
    exit_price = Column(Float, nullable=True)
    entry_time = Column(DateTime)
    exit_time = Column(DateTime, nullable=True)
    pnl = Column(Float, nullable=True)
    status = Column(String)  # OPEN or CLOSED

def init_db():
    Base.metadata.create_all(bind=engine)

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully!") 