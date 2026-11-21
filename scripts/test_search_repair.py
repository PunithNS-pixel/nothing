"""Regression: repair a nonempty OpenSearch index missing just Sugar Free.

Run only in a disposable/test stack; it deliberately corrupts the search index.
Never alters PostgreSQL products, orders, or inventory.
"""
import json
import urllib.parse
import urllib.request
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Product
from app.search import client
from app.config import get_settings

def search(term='free', city='Bengaluru'):
    params=urllib.parse.urlencode({'q':term,'city':city})
    with urllib.request.urlopen('http://gateway:8080/api/search?'+params, timeout=15) as resp:
        return json.load(resp)

def assert_sugar():
    result=search()
    assert any(p['sku']=='ENERGY-SUGARFREE' for p in result['items']), result
    return result

def main():
    with SessionLocal() as db:
        product=db.scalar(select(Product).where(Product.sku=='ENERGY-SUGARFREE'))
        assert product and product.active, 'Seed the demo catalog first'
        product_id=product.id
    c=client()
    idx=get_settings().opensearch_index
    try:
        assert_sugar()
        before=c.count(index=idx)['count']
        assert before>=3, 'Need a populated index to test partial corruption'

        # Simulate exactly the old failure: 5 products remain, Sugar Free is absent.
        c.delete(index=idx,id=product_id,refresh='wait_for')
        assert c.count(index=idx)['count']==before-1
        assert_sugar()
        assert c.get(index=idx,id=product_id).get('found')

        # Simulate a stale city-wise availability filter while all docs exist.
        c.update(index=idx,id=product_id,body={'doc':{'cities':[]}},refresh='wait_for')
        assert_sugar()
        repaired=c.get(index=idx,id=product_id)['_source']
        assert 'Bengaluru' in repaired['cities'], repaired

        # Genuine no-match must still return no OpenSearch hits.
        result=search('zzzzzznonexistentproductzzzzz')
        assert result['total']==0, result
        print('PASS: partial missing product and stale city stock repaired; no SQL search fallback')
    finally:
        c.close()

if __name__=='__main__':
    main()
