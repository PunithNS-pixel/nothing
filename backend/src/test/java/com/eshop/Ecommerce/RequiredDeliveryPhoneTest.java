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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(properties="checkout.require.phone=true")
@AutoConfigureMockMvc
class RequiredDeliveryPhoneTest {
 @Autowired MockMvc mvc;
 @Autowired ObjectMapper json;
 @Autowired UserRepository users;
 @Autowired RoleRepository roles;
 @Autowired PasswordEncoder encoder;
 @Autowired CategoryRepo categories;
 @Autowired ProductRepo products;
 @Autowired OrderRepo orders;

 @Test
 void deliveryAddressRequiresANameMobileAndSixDigitPin()throws Exception {
  String name="phone"+UUID.randomUUID().toString().substring(0,8);
  User buyer=new User(name,name+"@example.org",encoder.encode("MyPassword!2026"));
  buyer.setRoles(Set.of(roles.findByRoleName(AppRole.ROLE_USER).orElseThrow()));
  users.save(buyer);
  var login=mvc.perform(post("/api/auth/signin").contentType(MediaType.APPLICATION_JSON)
   .content(json.writeValueAsString(Map.of("username",name,"password","MyPassword!2026"))))
   .andExpect(status().isOk()).andReturn();
  Cookie cookie=login.getResponse().getCookie("nothingSession");assertNotNull(cookie);

  Map<String,Object> address=new HashMap<>(Map.of(
    "street","Example Main Road","buildingName","Apartment Block Alpha",
    "city","Bengaluru","state","Karnataka","country","India","pincode","560001"));
  mvc.perform(post("/api/addresses").cookie(cookie).contentType(MediaType.APPLICATION_JSON)
    .content(json.writeValueAsString(address))).andExpect(status().isBadRequest());
  address.put("recipientName","Demo Recipient");address.put("phoneNumber","123");
  mvc.perform(post("/api/addresses").cookie(cookie).contentType(MediaType.APPLICATION_JSON)
    .content(json.writeValueAsString(address))).andExpect(status().isBadRequest());
  address.put("phoneNumber","9876543210");address.put("addressLabel","HOME");
  var saved=mvc.perform(post("/api/addresses").cookie(cookie).contentType(MediaType.APPLICATION_JSON)
    .content(json.writeValueAsString(address))).andExpect(status().isCreated())
    .andExpect(jsonPath("$.phoneNumber").value("9876543210"))
    .andExpect(jsonPath("$.recipientName").value("Demo Recipient")).andReturn();
  long addressId=json.readTree(saved.getResponse().getContentAsString()).path("addressId").asLong();
  Category category=new Category();category.setCategoryName("Full COD Test "+UUID.randomUUID());category=categories.save(category);
  Product product=new Product();product.setProductName("Full COD Checkout Item");
  product.setDescription("Payment on delivery with required phone and address");
  product.setQuantity(10);product.setPrice(699.0);product.setSpecialPrice(699.0);product.setCategory(category);
  product=products.saveAndFlush(product);

  String items=json.writeValueAsString(List.of(Map.of("productId",product.getProductId(),"quantity",2)));
  mvc.perform(post("/api/cart/create").cookie(cookie).contentType(MediaType.APPLICATION_JSON)
    .content(items)).andExpect(status().isCreated());

  String checkoutId=UUID.randomUUID().toString();
  String orderBody=json.writeValueAsString(Map.of(
    "addressId",addressId,"checkoutToken",checkoutId,"pgName","COD","pgStatus","PENDING"));
  var order=mvc.perform(post("/api/order/users/payments/COD").cookie(cookie)
    .contentType(MediaType.APPLICATION_JSON).content(orderBody))
    .andExpect(status().isCreated()).andReturn();
  long orderId=json.readTree(order.getResponse().getContentAsString()).path("orderId").asLong();
  assertTrue(orderId>0);
  assertEquals(8,products.findById(product.getProductId()).orElseThrow().getQuantity());

  // A network retry of the same checkout token returns the same order, no extra stock reduction.
  mvc.perform(post("/api/order/users/payments/COD").cookie(cookie)
    .contentType(MediaType.APPLICATION_JSON).content(orderBody))
    .andExpect(status().isCreated()).andExpect(jsonPath("$.orderId").value(orderId));
  assertEquals(8,products.findById(product.getProductId()).orElseThrow().getQuantity());
  mvc.perform(get("/api/customer/orders").cookie(cookie)).andExpect(status().isOk())
    .andExpect(jsonPath("$[0].orderId").value(orderId))
    .andExpect(jsonPath("$[0].payment.paymentMethod").value("CASH_ON_DELIVERY"))
    .andExpect(jsonPath("$[0].orderItems[0].quantity").value(2));
 }
}
