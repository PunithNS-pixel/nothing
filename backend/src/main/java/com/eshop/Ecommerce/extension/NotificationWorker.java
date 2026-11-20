package com.eshop.Ecommerce.extension;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;
@Component
public class NotificationWorker {
 @RabbitListener(queues="nothing.notifications")
 public void notifyCustomer(String message){org.slf4j.LoggerFactory.getLogger(getClass()).info("Queued notification: {}",message);}
 @Configuration static class Queues {@Bean Queue notificationQueue(){return new Queue("nothing.notifications",true);}}
}