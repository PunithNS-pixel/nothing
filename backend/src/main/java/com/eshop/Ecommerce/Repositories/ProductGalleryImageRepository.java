package com.eshop.Ecommerce.Repositories;

import com.eshop.Ecommerce.Model.ProductGalleryImage;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ProductGalleryImageRepository extends JpaRepository<ProductGalleryImage,Long>{
 List<ProductGalleryImage> findAllByOrderByDisplayOrderAsc();
 List<ProductGalleryImage> findByProduct_ProductIdOrderByDisplayOrderAsc(Long productId);
 void deleteByProduct_ProductId(Long productId);
}
