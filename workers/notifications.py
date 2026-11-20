import asyncio, json, logging
import aio_pika
from sqlalchemy import select
from app.db import SessionLocal
from app.models import ProcessedEvent
from app.config import get_settings

logging.basicConfig(level=logging.INFO)
CONSUMER='notifications-v1'

def notify(e):
    with SessionLocal() as db:
        seen=db.scalar(select(ProcessedEvent.id).where(ProcessedEvent.event_id==e['event_id'],ProcessedEvent.consumer==CONSUMER))
        if seen: return
        # Demonstration notification sink. Replace with a real email provider and
        # use provider-side idempotency to avoid duplicated sends after a crash.
        logging.info('ORDER CONFIRMATION for %s: order=%s amount=%s',e['payload']['email'],e['payload']['order_id'],e['payload']['total'])
        db.add(ProcessedEvent(event_id=e['event_id'],consumer=CONSUMER));db.commit()

async def run():
    connection=await aio_pika.connect_robust(get_settings().rabbitmq_url)
    async with connection:
        ch=await connection.channel();await ch.set_qos(prefetch_count=20)
        q=await ch.declare_queue('order.confirmations',durable=True)
        async with q.iterator() as messages:
            async for message in messages:
                async with message.process(requeue=True):
                    await asyncio.to_thread(notify,json.loads(message.body))

if __name__=='__main__': asyncio.run(run())
