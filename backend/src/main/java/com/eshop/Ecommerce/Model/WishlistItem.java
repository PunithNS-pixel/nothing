package com.eshop.Ecommerce.Model;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name="wishlist_items",
 uniqueConstraints=@UniqueConstraint(name="uk_wishlist_user_product",columnNames={"user_id","product_id"}))
public class WishlistItem {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY)
 private Long id;
 @ManyToOne(fetch=FetchType.LAZY,optional=false)
 @JoinColumn(name="user_id",nullable=false)
 private User user;
 @ManyToOne(fetch=FetchType.LAZY,optional=false)
 @JoinColumn(name="product_id",nullable=false)
 private Product product;
 @Column(nullable=false)
 private Instant addedAt=Instant.now();
 public WishlistItem(){}
 public WishlistItem(User user,Product product){this.user=user;this.product=product;}
 public Long getId(){return id;}
 public User getUser(){return user;}
 public Product getProduct(){return product;}
 public Instant getAddedAt(){return addedAt;}
}
