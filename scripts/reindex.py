"""Rebuild OpenSearch from PostgreSQL, without requiring a Kafka event."""
import logging
from app.db import SessionLocal
from app.search import client,reindex_all
logging.basicConfig(level=logging.INFO)
def main():
    with SessionLocal() as db:
        c=client()
        try:
            total=reindex_all(c,db,reset=False)
            print(f'OpenSearch index reconciled (non-destructive): {total} products (including inactive)')
        finally: c.close()
if __name__=='__main__': main()
