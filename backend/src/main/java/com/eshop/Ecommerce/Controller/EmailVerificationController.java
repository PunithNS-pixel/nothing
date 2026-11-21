package com.eshop.Ecommerce.Controller;

import com.eshop.Ecommerce.Service.EmailVerificationService;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/auth/email")
public class EmailVerificationController {
 private final EmailVerificationService service;
 public EmailVerificationController(EmailVerificationService service){this.service=service;}
 @GetMapping("/config")
 public EmailVerificationService.Config config(){return service.config();}
 @PostMapping("/start")
 public Map<String,String> start(@Valid @RequestBody EmailVerificationService.EmailRequest request){
  service.start(request.email());return Map.of("message","Check your email for a six-digit verification code.");
 }
 @PostMapping("/confirm")
 public EmailVerificationService.Proof confirm(@Valid @RequestBody EmailVerificationService.CodeRequest request){
  return service.confirm(request.email(),request.code());
 }
 @GetMapping("/status")
 public EmailVerificationService.State status(){return service.status();}
 @PostMapping("/activate")
 public EmailVerificationService.State activate(@Valid @RequestBody EmailVerificationService.TokenRequest request){
  return service.activateAccount(request.token());
 }
}
