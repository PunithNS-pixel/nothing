package com.eshop.Ecommerce.extension;
import com.eshop.Ecommerce.Repositories.ProductRepo;
import com.fasterxml.jackson.databind.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.net.*;import java.net.http.*;import java.nio.charset.StandardCharsets;import java.util.*;
@Service
public class OpenSearchCatalog {
 private final ProductRepo products;private final ObjectMapper mapper;private final HttpClient client=HttpClient.newHttpClient();
 private final String url,user,password;
 public OpenSearchCatalog(ProductRepo products,ObjectMapper mapper,@Value("${nothing.search.url}")String url,@Value("${nothing.search.username:}")String user,@Value("${nothing.search.password:}")String password){
  this.products=products;this.mapper=mapper;this.url=url.replaceAll("/$","");this.user=user;this.password=password;
 }
 private JsonNode call(String method,String path,Object payload){
  try{
   var b=HttpRequest.newBuilder(URI.create(url+path)).header("Content-Type","application/json").timeout(java.time.Duration.ofSeconds(10));
   if(!user.isBlank())b.header("Authorization","Basic "+Base64.getEncoder().encodeToString((user+":"+password).getBytes(StandardCharsets.UTF_8)));
   b.method(method,payload==null?HttpRequest.BodyPublishers.noBody():HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)));
   var response=client.send(b.build(),HttpResponse.BodyHandlers.ofString());
   if(response.statusCode()>=300)throw new IllegalStateException("OpenSearch HTTP "+response.statusCode()+": "+response.body());
   return response.body().isBlank()?mapper.createObjectNode():mapper.readTree(response.body());
  }catch(IllegalStateException e){throw e;}catch(Exception e){throw new IllegalStateException("OpenSearch unavailable",e);}
 }
 public void ensureIndex(){
  try{call("HEAD","/nothing-products",null);return;}
  catch(IllegalStateException e){if(!e.getMessage().contains("HTTP 404"))throw e;}
  try{call("PUT","/nothing-products",Map.of("mappings",Map.of("properties",Map.of(
    "productId",Map.of("type","long"),"productName",Map.of("type","text"),
    "description",Map.of("type","text"),"category",Map.of("type","keyword"),
    "city",Map.of("type","keyword"),"price",Map.of("type","double"),"quantity",Map.of("type","integer")))));}
  catch(IllegalStateException e){if(!e.getMessage().contains("resource_already_exists_exception"))throw e;}
 }
 public void index(long id){
  ensureIndex();
  products.findById(id).ifPresentOrElse(product->{
   Map<String,Object> doc=new LinkedHashMap<>();
   doc.put("productId",product.getProductId());doc.put("productName",product.getProductName());
   doc.put("description",product.getDescription());doc.put("category",product.getCategory()==null?"":product.getCategory().getCategoryName());
   doc.put("city","");doc.put("price",product.getSpecialPrice());doc.put("quantity",product.getQuantity());doc.put("image",product.getImage());
   call("PUT","/nothing-products/_doc/"+id,doc);
  },()->delete(id));
 }
 public void delete(long id){try{call("DELETE","/nothing-products/_doc/"+id,null);}catch(IllegalStateException e){if(!e.getMessage().contains("HTTP 404"))throw e;}}
 public JsonNode search(String q,String category,Double min,Double max,String city,int page,int size){
  if(page<0||size<1||size>100)throw new IllegalArgumentException("Invalid pagination");
  ensureIndex();List<Object> filters=new ArrayList<>();
  if(category!=null&&!category.isBlank())filters.add(Map.of("term",Map.of("category",category)));
  if(city!=null&&!city.isBlank())filters.add(Map.of("term",Map.of("city",city)));
  Map<String,Object> range=new HashMap<>();if(min!=null)range.put("gte",min);if(max!=null)range.put("lte",max);
  if(!range.isEmpty())filters.add(Map.of("range",Map.of("price",range)));
  Object match=q==null||q.isBlank()?Map.of("match_all",Map.of()):Map.of("multi_match",Map.of("query",q,"fields",List.of("productName^3","description"),"fuzziness","AUTO"));
  return call("POST","/nothing-products/_search",Map.of("from",page*size,"size",size,"query",Map.of("bool",Map.of("must",List.of(match),"filter",filters))));
 }
 public long reindex(){ensureIndex();long count=0;for(var product:products.findAll()){index(product.getProductId());count++;}return count;}
}