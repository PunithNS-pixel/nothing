package com.eshop.Ecommerce;

import com.eshop.Ecommerce.Model.User;
import com.eshop.Ecommerce.Repositories.UserRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.web.servlet.MockMvc;
import org.mockito.ArgumentCaptor;
import java.util.*;
import java.util.regex.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Simulate an email provider; never use a real mailbox or live SMTP server in CI. */
@SpringBootTest(properties={"nothing.email.verification.required=true","nothing.email.from=noreply@demo.example","management.health.mail.enabled=false","spring.mail.host=smtp.test.invalid"})
@AutoConfigureMockMvc
class EmailVerificationRegistrationTest {
 @Autowired MockMvc mvc;
 @Autowired ObjectMapper mapper;
 @Autowired UserRepository users;
 @MockBean JavaMailSender mailSender;

 @Test
 void requiresDeliveredOtpAndRejectsReusedProof()throws Exception {
  String name="mail"+UUID.randomUUID().toString().substring(0,8);
  String email=name+"@example.org";
  String signup=mapper.writeValueAsString(Map.of("username",name,
    "email",email,"password","LongSamplePassword!2026"));
  mvc.perform(get("/api/auth/email/config")).andExpect(status().isOk())
    .andExpect(jsonPath("$.required").value(true))
    .andExpect(jsonPath("$.available").value(true));
  mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
    .content(signup)).andExpect(status().isBadRequest());
  assertTrue(users.findByEmailIgnoreCase(email).isEmpty(),
      "An address without inbox ownership proof must never be registered");

  mvc.perform(post("/api/auth/email/start").contentType(MediaType.APPLICATION_JSON)
    .content(mapper.writeValueAsString(Map.of("email",email)))).andExpect(status().isOk());
  ArgumentCaptor<SimpleMailMessage> captured=ArgumentCaptor.forClass(SimpleMailMessage.class);
  verify(mailSender,times(1)).send(captured.capture());
  SimpleMailMessage sent=captured.getValue();
  assertArrayEquals(new String[]{email},sent.getTo());
  Matcher match=Pattern.compile("([0-9]{6})").matcher(sent.getText());
  assertTrue(match.find());
  String code=match.group(1);

  mvc.perform(post("/api/auth/email/confirm").contentType(MediaType.APPLICATION_JSON)
    .content(mapper.writeValueAsString(Map.of("email",email,"code","invalid"))))
    .andExpect(status().isBadRequest());

  var confirmed=mvc.perform(post("/api/auth/email/confirm")
    .contentType(MediaType.APPLICATION_JSON)
    .content(mapper.writeValueAsString(Map.of("email",email,"code",code))))
    .andExpect(status().isOk()).andReturn();
  String proof=mapper.readTree(confirmed.getResponse().getContentAsString()).path("token").asText();
  assertFalse(proof.isBlank());
  var registration=Map.of("username",name,"email",email,
    "password","LongSamplePassword!2026","emailVerificationToken",proof);
  mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
    .content(mapper.writeValueAsString(registration))).andExpect(status().isOk());
  User stored=users.findByEmailIgnoreCase(email).orElseThrow();
  assertTrue(stored.isEmailVerified(),"Verified inbox ownership should be persisted");
  // Verified email + wrong password must never authenticate.
  mvc.perform(post("/api/auth/signin").contentType(MediaType.APPLICATION_JSON)
    .content(mapper.writeValueAsString(Map.of("username",email,"password","WrongPassword!2026"))))
    .andExpect(status().isUnauthorized());
  // Signing in via the verified email requires the correct password.
  mvc.perform(post("/api/auth/signin").contentType(MediaType.APPLICATION_JSON)
    .content(mapper.writeValueAsString(Map.of("username",email,"password","LongSamplePassword!2026"))))
    .andExpect(status().isOk());
  // A consumed proof cannot activate any other signup, even with a new username.
  mvc.perform(post("/api/auth/signup").contentType(MediaType.APPLICATION_JSON)
    .content(mapper.writeValueAsString(Map.of("username",name+"2","email",email,
      "password","LongSamplePassword!2026","emailVerificationToken",proof))))
    .andExpect(status().isBadRequest());
 }
}
