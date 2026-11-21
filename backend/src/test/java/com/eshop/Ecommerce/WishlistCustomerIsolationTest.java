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
class WishlistCustomerIsolationTest {
 @Autowired MockMvc mvc;
 @Autowired ObjectMapper json;
 @Autowired UserRepository users;
 @Autowired RoleRepository roles;
 @Autowired ProductRepo products;
 @Autowired CategoryRepo categories;
 @Autowired PasswordEncoder encoder;

 private Cookie signIn(String prefix)throws Exception{
  String username=prefix+UUID.randomUUID().toString().substring(0,8);
  String password="SamplePassword!2026";
  User buyer=new User(username,username+"@example.org",encoder.encode(password));
  buyer.setRoles(Set.of(roles.findByRoleName(AppRole.ROLE_USER).orElseThrow()));
  users.save(buyer);
  var login=mvc.perform(post("/api/auth/signin")
   .contentType(MediaType.APPLICATION_JSON)
   .content(json.writeValueAsString(Map.of("username",username,"password",password))))
   .andExpect(status().isOk()).andReturn();
  return login.getResponse().getCookie("nothingSession");
 }
 @Test
 void wishlistPersistsAndIsIsolatedPerSignedInCustomer()throws Exception{
  Cookie buyer=signIn("wish");
  Cookie other=signIn("other");
  Category category=new Category();category.setCategoryName("Saved Test "+UUID.randomUUID());category=categories.save(category);
  Product product=new Product();
  product.setProductName("Wishlist Test Item "+UUID.randomUUID().toString().substring(0,8));
  product.setDescription("Product for account-specific saved-items test");
  product.setQuantity(5);product.setPrice(199.0);product.setSpecialPrice(199.0);product.setCategory(category);
  product=products.saveAndFlush(product);
  long id=product.getProductId();

  mvc.perform(get("/api/wishlist")).andExpect(status().isUnauthorized());
  mvc.perform(post("/api/wishlist/"+id).cookie(buyer)).andExpect(status().isOk())
   .andExpect(jsonPath("$.productId").value(id));
  mvc.perform(post("/api/wishlist/"+id).cookie(buyer)).andExpect(status().isOk());
  mvc.perform(get("/api/wishlist").cookie(buyer)).andExpect(status().isOk())
   .andExpect(jsonPath("$.length()").value(1))
   .andExpect(jsonPath("$[0].name").value(product.getProductName()));
  mvc.perform(get("/api/wishlist").cookie(other)).andExpect(status().isOk())
   .andExpect(jsonPath("$.length()").value(0));
  mvc.perform(delete("/api/wishlist/"+id).cookie(other)).andExpect(status().isNoContent());
  mvc.perform(get("/api/wishlist").cookie(buyer)).andExpect(jsonPath("$.length()").value(1));
  mvc.perform(delete("/api/wishlist/"+id).cookie(buyer)).andExpect(status().isNoContent());
  mvc.perform(get("/api/wishlist").cookie(buyer)).andExpect(jsonPath("$.length()").value(0));
 }
}
