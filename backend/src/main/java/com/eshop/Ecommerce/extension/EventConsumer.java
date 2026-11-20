package com.eshop.Ecommerce.extension;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
@Component
public class EventConsumer {
 private final ObjectMapper mapper;private final JdbcTemplate jdbc;private final OpenSearchCatalog search;private final RabbitTemplate rabbit;
 public EventConsumer(ObjectMapper mapper,JdbcTemplate jdbc,OpenSearchCatalog search,RabbitTemplate rabbit){this.mapper=mapper;this.jdbc=jdbc;this.search=search;this.rabbit=rabbit;}
 @KafkaListener(topics="${nothing.events.topic}",groupId="${spring.kafka.consumer.group-id}")
 public void consume(String message)throws Exception{
   var evt=mapper.readTree(message);String id=evt.path("eventId").asText();
   if(id.isBlank())throw new IllegalArgumentException("Missing event ID");
   if(!jdbc.queryForList("select 1 from nothing_consumed where event_id=?::uuid",id).isEmpty())return;
   String type=evt.path("type").asText();long productId=evt.path("productId").asLong();
   if("PRODUCT_CHANGED".equals(type)||"INVENTORY_CHANGED".equals(type))search.index(productId);
   if("PRODUCT_DELETED".equals(type))search.delete(productId);
   if("ORDER_PLACED".equals(type))rabbit.convertAndSend("nothing.notifications","Order "+evt.path("orderId").asLong()+" placed");
   jdbc.update("insert into nothing_consumed(event_id) values (?::uuid) on conflict do nothing",id);
 }
}