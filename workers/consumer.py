import asyncio,json,logging
from sqlalchemy import select
from aiokafka import AIOKafkaConsumer, TopicPartition
from app.db import SessionLocal
from app.models import Product, Inventory, ProcessedEvent
from app.search import client, ensure_index, index_product
from app.config import get_settings
from workers.common import kafka_options
import aio_pika

logging.basicConfig(level=logging.INFO)
CONSUMER='search-and-notification-v1'

def already_processed(event_id):
    with SessionLocal() as db:
        return db.scalar(select(ProcessedEvent.id).where(ProcessedEvent.event_id==event_id,ProcessedEvent.consumer==CONSUMER)) is not None

def mark_processed(event_id):
    with SessionLocal() as db:
        if not db.scalar(select(ProcessedEvent.id).where(ProcessedEvent.event_id==event_id,ProcessedEvent.consumer==CONSUMER)):
            db.add(ProcessedEvent(event_id=event_id,consumer=CONSUMER));db.commit()

def reindex(product_id):
    with SessionLocal() as db:
        p=db.get(Product,product_id)
        c=client()
        try:
            ensure_index(c)
            if p:
                inventory=db.scalars(select(Inventory).where(Inventory.product_id==product_id)).all()
                index_product(c,p,inventory,refresh=True)
            else: c.delete(index=get_settings().opensearch_index,id=product_id,ignore=[404])
        finally: c.close()

async def run():
    consumer=AIOKafkaConsumer(get_settings().kafka_topic,group_id=CONSUMER,enable_auto_commit=False,auto_offset_reset='earliest',**kafka_options())
    rabbit=await aio_pika.connect_robust(get_settings().rabbitmq_url)
    channel=await rabbit.channel(publisher_confirms=True)
    await channel.declare_queue('order.confirmations',durable=True)
    await consumer.start()
    try:
        async for msg in consumer:
            try:
                e=json.loads(msg.value); eid=e['event_id']; kind=e['type']
                if not await asyncio.to_thread(already_processed,eid):
                    if kind in ('product.changed','inventory.changed'):
                        await asyncio.to_thread(reindex,e['payload']['product_id'])
                    elif kind=='order.placed':
                        # Durable RabbitMQ queue for notifications; downstream worker deduplicates by event_id.
                        await channel.default_exchange.publish(aio_pika.Message(body=json.dumps(e).encode(),delivery_mode=aio_pika.DeliveryMode.PERSISTENT,message_id=eid),routing_key='order.confirmations',mandatory=True)
                    await asyncio.to_thread(mark_processed,eid)
                await consumer.commit()
            except Exception:
                logging.exception('Event processing failed; will retry without committing offset')
                await asyncio.sleep(3)
                # Seek to failed offset so this message is retried, not skipped by next iteration.
                consumer.seek(TopicPartition(msg.topic,msg.partition),msg.offset)
    finally:
        await consumer.stop();await rabbit.close()

if __name__=='__main__': asyncio.run(run())
