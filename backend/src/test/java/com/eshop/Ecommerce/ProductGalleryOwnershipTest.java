package com.eshop.Ecommerce;

import com.eshop.Ecommerce.Model.*;
import com.eshop.Ecommerce.Repositories.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class ProductGalleryOwnershipTest {
 @Autowired MockMvc mvc;
 @Autowired ObjectMapper json;
 @Autowired UserRepository users;
 @Autowired RoleRepository roles;
 @Autowired CategoryRepo categories;
 @Autowired ProductRepo products;
 @Autowired PasswordEncoder encoder;

 private record Account(User owner,Cookie cookie){}
 private Account seller()throws Exception{
  String name="gallery"+UUID.randomUUID().toString().substring(0,8);
  String password="SecurePassword!2026";
  User seller=new User(name,name+"@example.org",encoder.encode(password));
  seller.setRoles(Set.of(roles.findByRoleName(AppRole.ROLE_SELLER).orElseThrow()));
  seller=users.save(seller);
  var login=mvc.perform(post("/api/auth/signin").contentType(MediaType.APPLICATION_JSON)
   .content(json.writeValueAsString(Map.of("username",name,"password",password))))
   .andExpect(status().isOk()).andReturn();
  return new Account(seller,login.getResponse().getCookie("nothingSession"));
 }

 @Test
 void onlyOwnerCanSetDistinctLicensedGalleryPhotos()throws Exception{
  Account seller=seller(),outsider=seller();
  Category category=new Category();category.setCategoryName("Media Test "+UUID.randomUUID());category=categories.save(category);
  Product product=new Product();product.setProductName("Multi Angle Demo "+UUID.randomUUID().toString().substring(0,8));
  product.setDescription("Demo product with multiple rights-cleared image angles");
  product.setQuantity(5);product.setPrice(450.0);product.setSpecialPrice(450.0);
  product.setImage("https://images.unsplash.com/photo-main-product");product.setCategory(category);
  product.setUser(seller.owner());
  product=products.saveAndFlush(product);
  String path="/api/seller/products/"+product.getProductId()+"/gallery";
  String url1="https://images.unsplash.com/photo-detail-angle-one",url2="https://images.unsplash.com/photo-detail-angle-two";
  String body=json.writeValueAsString(Map.of("images",List.of(url1,url2,url1)));
  mvc.perform(put(path).contentType(MediaType.APPLICATION_JSON).content(body))
   .andExpect(status().isUnauthorized());
  mvc.perform(put(path).cookie(outsider.cookie()).contentType(MediaType.APPLICATION_JSON).content(body))
   .andExpect(status().isForbidden());
  mvc.perform(put(path).cookie(seller.cookie()).contentType(MediaType.APPLICATION_JSON)
   .content(json.writeValueAsString(Map.of("images",List.of("http://localhost/unsafe.png")))))
   .andExpect(status().isBadRequest());
  mvc.perform(put(path).cookie(seller.cookie()).contentType(MediaType.APPLICATION_JSON).content(body))
   .andExpect(status().isOk()).andExpect(jsonPath("$.images.length()").value(2));

  // A product detail gallery must expose the actual seller-supplied URLs.
  var catalog=mvc.perform(get("/api/store/catalog")).andExpect(status().isOk()).andReturn();
  var records=json.readTree(catalog.getResponse().getContentAsString());
  boolean found=false;
  for(var p:records){
   if(p.path("productId").asLong()==product.getProductId()){
    assertEquals(url1,p.path("images").get(0).asText());
    assertEquals(url2,p.path("images").get(1).asText());
    found=true;
   }
  }
  assertTrue(found,"Seller's product must appear in the catalog with its gallery");
 }
}
