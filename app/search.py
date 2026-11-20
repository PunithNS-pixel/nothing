from urllib.parse import urlparse
from opensearchpy import OpenSearch
from app.config import get_settings

MAPPING = {'settings': {'analysis': {'analyzer': {'autocomplete': {'tokenizer': 'autocomplete_tokenizer', 'filter': ['lowercase'] }}, 'tokenizer': {'autocomplete_tokenizer': {'type':'edge_ngram', 'min_gram':2, 'max_gram':15, 'token_chars':['letter','digit']}}}}, 'mappings': {'properties': {'name': {'type':'text', 'analyzer':'standard', 'fields':{'autocomplete':{'type':'text','analyzer':'autocomplete'}}}, 'description':{'type':'text'}, 'category':{'type':'keyword'}, 'sku':{'type':'keyword'}, 'price':{'type':'float'}, 'cities':{'type':'keyword'}, 'stock_by_city':{'type':'object', 'enabled':False}, 'active':{'type':'boolean'}}}}

def client():
    s = get_settings(); url = urlparse(s.opensearch_url)
    return OpenSearch(hosts=[{'host':url.hostname, 'port':url.port or (443 if url.scheme=='https' else 80)}], http_auth=(s.opensearch_username,s.opensearch_password) if s.opensearch_username else None, use_ssl=url.scheme=='https', verify_certs=url.scheme=='https', ca_certs=s.opensearch_ca_file or None, timeout=10)

def ensure_index(c):
    if not c.indices.exists(index=get_settings().opensearch_index):
        c.indices.create(index=get_settings().opensearch_index, body=MAPPING)

def index_product(c, product, inventory):
    doc = {'sku':product.sku, 'name':product.name, 'description':product.description, 'category':product.category, 'price':float(product.price), 'active':product.active, 'cities':[i.city for i in inventory if i.quantity>0], 'stock_by_city':{i.city:i.quantity for i in inventory}}
    c.index(index=get_settings().opensearch_index, id=product.id, body=doc, refresh='wait_for')

def search_products(c, q, category, city, min_price, max_price, page, size):
    filters = [{'term':{'active':True}}]
    if category: filters.append({'term':{'category':category}})
    if city: filters.append({'term':{'cities':city}})
    price_range = {}
    if min_price is not None: price_range['gte']=float(min_price)
    if max_price is not None: price_range['lte']=float(max_price)
    if price_range: filters.append({'range':{'price':price_range}})
    query = {'bool': {'filter':filters, 'must':[{'multi_match':{'query':q, 'fields':['name^4','name.autocomplete^2','description','sku'], 'fuzziness':'AUTO'}}] if q else [{'match_all':{}}]}}
    result = c.search(index=get_settings().opensearch_index, body={'query':query, 'from':(page-1)*size, 'size':size})
    return {'total':result['hits']['total']['value'], 'page':page, 'items':[{'id':h['_id'], **h['_source']} for h in result['hits']['hits']]}
