package com.eshop.Ecommerce.Controller;

import com.eshop.Ecommerce.Model.*;
import com.eshop.Ecommerce.Repositories.*;
import com.eshop.Ecommerce.Util.AuthUtil;
import org.springframework.http.*;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.net.URI;
import java.util.*;

@RestController
@RequestMapping("/api/seller/products")
public class ProductGalleryManagementController {
 private final ProductGalleryImageRepository gallery;
 private final ProductRepo products;
 private final AuthUtil auth;
 public ProductGalleryManagementController(ProductGalleryImageRepository gallery,ProductRepo products,AuthUtil auth){
  this.gallery=gallery;this.products=products;this.auth=auth;
 }
 public record GalleryRequest(List<String> images){}
 public record GalleryResponse(Long productId,List<String> images){}

 /**
  * Seller or admin supplies rights-cleared photographs of the SAME product.
  * No direct Amazon / Flipkart hotlinking or fabricated alternative angles.
  */
 @PutMapping("/{productId}/gallery")
 @Transactional
 public GalleryResponse replace(@PathVariable Long productId,@RequestBody GalleryRequest request){
  User actor=auth.loggedInUser();
  Product product=products.findById(productId)
   .orElseThrow(()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Product not found"));
  boolean admin=actor.getRoles().stream().anyMatch(r->r.getRoleName()==AppRole.ROLE_ADMIN);
  boolean owner=product.getUser()!=null&&product.getUser().getUserid().equals(actor.getUserid());
  if(!admin&&!owner)throw new ResponseStatusException(HttpStatus.FORBIDDEN,
   "Only a product owner or store administrator can modify product images");
  if(request==null||request.images()==null||request.images().size()>8)
   throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Provide up to 8 licensed product photos");
  List<String> clean=new ArrayList<>();
  for(String raw:request.images()){
   if(raw==null||raw.length()>1500)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid image URL");
   String url=raw.trim();
   URI uri;
   try{uri=URI.create(url)}catch(IllegalArgumentException e){
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid image URL");
   }
   String host=uri.getHost();
   if(!"https".equalsIgnoreCase(uri.getScheme())||host==null||uri.getUserInfo()!=null
    ||host.equalsIgnoreCase("localhost")||host.endsWith(".local")
    ||host.equals("127.0.0.1")||host.equals("::1")||url.contains("<")||url.contains(">"))
    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Only publicly hosted HTTPS product photos are accepted");
   if(!clean.contains(url)&&!url.equals(product.getImage()))clean.add(url);
  }
  gallery.deleteByProduct_ProductId(productId);
  List<ProductGalleryImage> updates=new ArrayList<>();
  for(int i=0;i<clean.size();i++)updates.add(new ProductGalleryImage(product,clean.get(i),i));
  gallery.saveAll(updates);
  return new GalleryResponse(productId,clean);
 }
}
