package com.eshop.Ecommerce.Repositories;

import com.eshop.Ecommerce.Model.WishlistItem;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.*;

public interface WishlistRepository extends JpaRepository<WishlistItem,Long> {
 List<WishlistItem> findByUser_UseridOrderByIdDesc(Long userId);
 Optional<WishlistItem> findByUser_UseridAndProduct_ProductId(Long userId,Long productId);
}
