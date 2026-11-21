package com.eshop.Ecommerce.extension;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.mail.Address;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Primary;
import org.springframework.mail.MailAuthenticationException;
import org.springframework.mail.MailException;
import org.springframework.mail.MailParseException;
import org.springframework.mail.MailPreparationException;
import org.springframework.mail.MailSendException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.mail.javamail.MimeMessagePreparator;
import org.springframework.stereotype.Component;

/**
 * Transactional Resend HTTPS Email API adapter for JavaMailSender.
 * Existing OTP + order confirmation services remain unchanged and never call
 * Resend directly. Only sender addresses configured by an operator are allowed.
 *
 * Resend accepts requests, not guaranteed final inbox delivery. The
 * PostgreSQL confirmation job remains authoritative for retries and status.
 */
@Component
@Primary
@ConditionalOnProperty(name="nothing.mail.provider", havingValue="resend")
public class ResendApiMailSender implements JavaMailSender {
 private static final URI API=URI.create("https://api.resend.com/emails");
 private final String apiKey;
 private final String from;
 private final String fromAddress;
 private final ObjectMapper json;
 private final HttpClient http;

 @Autowired
 public ResendApiMailSender(
     @Value("${RESEND_API_KEY:}") String apiKey,
     @Value("${EMAIL_FROM:}") String from,
     ObjectMapper json) {
  this(apiKey,from,json,HttpClient.newBuilder()
    .connectTimeout(Duration.ofSeconds(8))
    .followRedirects(HttpClient.Redirect.NEVER).build());
 }

 ResendApiMailSender(String apiKey,String from,ObjectMapper json,HttpClient http) {
  if(blank(apiKey)||blank(from))throw new IllegalStateException(
    "MAIL_PROVIDER=resend requires RESEND_API_KEY and a verified EMAIL_FROM");
  try {
   InternetAddress[] parsed=InternetAddress.parse(from,true);
   if(parsed.length!=1||blank(parsed[0].getAddress()))
    throw new IllegalArgumentException("Exactly one EMAIL_FROM is required");
   parsed[0].validate();
   this.fromAddress=parsed[0].getAddress();
  }catch(Exception ex){throw new IllegalStateException("EMAIL_FROM is not a valid sender address");}
  this.apiKey=apiKey;this.from=from;this.json=json;this.http=http;
 }

 private static boolean blank(String s){return s==null||s.isBlank();}
 @Override public MimeMessage createMimeMessage(){
  return new MimeMessage(Session.getInstance(new Properties()));
 }
 @Override public MimeMessage createMimeMessage(InputStream stream) throws MailException {
  try{return new MimeMessage(Session.getInstance(new Properties()),stream);}
  catch(MessagingException ex){throw new MailParseException(ex);}
 }

 private static String[] addresses(Address[] a) throws MessagingException {
  if(a==null||a.length==0)return new String[0];
  String[] result=new String[a.length];
  for(int i=0;i<a.length;i++){
   if(!(a[i] instanceof InternetAddress ia))
    throw new MessagingException("Unsupported mail recipient address type");
   ia.validate();
   result[i]=ia.getAddress();
  }
  return result;
 }

 private static class Content {
  String text;
  String html;
 }
 private static void extract(Part part,Content content)throws Exception {
  if(part.isMimeType("text/plain")){
   content.text=(String)part.getContent();
  }else if(part.isMimeType("text/html")){
   content.html=(String)part.getContent();
  }else if(part.isMimeType("multipart/*")){
   Multipart multipart=(Multipart)part.getContent();
   for(int i=0;i<multipart.getCount();i++)extract(multipart.getBodyPart(i),content);
  }else{
   throw new MessagingException("Resend mail adapter only supports text and HTML, not attachments");
  }
 }

