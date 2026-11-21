package com.eshop.Ecommerce.extension;

import com.eshop.Ecommerce.Repositories.OrderRepo;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;
import java.util.regex.*;

/**
 * RabbitMQ-backed order confirmation delivery. Only enable when a real SMTP
 * provider is configured. The durable queue retains messages while disabled.
 * Delivery is at-least-once, not guaranteed exactly-once.
 */
@Component
@ConditionalOnProperty(name="nothing.notifications.mail-enabled",havingValue="true")
public class NotificationWorker {
 private static final Pattern ORDER_MESSAGE=Pattern.compile("^Order ([0-9]{1,19}) placed$");
 private final OrderRepo orders;
 private final JavaMailSender mail;
 private final String sender;

 public NotificationWorker(OrderRepo orders,JavaMailSender mail,
   @Value("${nothing.mail.from:}") String sender){
  this.orders=orders;this.mail=mail;this.sender=sender;
  if(sender.isBlank())throw new IllegalStateException("EMAIL_FROM is required when mail notifications are enabled");
 }

 @RabbitListener(queues="nothing.notifications")
 public void notifyCustomer(String message){
  Matcher match=ORDER_MESSAGE.matcher(message);
  if(!match.matches())throw new IllegalArgumentException("Unsupported notification message format");
  Long id=Long.valueOf(match.group(1));
  var order=orders.findById(id).orElseThrow(()->new IllegalStateException("Order unavailable for confirmation"));
  SimpleMailMessage email=new SimpleMailMessage();
  email.setFrom(sender);email.setTo(order.getEmail());
  email.setSubject("NOTHING Market — order #"+id+" confirmed");
  String payment=order.getPayment()==null?"See order details":order.getPayment().getPgName();
  email.setText("Your order #"+id+" has been placed.\n"+
   "Total: INR "+order.getTotalAmount()+"\n"+
   "Payment method: "+payment+"\n"+
   "Track your order from your NOTHING Market account.\n"+
   "Tracking milestones are updated by store staff, not real-time courier GPS.");
  // Throw on SMTP failure so RabbitMQ does not acknowledge the message as sent.
  mail.send(email);
 }

 @Configuration
 static class Queues {
  @Bean Queue notificationQueue(){return new Queue("nothing.notifications",true);}
 }
}
