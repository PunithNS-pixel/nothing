"""OpenSearch is the search engine. PostgreSQL only bootstraps/rebuilds its index."""
from urllib.parse import urlparse
from sqlalchemy import select
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
