package com.eshop.Ecommerce.Model;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

@Entity
@Table(name="product_feedback",uniqueConstraints=@UniqueConstraint(
 name="uk_feedback_customer_product",columnNames={"user_id","product_id"}))
public class ProductFeedback {
 @Id @GeneratedValue(strategy=GenerationType.IDENTITY)
 public Long id;
 @ManyToOne(fetch=FetchType.LAZY,optional=false)
 @JoinColumn(name="user_id",nullable=false)
 public User user;
 @ManyToOne(fetch=FetchType.LAZY,optional=false)
 @JoinColumn(name="product_id",nullable=false)
 public Product product;
 @Column(nullable=false)
 public Integer rating;
 @Column(length=1000,nullable=false)
 public String comment;
 @Column(nullable=false)
 public OffsetDateTime updatedAt=OffsetDateTime.now(ZoneOffset.UTC);
}
