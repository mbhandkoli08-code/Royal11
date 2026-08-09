"""Shared MongoDB client — the single source of truth for db across server.py
and every module under app/. Do not create a second AsyncIOMotorClient
elsewhere; multiple clients means multiple connection pools for no reason.
"""
import os
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]
