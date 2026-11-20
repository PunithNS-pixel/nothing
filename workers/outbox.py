import asyncio, json, logging
from datetime import datetime, timezone
from sqlalchemy import select
from aiokafka import AIOKafkaProducer
from app.db import SessionLocal
from app.models import Outbox
from app.config import get_settings
from workers.common import kafka_options

logging.basicConfig(level=logging.INFO)

def pending():
    with SessionLocal() as db:
        return [(r.id,r.event_type,r.aggregate_id,r.payload) for r in db.scalars(select(Outbox).where(Outbox.published_at.is_(None)).order_by(Outbox.created_at).limit(100))]

def mark_sent(event_id):
    with SessionLocal() as db:
        r=db.get(Outbox,event_id)
        if r and not r.published_at: r.published_at=datetime.now(timezone.utc);db.commit()

async def run():
    producer=AIOKafkaProducer(**kafka_options(),acks='all',enable_idempotence=True)
    await producer.start()
    try:
        while True:
            batch=await asyncio.to_thread(pending)
            for eid,kind,aggregate,payload in batch:
                envelope={'event_id':eid,'type':kind,'aggregate_id':aggregate,'payload':payload,'schema_version':1}
                await producer.send_and_wait(get_settings().kafka_topic,json.dumps(envelope).encode(),key=aggregate.encode())
                await asyncio.to_thread(mark_sent,eid)
            await asyncio.sleep(.5 if batch else 2)
    finally: await producer.stop()

if __name__=='__main__': asyncio.run(run())
