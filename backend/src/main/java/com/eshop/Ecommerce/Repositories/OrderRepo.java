package com.eshop.Ecommerce.Repositories;

import com.eshop.Ecommerce.Model.Order;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface OrderRepo extends JpaRepository<Order, Long> {
    java.util.List<Order> findByEmailIgnoreCaseOrderByOrderDateDesc(String email);
    java.util.Optional<Order> findByCheckoutToken(String checkoutToken);
    @Query("SELECT COALESCE(SUM (o.totalAmount),0) FROM Order o")
    Double getTotalRevenue();
}