 @Override public void send(MimeMessage mail) throws MailException {
  if(mail==null)throw new MailPreparationException(new IllegalArgumentException("Null email"));
  try {
   // JavaMailSender normally saves MIME headers before sending. Without this,
   // MimeMessageHelper's multipart content can still advertise text/plain.
   mail.saveChanges();
   Address[] froms=mail.getFrom();
   if(froms==null||froms.length!=1 || !(froms[0] instanceof InternetAddress origin)
      || !fromAddress.equalsIgnoreCase(origin.getAddress()))
    throw new MailPreparationException(new IllegalArgumentException("Sender must match configured EMAIL_FROM"));
   String[] to=addresses(mail.getRecipients(Message.RecipientType.TO));
   if(to.length==0)throw new MessagingException("Email recipient is required");
   Content content=new Content();
   extract(mail,content);
   if(blank(content.text)&&blank(content.html))throw new MessagingException("Missing email body");

   Map<String,Object> payload=new LinkedHashMap<>();
   payload.put("from",from);
   payload.put("to",to);
   String[] cc=addresses(mail.getRecipients(Message.RecipientType.CC));
   String[] bcc=addresses(mail.getRecipients(Message.RecipientType.BCC));
   if(cc.length>0)payload.put("cc",cc);
   if(bcc.length>0)payload.put("bcc",bcc);
   payload.put("subject",mail.getSubject()==null?"":mail.getSubject());
   if(!blank(content.text))payload.put("text",content.text);
   if(!blank(content.html))payload.put("html",content.html);

   HttpRequest.Builder builder=HttpRequest.newBuilder(API)
     .timeout(Duration.ofSeconds(20))
     .header("Authorization","Bearer "+apiKey)
     .header("Content-Type","application/json")
     .POST(HttpRequest.BodyPublishers.ofString(
       json.writeValueAsString(payload),StandardCharsets.UTF_8));
   String idempotency=mail.getHeader("X-Nothing-Idempotency-Key",null);
   if(!blank(idempotency) && idempotency.length()<=256
      && idempotency.matches("[A-Za-z0-9_.:-]+"))
    builder.header("Idempotency-Key",idempotency);
   HttpResponse<String> response=http.send(builder.build(),HttpResponse.BodyHandlers.ofString());
   // Never log third-party response bodies; they can include PII.
   int status=response.statusCode();
   if(status==401||status==403)
    throw new MailAuthenticationException("Resend refused mail authorization (HTTP "+status+")");
   if(status<200||status>=300)
    throw new MailSendException("Resend rejected email (HTTP "+status+")");
   JsonNode ack=json.readTree(response.body());
   if(blank(ack.path("id").asText("")))
    throw new MailSendException("Resend returned success without an email ID");
  }catch(MailException ex){throw ex;}
   catch(InterruptedException ex){
    Thread.currentThread().interrupt();
    throw new MailSendException("Resend HTTP delivery interrupted",ex);
   }catch(Exception ex){
    throw new MailSendException("Resend HTTP delivery failed ("+ex.getClass().getSimpleName()+")",ex);
   }
 }

 @Override public void send(MimeMessage... messages) throws MailException {
  for(MimeMessage message:messages)send(message);
 }
 @Override public void send(MimeMessagePreparator preparator) throws MailException {
  try {
   MimeMessage message=createMimeMessage();
   preparator.prepare(message);
   send(message);
  }catch(MailException ex){throw ex;}
   catch(Exception ex){throw new MailPreparationException(ex);}
 }
 @Override public void send(MimeMessagePreparator... preparators) throws MailException {
  for(MimeMessagePreparator p:preparators)send(p);
 }
 @Override public void send(SimpleMailMessage simple) throws MailException {
  if(simple==null)throw new MailPreparationException(new IllegalArgumentException("Null email"));
  try {
   MimeMessage mime=createMimeMessage();
   MimeMessageHelper helper=new MimeMessageHelper(mime,false,"UTF-8");
   helper.setFrom(blank(simple.getFrom())?from:simple.getFrom());
   if(simple.getTo()==null||simple.getTo().length==0)
    throw new IllegalArgumentException("Missing email recipient");
   helper.setTo(simple.getTo());
   if(simple.getCc()!=null)helper.setCc(simple.getCc());
   if(simple.getBcc()!=null)helper.setBcc(simple.getBcc());
   if(simple.getReplyTo()!=null)helper.setReplyTo(simple.getReplyTo());
   helper.setSubject(simple.getSubject()==null?"":simple.getSubject());
   helper.setText(simple.getText()==null?"":simple.getText());
   if(simple.getSentDate()!=null)helper.setSentDate(simple.getSentDate());
   send(mime);
  }catch(MailException ex){throw ex;}
   catch(Exception ex){throw new MailPreparationException(ex);}
 }
 @Override public void send(SimpleMailMessage... messages) throws MailException {
  for(SimpleMailMessage message:messages)send(message);
 }
}
