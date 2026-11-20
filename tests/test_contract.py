from decimal import Decimal
from app.schemas import ProductIn, CartIn, Register
from app.search import search_products

def test_price_and_quantity_validation():
    from pydantic import ValidationError
    try: ProductIn(sku='a',name='x',category='c',price='-1'); assert False
    except ValidationError: pass
    try: CartIn(product_id='abc',city='Delhi',quantity=0); assert False
    except ValidationError: pass

def test_product_decimal():
    p=ProductIn(sku='a',name='x',category='c',price='29.99')
    assert p.price == Decimal('29.99')

class FakeSearch:
    def search(self,**kwargs):
        self.query=kwargs['body']
        return {'hits': {'total': {'value':1}, 'hits':[{'_id':'abc','_source':{'name':'Earbuds'}}]}}

def test_opensearch_query_filters():
    fake=FakeSearch()
    result=search_products(fake,'bluetoth','Electronics','Bengaluru',Decimal('100'),Decimal('2000'),1,20)
    assert result['total']==1
    assert result['items'][0]['id']=='abc'
    assert fake.query['query']['bool']['must'][0]['multi_match']['fuzziness']=='AUTO'
    assert len(fake.query['query']['bool']['filter'])==4
