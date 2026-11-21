package com.eshop.Ecommerce.Repositories;

import com.eshop.Ecommerce.Model.ProductFeedback;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ProductFeedbackRepository extends JpaRepository<ProductFeedback,Long>{
 Optional<ProductFeedback> findByUser_UseridAndProduct_ProductId(Long userId,Long productId);
 List<ProductFeedback> findByProduct_ProductIdOrderByUpdatedAtDesc(Long productId);
}
