"""Diagnose missing Sugar Free searches with no private credentials exposed.

Usage:
  docker compose exec -T api python -m scripts.search_doctor
  docker compose exec -T api python -m scripts.search_doctor --repair
  docker compose exec -T api python -m scripts.search_doctor --rebuild-all
"""
import argparse
import sys
from sqlalchemy import select
from app.config import get_settings
from app.db import SessionLocal
from app.models import Product, Inventory
from app.search import client, ensure_index, index_product, reindex_all, search_products

def lookup(c, term, city):
    result=search_products(c, term, None, city, None, None, 1, 20)
    names=[p['name'] for p in result['items']]
    print('OpenSearch query:',repr(term), 'city:',city or 'all', 'total:',result['total'],'names:',names)
    return any(p['sku']=='ENERGY-SUGARFREE' for p in result['items'])

def main():
    parser=argparse.ArgumentParser(description='Check PostgreSQL versus OpenSearch for Sugar Free')
    group=parser.add_mutually_exclusive_group()
    group.add_argument('--repair', action='store_true', help='Upsert Sugar Free document without deleting the index')
    group.add_argument('--rebuild-all', action='store_true', help='Upsert all catalog documents without deleting the index')
    opts=parser.parse_args()
    with SessionLocal() as db:
        product=db.scalar(select(Product).where(Product.sku=='ENERGY-SUGARFREE'))
        if not product:
            print('ERROR: Sugar Free not found in PostgreSQL. Run: docker compose exec -T api python -m scripts.seed')
            return 2
        inventory=db.scalars(select(Inventory).where(Inventory.product_id==product.id)).all()
        stock={r.city:r.quantity for r in inventory}
        print('PostgreSQL: sku=',product.sku,'id=',product.id,'name=',product.name,
              'active=',product.active,'price=',product.price,'stock=',stock)
        if not product.active:
            print('ERROR: Sugar Free is inactive in PostgreSQL; only an admin should reactivate it.')
            return 2

        c=client()
        try:
            idx=get_settings().opensearch_index
            exists=c.indices.exists(index=idx)
            print('OpenSearch index=',idx,'exists=',exists)
            if opts.repair or opts.rebuild_all:
                if opts.rebuild_all:
                    print('Rebuilding non-destructively from PostgreSQL...',reindex_all(c,db,reset=False),'products')
                else:
                    ensure_index(c)
                    index_product(c,product,inventory,refresh=True)
                    print('Upserted Sugar Free from PostgreSQL')
            if not c.indices.exists(index=idx):
                print('ERROR: Index not present. Retry with --repair.')
                return 2
            print('OpenSearch document count=',c.count(index=idx)['count'])
            doc=c.get(index=idx,id=product.id,ignore=[404])
            print('Sugar Free indexed=',bool(doc.get('found',False)))
            if doc.get('found',False):
                src=doc.get('_source',{})
                print('Index source:',{'name':src.get('name'),'sku':src.get('sku'),
                     'active':src.get('active'),'cities':src.get('cities'),'price':src.get('price')})
            no_city=lookup(c,'free',None)
            city=lookup(c,'free','Bengaluru')
            if not no_city or (stock.get('Bengaluru',0)>0 and not city):
                print('ERROR: Still missing. Run --repair; inspect OpenSearch mapping/logs if still missing.')
                return 1
            if stock.get('Bengaluru',0)<=0:
                print('NOTE: Bengaluru stock is zero; city-filtered results are correctly absent.')
            print('PASS: Sugar Free can be found through OpenSearch')
            return 0
        finally:
            c.close()

if __name__=='__main__':
    sys.exit(main())
