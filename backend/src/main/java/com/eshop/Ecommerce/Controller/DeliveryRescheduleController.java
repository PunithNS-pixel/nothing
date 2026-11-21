package com.eshop.Ecommerce.Controller;

import com.eshop.Ecommerce.Model.Order;
import com.eshop.Ecommerce.Model.OrderTrackingEvent;
import com.eshop.Ecommerce.Repositories.OrderRepo;
import com.eshop.Ecommerce.Repositories.OrderTrackingEventRepository;
import com.eshop.Ecommerce.Util.AuthUtil;
import com.eshop.Ecommerce.extension.OrderTrackingStage;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Future;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.time.LocalDate;
import java.util.Map;

@RestController
@RequestMapping("/api/customer/orders")
public class DeliveryRescheduleController {
 private final OrderRepo orders;
 private final OrderTrackingEventRepository events;
 private final AuthUtil auth;
 public DeliveryRescheduleController(OrderRepo orders,OrderTrackingEventRepository events,AuthUtil auth){
  this.orders=orders;this.events=events;this.auth=auth;
 }
 public record Request(@NotNull @Future LocalDate preferredDate) {}
 @PatchMapping("/{id}/delivery-date")
 @Transactional
 public Map<String,Object> reschedule(@PathVariable Long id,@Valid @RequestBody Request request){
  Order order=orders.findByIdForTrackingUpdate(id).orElseThrow(
   ()->new ResponseStatusException(HttpStatus.NOT_FOUND,"Order not found"));
  if(!order.getEmail().equalsIgnoreCase(auth.loggedInEmail()))
   throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Order not found");
  OrderTrackingStage stage=OrderTrackingStage.parse(order.getOrderStatus());
  if(stage!=OrderTrackingStage.PLACED && stage!=OrderTrackingStage.CONFIRMED && stage!=OrderTrackingStage.PACKED)
   throw new ResponseStatusException(HttpStatus.CONFLICT,"Delivery date cannot change after shipping");
  LocalDate preferred=request.preferredDate();
  if(preferred.isAfter(LocalDate.now().plusDays(30)))
   throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Choose a date within 30 days");
  order.setEstimatedDeliveryDate(preferred);
  orders.save(order);
  OrderTrackingEvent event=new OrderTrackingEvent();
  event.setOrder(order);
  event.setStage(stage);
  event.setUpdatedBy("CUSTOMER");
  event.setNote("Customer requested delivery on "+preferred);
  events.save(event);
  return Map.of("orderId",id,"requestedDate",preferred.toString(),
   "status","REQUESTED","message","Preferred date saved; retailer must confirm availability");
 }
}
