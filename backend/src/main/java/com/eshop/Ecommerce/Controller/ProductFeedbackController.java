package com.eshop.Ecommerce.Controller;

import com.eshop.Ecommerce.Model.*;
import com.eshop.Ecommerce.Repositories.*;
import com.eshop.Ecommerce.Util.AuthUtil;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

@RestController
@RequestMapping("/api")
public class ProductFeedbackController {
 private final ProductFeedbackRepository feedback;
 private final ProductRepo products;
 private final AuthUtil auth;
 private final OrderRepo orders;
 public ProductFeedbackController(ProductFeedbackRepository feedback,ProductRepo products,
   AuthUtil auth,OrderRepo orders){
  this.feedback=feedback;this.products=products;this.auth=auth;this.orders=orders;
 }
 public record ReviewRequest(@NotNull @Min(1) @Max(5) Integer rating,
   @NotBlank @Size(max=1000) String comment){}
 public record Review(Long productId,Integer rating,String comment,OffsetDateTime updatedAt){}
 @GetMapping("/catalog/{productId}/feedback")
 @Transactional(readOnly=true)
 public List<Review> list(@PathVariable Long productId){
  if(!products.existsById(productId))
   throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Product not found");
  return feedback.findByProduct_ProductIdOrderByUpdatedAtDesc(productId).stream()
   .map(f->new Review(productId,f.rating,f.comment,f.updatedAt)).toList();
 }
 @PutMapping("/customer/feedback/{productId}")
 @Transactional
 public Review submit(@PathVariable Long productId,@Valid @RequestBody ReviewRequest request){
  User user=auth.loggedInUser();
  Product product=products.findById(productId).orElseThrow(
   ()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Product not found"));
  boolean purchased=orders.findByEmailIgnoreCaseOrderByOrderDateDesc(user.getEmail()).stream()
   .anyMatch(order->order.getOrderItems().stream().anyMatch(item->
    item.getProduct()!=null && productId.equals(item.getProduct().getProductId()) &&
    !"CANCELLED".equalsIgnoreCase(order.getOrderStatus())));
  if(!purchased)throw new ResponseStatusException(HttpStatus.FORBIDDEN,
   "Only customers who ordered this product can leave feedback");
  ProductFeedback item=feedback.findByUser_UseridAndProduct_ProductId(user.getUserid(),productId)
   .orElseGet(ProductFeedback::new);
  item.user=user;item.product=product;item.rating=request.rating();
  item.comment=request.comment().trim();item.updatedAt=OffsetDateTime.now(ZoneOffset.UTC);
  feedback.save(item);
  return new Review(productId,item.rating,item.comment,item.updatedAt);
 }
}
