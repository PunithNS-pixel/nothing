"""OpenSearch is the search engine. PostgreSQL only bootstraps/rebuilds its index."""
from urllib.parse import urlparse
from sqlalchemy import select, or_
from opensearchpy import OpenSearch
from app.config import get_settings
from app.models import Product, Inventory

MAPPING={
 'settings':{'index':{'max_ngram_diff':14}, 'analysis':{
   'analyzer':{
     'name_partial':{'type':'custom','tokenizer':'standard','filter':['lowercase','partial_filter']},
     'name_prefix':{'type':'custom','tokenizer':'standard','filter':['lowercase','prefix_filter']}},
   'filter':{
     'partial_filter':{'type':'ngram','min_gram':3,'max_gram':16},
     'prefix_filter':{'type':'edge_ngram','min_gram':2,'max_gram':16}}
 }},
 'mappings':{'properties':{
   'name':{'type':'text','fields':{
       'contains':{'type':'text','analyzer':'name_partial','search_analyzer':'standard'},
       'autocomplete':{'type':'text','analyzer':'name_prefix','search_analyzer':'standard'}}},
   'description':{'type':'text'},'category':{'type':'keyword'},'sku':{'type':'keyword'},
   'price':{'type':'float'},'cities':{'type':'keyword'},
   'stock_by_city':{'type':'object','enabled':False},'active':{'type':'boolean'}
 }}}

def client():
    s=get_settings(); url=urlparse(s.opensearch_url)
    return OpenSearch(hosts=[{'host':url.hostname, 'port':url.port or (443 if url.scheme=='https' else 80)}],
       http_auth=(s.opensearch_username,s.opensearch_password) if s.opensearch_username else None,
       use_ssl=url.scheme=='https',verify_certs=url.scheme=='https',
       ca_certs=s.opensearch_ca_file or None,timeout=20,max_retries=2,retry_on_timeout=True)

def ensure_index(c):
    name=get_settings().opensearch_index
    if not c.indices.exists(index=name): c.indices.create(index=name,body=MAPPING)

def index_product(c,product,inventory,refresh=False):
    doc={'sku':product.sku,'name':product.name,'description':product.description,
         'category':product.category,'price':float(product.price),'active':product.active,
         'cities':[r.city for r in inventory if r.quantity>0],
         'stock_by_city':{r.city:r.quantity for r in inventory}}
    c.index(index=get_settings().opensearch_index,id=product.id,body=doc,
            refresh='wait_for' if refresh else False)

def reindex_all(c,db,reset=False):
    name=get_settings().opensearch_index
    if reset and c.indices.exists(index=name): c.indices.delete(index=name)
    ensure_index(c)
    products=db.scalars(select(Product).order_by(Product.id)).all()
    rows=db.scalars(select(Inventory)).all()
    by_product={}
    for row in rows: by_product.setdefault(row.product_id,[]).append(row)
    for product in products: index_product(c,product,by_product.get(product.id,[]))
    c.indices.refresh(index=name)
    return len(products)

def ensure_search_ready(c,db):
    """Repair a missing/empty index; subsequent changes come from Kafka."""
    ensure_index(c)
    if c.count(index=get_settings().opensearch_index)['count']==0:
        reindex_all(c,db)

def search_products(c,q,category,city,min_price,max_price,page,size):
    filters=[{'term':{'active':True}}]
    if category: filters.append({'term':{'category':category}})
    if city: filters.append({'term':{'cities':city}})
    price_range={}
    if min_price is not None: price_range['gte']=float(min_price)
    if max_price is not None: price_range['lte']=float(max_price)
    if price_range: filters.append({'range':{'price':price_range}})
    should=[
       {'multi_match':{'query':q,'fields':['name^6','description^2'], 'fuzziness':'AUTO'}},
       {'match':{'name.autocomplete':{'query':q,'boost':4}}},
       {'match':{'name.contains':{'query':q,'boost':3}}},
       {'wildcard':{'sku':{'value':'*'+q.upper().replace('*','').replace('?','')+'*','boost':1}}}
    ] if q else []
    query={'bool':{'filter':filters,**({'should':should,'minimum_should_match':1} if q else {})}}
    response=c.search(index=get_settings().opensearch_index,
      body={'query':query,'from':(page-1)*size,'size':size,'track_total_hits':True})
    return {'total':response['hits']['total']['value'],'page':page,
            'items':[{'id':h['_id'],**h['_source']} for h in response['hits']['hits']]}


def reconcile_missing_search_results(c, db, query, category=None, city=None, min_price=None, max_price=None):
    """Repair *partial* search-index drift on a zero-hit query.

    PostgreSQL identifies only possible stale documents; search results still come
    exclusively from a second OpenSearch query. Never return SQL matches as search
    results. Bounded to 20 candidates and terms >= 3 characters.
    """
    term=query.strip()
    if len(term) < 3:
        return 0

    # Escape SQL LIKE wildcards so arbitrary user text cannot trigger an all-catalog scan.
    escaped=(term.replace(chr(92), chr(92)*2).replace('%', chr(92)+'%').replace('_', chr(92)+'_'))
    pattern='%' + escaped + '%'
    stmt=select(Product).where(
        Product.active.is_(True),
        or_(
            Product.name.ilike(pattern, escape=chr(92)),
            Product.description.ilike(pattern, escape=chr(92)),
            Product.sku.ilike(pattern, escape=chr(92)),
        ),
    )
    if category:
        stmt=stmt.where(Product.category == category)
    if min_price is not None:
        stmt=stmt.where(Product.price >= min_price)
    if max_price is not None:
        stmt=stmt.where(Product.price <= max_price)
    if city:
        stmt=stmt.join(Inventory, Inventory.product_id == Product.id).where(
            Inventory.city == city, Inventory.quantity > 0
        )
    candidates=db.scalars(stmt.order_by(Product.id).limit(20)).all()
    if not candidates:
        return 0

    product_ids=[p.id for p in candidates]
    rows=db.scalars(select(Inventory).where(Inventory.product_id.in_(product_ids))).all()
    by_product={}
    for row in rows:
        by_product.setdefault(row.product_id, []).append(row)

    index=get_settings().opensearch_index
    repaired=0
    for product in candidates:
        inv=by_product.get(product.id, [])
        expected_cities={r.city for r in inv if r.quantity > 0}
        expected_stock={r.city: r.quantity for r in inv}
        existing=c.get(index=index, id=product.id, ignore=[404])
        source=existing.get('_source', {}) if existing.get('found',False) else {}
        if (
            not source or
            source.get('name') != product.name or
            source.get('sku') != product.sku or
            source.get('description') != product.description or
            source.get('category') != product.category or
            source.get('active') != product.active or
            float(source.get('price', -1)) != float(product.price) or
            set(source.get('cities') or []) != expected_cities or
            source.get('stock_by_city') != expected_stock
        ):
            index_product(c, product, inv)
            repaired+=1
    if repaired:
        c.indices.refresh(index=index)
    return repaired
