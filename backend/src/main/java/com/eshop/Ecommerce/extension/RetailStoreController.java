package com.eshop.Ecommerce.extension;
import com.eshop.Ecommerce.Model.Product;
import com.eshop.Ecommerce.Repositories.ProductRepo;
import com.eshop.Ecommerce.Repositories.CategoryRepo;
import com.eshop.Ecommerce.Repositories.OrderRepo;
import com.eshop.Ecommerce.Util.AuthUtil;
import com.eshop.Ecommerce.Payload.OrderDTO;
import org.modelmapper.ModelMapper;
import org.springframework.web.bind.annotation.*;
import java.util.*;
@RestController
public class RetailStoreController {
 private final ProductRepo products;private final CategoryRepo categories;
 private final OrderRepo orders;private final AuthUtil auth;private final ModelMapper mapper;
 public RetailStoreController(ProductRepo products,CategoryRepo categories,OrderRepo orders,AuthUtil auth,ModelMapper mapper){
 this.products=products;this.categories=categories;this.orders=orders;this.auth=auth;this.mapper=mapper;
 }
 @GetMapping("/api/store/catalog")
 public List<Map<String,Object>> catalog(){
  return products.findAll().stream().filter(p->p.getQuantity()!=null && (p.getCategory()==null || !"Coffee".equalsIgnoreCase(p.getCategory().getCategoryName()))).map(this::publicProduct).toList();
 }
 private Map<String,Object> publicProduct(Product p){
  Map<String,Object> item=new LinkedHashMap<>();
  item.put("productId",p.getProductId());item.put("name",p.getProductName());item.put("description",p.getDescription());
  item.put("price",p.getSpecialPrice());item.put("originalPrice",p.getPrice());
  item.put("stock",p.getQuantity());item.put("city",p.getCity());
  item.put("category",p.getCategory()==null?"Other":p.getCategory().getCategoryName());
  item.put("image",p.getImage());item.put("brand",p.getBrand()==null||p.getBrand().isBlank()?"NOTHING SELECT":p.getBrand());return item;
 }
 @GetMapping("/api/store/categories")
 public List<String> categories(){
  return categories.findAll().stream().map(c->c.getCategoryName()).filter(n->!"Coffee".equalsIgnoreCase(n)).sorted().toList();
 }
 @GetMapping("/api/customer/orders")
 public List<OrderDTO> myOrders(){
  // Map only scalar fields while the repository query is complete.
  // ModelMapper previously traversed lazy orderItems after the Hibernate
  // session closed and could surface an unhelpful 401 from /error.
  return orders.findByEmailIgnoreCaseOrderByOrderDateDesc(auth.loggedInEmail()).stream()
   .map(o->{
     OrderDTO dto=new OrderDTO();
     dto.setOrderId(o.getOrderId());
     dto.setEmail(o.getEmail());
     dto.setOrderDate(o.getOrderDate());
     dto.setTotalAmount(o.getTotalAmount());
     dto.setOrderStatus(o.getOrderStatus());
     dto.setOrderItems(java.util.List.of());
     return dto;
   }).toList();
 }
}