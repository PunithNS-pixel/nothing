package com.eshop.Ecommerce.Controller;

import com.eshop.Ecommerce.Model.*;
import com.eshop.Ecommerce.Repositories.*;
import com.eshop.Ecommerce.Util.AuthUtil;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.*;
import java.util.*;

@RestController
@RequestMapping("/api/wishlist")
public class WishlistController {
 private final WishlistRepository wishlist;
 private final ProductRepo products;
 private final AuthUtil auth;
 public WishlistController(WishlistRepository wishlist,ProductRepo products,AuthUtil auth){
  this.wishlist=wishlist;this.products=products;this.auth=auth;
 }
 public record SavedItem(Long productId,String name,String image,String category,
   double price,Integer stock){}
 private SavedItem details(WishlistItem item){
  Product p=item.getProduct();
  return new SavedItem(p.getProductId(),p.getProductName(),p.getImage(),
   p.getCategory()==null?"Other":p.getCategory().getCategoryName(),
   p.getSpecialPrice(),p.getQuantity());
 }
 @GetMapping
 @Transactional(readOnly=true)
 public List<SavedItem> list(){
  return wishlist.findByUser_UseridOrderByIdDesc(auth.loggedInUser().getUserid())
    .stream().map(this::details).toList();
 }
 @PostMapping("/{productId}")
 @Transactional
 public SavedItem add(@PathVariable Long productId){
  User user=auth.loggedInUser();
  Product product=products.findById(productId)
   .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Product not found"));
  WishlistItem item=wishlist.findByUser_UseridAndProduct_ProductId(user.getUserid(),productId)
   .orElseGet(()->wishlist.save(new WishlistItem(user,product)));
  return details(item);
 }
 @DeleteMapping("/{productId}")
 @ResponseStatus(HttpStatus.NO_CONTENT)
 @Transactional
 public void remove(@PathVariable Long productId){
  Long userId=auth.loggedInUser().getUserid();
  wishlist.findByUser_UseridAndProduct_ProductId(userId,productId).ifPresent(wishlist::delete);
 }
}
