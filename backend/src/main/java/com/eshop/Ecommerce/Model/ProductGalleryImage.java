package com.eshop.Ecommerce.Model;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Getter @Setter @NoArgsConstructor
@Table(name="product_gallery_images")
public class ProductGalleryImage {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY)
 private Long id;
 @ManyToOne(fetch=FetchType.LAZY,optional=false)
 @JoinColumn(name="product_id",nullable=false)
 private Product product;
 @Column(name="image_url",nullable=false,length=1600)
 private String imageUrl;
 @Column(name="display_order",nullable=false)
 private Integer displayOrder;
 public ProductGalleryImage(Product product,String imageUrl,Integer displayOrder){
  this.product=product;this.imageUrl=imageUrl;this.displayOrder=displayOrder;
 }
}
