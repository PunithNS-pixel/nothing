package com.eshop.Ecommerce.Service;

import com.eshop.Ecommerce.Model.*;
import com.eshop.Ecommerce.Repositories.*;
import com.eshop.Ecommerce.Util.AuthUtil;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;
import java.util.HexFormat;

@Service
public class EmailVerificationService {
 private final EmailVerificationChallengeRepository challenges;
 private final UserRepository users;
 private final AuthUtil auth;
 private final PasswordEncoder encoder;
 private final ObjectProvider<JavaMailSender> mailers;
 private final SecureRandom random=new SecureRandom();

 @Value("${nothing.email.verification.required:false}") private boolean required;
 @Value("${nothing.email.from:}") private String from;

 public EmailVerificationService(EmailVerificationChallengeRepository challenges,
  UserRepository users,AuthUtil auth,PasswordEncoder encoder,ObjectProvider<JavaMailSender> mailers){
  this.challenges=challenges;this.users=users;this.auth=auth;this.encoder=encoder;this.mailers=mailers;
 }
 public boolean required(){return required;}
 public boolean available(){return mailers.getIfAvailable()!=null && from!=null && !from.isBlank();}
 public record EmailRequest(@NotBlank @Email String email){}
 public record CodeRequest(@NotBlank @Email String email,@NotBlank String code){}
 public record TokenRequest(@NotBlank String token){}
 public record Proof(String token){}
 public record Config(boolean required,boolean available){}
 public record State(boolean required,boolean verified,String email){}

 private static String normalized(String email){
  if(email==null||email.isBlank()||!email.contains("@")||email.length()>150)
   throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Valid email required");
  return email.trim().toLowerCase(Locale.ROOT);
 }
 private static String digest(String token){
  try{
   return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
    .digest(token.getBytes(StandardCharsets.UTF_8)));
  }catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}
 }

 @Transactional
 public void start(String input){
  if(!available())throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
   "Email verification requires SMTP_HOST and SMTP_FROM. Configure an email provider first.");
  String email=normalized(input);
  Instant now=Instant.now();
  EmailVerificationChallenge challenge=challenges.findById(email).orElseGet(EmailVerificationChallenge::new);
  if(challenge.getCreatedAt()!=null && now.isBefore(challenge.getCreatedAt().plusSeconds(60)))
   throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS,"Wait 60 seconds before requesting another code");
  String code=String.format(Locale.ROOT,"%06d",random.nextInt(1000000));
  challenge.setEmail(email);challenge.setCodeHash(encoder.encode(code));
  challenge.setProofHash(null);challenge.setProofExpiresAt(null);
  challenge.setAttempts(0);challenge.setCreatedAt(now);challenge.setExpiresAt(now.plusSeconds(600));
  challenges.saveAndFlush(challenge);
  SimpleMailMessage message=new SimpleMailMessage();
  message.setFrom(from);message.setTo(email);message.setSubject("Nothing Market — Verify your email");
  message.setText("Your Nothing Market verification code is "+code+
   ". It expires in 10 minutes. Do not share this code.");
  try{mailers.getObject().send(message);}
  catch(Exception e){throw new ResponseStatusException(HttpStatus.BAD_GATEWAY,
    "Verification email could not be delivered. Check SMTP configuration.");}
 }

 @Transactional(noRollbackFor=ResponseStatusException.class)
 public Proof confirm(String input,String code){
  String email=normalized(input);
  EmailVerificationChallenge c=challenges.findById(email).orElseThrow(()->
    new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid or expired verification code"));
  if(c.getCodeHash()==null || c.getExpiresAt()==null || Instant.now().isAfter(c.getExpiresAt())
    || c.getAttempts()>=5)throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid or expired verification code");
  if(code==null||!code.matches("[0-9]{6}")||!encoder.matches(code,c.getCodeHash())){
   c.setAttempts(c.getAttempts()+1);challenges.save(c);
   throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Invalid or expired verification code");
  }
  String token=UUID.randomUUID().toString()+"-"+UUID.randomUUID();
  c.setCodeHash(null);c.setExpiresAt(null);
  c.setProofHash(digest(token));c.setProofExpiresAt(Instant.now().plusSeconds(900));
  challenges.save(c);
  return new Proof(token);
 }

 @Transactional
 public void consumeVerifiedProof(String input,String token){
  String email=normalized(input);
  if(token==null||token.isBlank())throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Verify your email first");
  EmailVerificationChallenge c=challenges.findById(email).orElseThrow(()->
    new ResponseStatusException(HttpStatus.BAD_REQUEST,"Email verification required"));
  String provided=digest(token);
  if(c.getProofHash()==null||c.getProofExpiresAt()==null
   ||Instant.now().isAfter(c.getProofExpiresAt())
   ||!MessageDigest.isEqual(HexFormat.of().parseHex(c.getProofHash()),HexFormat.of().parseHex(provided)))
   throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Email verification expired; request a new code");
  c.setProofHash(null);c.setProofExpiresAt(null);challenges.save(c);
 }

 @Transactional
 public State activateAccount(String token){
  User current=auth.loggedInUser();
  if(!current.isEmailVerified()){
   consumeVerifiedProof(current.getEmail(),token);
   current.setEmailVerified(true);
   users.save(current);
  }
  return new State(required,true,current.getEmail());
 }

 public State status(){
  User current=auth.loggedInUser();
  return new State(required,current.isEmailVerified(),current.getEmail());
 }
 public Config config(){return new Config(required,available());}
}
