package com.eshop.Ecommerce.extension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.util.UUID;
@Component
public class OutboxPublisher {
 private final JdbcTemplate jdbc; private final KafkaTemplate<String,String> kafka;
 public OutboxPublisher(JdbcTemplate jdbc,KafkaTemplate<String,String> kafka){this.jdbc=jdbc;this.kafka=kafka;}
 @Scheduled(fixedDelayString="${OUTBOX_POLL_MS:2000}")
 public void publish(){
  var rows=jdbc.queryForList("select id,topic,event_key,payload::text as payload from nothing_outbox where published_at is null and (claimed_at is null or claimed_at < now()-interval '2 minutes') order by created_at limit 40");
  for(var row:rows){
   UUID id=(UUID)row.get("id");
   if(jdbc.update("update nothing_outbox set claimed_at=now() where id=? and published_at is null and (claimed_at is null or claimed_at < now()-interval '2 minutes')",id)!=1)continue;
   try{
     kafka.send((String)row.get("topic"),(String)row.get("event_key"),(String)row.get("payload")).get();
     jdbc.update("update nothing_outbox set published_at=now() where id=?",id);
   }catch(Exception ex){
     jdbc.update("update nothing_outbox set claimed_at=null where id=?",id);
     org.slf4j.LoggerFactory.getLogger(getClass()).warn("Kafka outbox delivery failed",ex);
     break;
   }
  }
 }
}