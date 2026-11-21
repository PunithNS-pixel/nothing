package com.eshop.Ecommerce.extension;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.mail.internet.MimeMessage;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Flow;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailSendException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.MimeMessageHelper;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** All Resend HTTP traffic is mocked; CI does not send actual email. */
class ResendApiMailSenderTest {
 private final HttpClient http=mock(HttpClient.class);
 private final ObjectMapper json=new ObjectMapper();
 private final String from="orders@verified.example.org";
 private ResendApiMailSender sender(){
  return new ResendApiMailSender("re_fake_testing_only",from,json,http);
 }
 @SuppressWarnings("unchecked")
 private HttpResponse<String> response(int code,String body){
  HttpResponse<String> result=(HttpResponse<String>)mock(HttpResponse.class);
  when(result.statusCode()).thenReturn(code);
  when(result.body()).thenReturn(body);
  return result;
 }
 private void stub(int code,String body)throws Exception{
  HttpResponse<String> reply=response(code,body);
  when(http.send(any(HttpRequest.class),
    org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any()))
    .thenReturn(reply);
 }
 @Test void htmlOrderReceiptUsesIdempotencyAndPrivateResendAuthorization()throws Exception{
  stub(200,"{\"id\":\"email-order-42\"}");
  var sender=sender();
  MimeMessage message=sender.createMimeMessage();
  MimeMessageHelper h=new MimeMessageHelper(message,true,"UTF-8");
  h.setFrom(from);
  h.setTo("customer@example.net");
  h.setSubject("Order #42 confirmed");
  h.setText("A paid order","<b>A paid order</b>");
  message.setHeader("X-Nothing-Idempotency-Key","nothing-order-confirmation-42");
  sender.send(message);
  ArgumentCaptor<HttpRequest> captor=ArgumentCaptor.forClass(HttpRequest.class);
  verify(http).send(captor.capture(),
    org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any());
  var request=captor.getValue();
  assertEquals("https://api.resend.com/emails",request.uri().toString());
  assertEquals("Bearer re_fake_testing_only",
    request.headers().firstValue("Authorization").orElseThrow());
  assertEquals("nothing-order-confirmation-42",
    request.headers().firstValue("Idempotency-Key").orElseThrow());
  var payload=json.readTree(body(request));
  assertEquals(from,payload.path("from").asText());
  assertEquals("customer@example.net",payload.path("to").get(0).asText());
  assertEquals("Order #42 confirmed",payload.path("subject").asText());
  assertTrue(payload.path("html").asText().contains("<b>A paid order</b>"));
  assertTrue(payload.path("text").asText().contains("A paid order"));
  assertFalse(body(request).contains("re_fake_testing_only"));
 }
 @Test void signupOtpIsSentWithTextBody()throws Exception{
  stub(200,"{\"id\":\"email-otp-42\"}");
  var mail=new SimpleMailMessage();
  mail.setFrom(from);mail.setTo("customer@example.net");
  mail.setSubject("Verify your email");
  mail.setText("Your verification code is 123456");
  sender().send(mail);
  ArgumentCaptor<HttpRequest> captor=ArgumentCaptor.forClass(HttpRequest.class);
  verify(http).send(captor.capture(),
    org.mockito.ArgumentMatchers.<HttpResponse.BodyHandler<String>>any());
  var request=captor.getValue();
  var data=json.readTree(body(request));
  assertTrue(data.path("text").asText().contains("123456"));
  assertFalse(request.headers().firstValue("Idempotency-Key").isPresent());
 }
 @Test void invalidApiKeyFailsClosed()throws Exception{
  stub(403,"{\"name\":\"validation_error\",\"message\":\"secret information\"}");
  var mail=new SimpleMailMessage();
  mail.setTo("customer@example.net");mail.setSubject("Verify");
  mail.setText("Code");
  var e=assertThrows(MailAuthenticationException.class,()->sender().send(mail));
  assertFalse(e.getMessage().contains("secret information"));
 }
 @Test void quotaLimitIsRetryableFailure()throws Exception{
  stub(429,"{\"message\":\"Too many requests\"}");
  var mail=new SimpleMailMessage();
  mail.setTo("customer@example.net");mail.setText("Code");
  assertThrows(MailSendException.class,()->sender().send(mail));
 }
 @Test void missingKeyOrMismatchedSenderIsRejected()throws Exception{
  assertThrows(IllegalStateException.class,
    ()->new ResendApiMailSender("","orders@verified.example.org",json,http));
  var mail=new SimpleMailMessage();
  mail.setFrom("attacker@example.org");mail.setTo("customer@example.net");mail.setText("Bad");
  assertThrows(org.springframework.mail.MailPreparationException.class,
    ()->sender().send(mail));
  verifyNoInteractions(http);
 }
 private static String body(HttpRequest request){
  var bytes=new java.io.ByteArrayOutputStream();
  request.bodyPublisher().orElseThrow().subscribe(new Flow.Subscriber<>() {
   public void onSubscribe(Flow.Subscription subscription){subscription.request(Long.MAX_VALUE);}
   public void onNext(ByteBuffer buffer){
    byte[] incoming=new byte[buffer.remaining()];
    buffer.get(incoming);bytes.writeBytes(incoming);
   }
   public void onError(Throwable error){throw new IllegalStateException(error);}
   public void onComplete(){}
  });
  return bytes.toString(StandardCharsets.UTF_8);
 }
}
