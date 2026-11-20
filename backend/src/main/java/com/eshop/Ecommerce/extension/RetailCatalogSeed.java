package com.eshop.Ecommerce.extension;
import com.eshop.Ecommerce.Model.Category;
import com.eshop.Ecommerce.Model.Product;
import com.eshop.Ecommerce.Repositories.CategoryRepo;
import com.eshop.Ecommerce.Repositories.ProductRepo;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
@Component
public class RetailCatalogSeed {
 private final CategoryRepo categories;
 private final ProductRepo products;
 private final DomainEvents events;
 @Value("${SEED_RETAIL_CATALOG:false}") private boolean enabled;
 public RetailCatalogSeed(CategoryRepo categories,ProductRepo products,DomainEvents events){
   this.categories=categories;this.products=products;this.events=events;
 }
 @Transactional @EventListener(ApplicationReadyEvent.class)
 public void seed(){
  if(!enabled)return;
  add("Electronics","Bluetooth Wireless Earbuds",1999,"Noise-isolating true wireless earbuds with charging case", "Bengaluru",40);
  add("Electronics","Portable Bluetooth Speaker",2499,"Rechargeable portable speaker for music on the go","Mumbai",35);
  add("Electronics","USB-C Fast Charger 45W",899,"Compact fast charging adapter compatible with USB-C devices","Delhi",75);
  add("Electronics","Smart Fitness Watch",3299,"Smartwatch with fitness tracking and colorful display","Hyderabad",45);
  add("Home & Living","Stainless Steel Water Bottle",599,"Insulated reusable stainless steel bottle for everyday use","Bengaluru",90);
  add("Home & Living","Premium Cotton Bedsheet",1299,"Soft breathable cotton bedsheet for a comfortable bedroom","Mumbai",32);
  add("Home & Living","LED Desk Lamp",1099,"Adjustable energy-saving reading and study desk lamp","Pune",54);
  add("Fashion","Everyday Canvas Backpack",1499,"Durable lightweight backpack with laptop compartment","Delhi",65);
  add("Fashion","Classic Cotton T-Shirt",499,"Comfortable regular-fit cotton t-shirt for daily wear","Bengaluru",120);
  add("Fashion","Urban Running Shoes",2199,"Lightweight breathable sports shoes with cushioned sole","Hyderabad",34);
  add("Grocery","Premium Basmati Rice 1kg",189,"Long-grain aromatic premium basmati rice one kilogram","Mumbai",150);
  add("Grocery","Organic Almonds 500g",449,"Crunchy whole almonds packed in a sealed reusable pouch","Delhi",80);
  add("Beauty","Daily Sunscreen SPF 50",399,"Lightweight broad-spectrum sunscreen for everyday protection","Pune",100);
  add("Beauty","Hydrating Face Wash",299,"Gentle facial cleanser with moisturizing ingredients","Bengaluru",110);
 }
 private void add(String categoryName,String name,double price,String description,String city,int stock){
  java.util.Optional<Product> existing=products.findAll().stream()
     .filter(p->name.equalsIgnoreCase(p.getProductName())).findFirst();
  if(existing.isPresent()){
    Product current=existing.get();
    if(current.getImage()==null||current.getImage().isBlank()){
      current.setImage(imageFor(name));products.save(current);
      events.record("PRODUCT_CHANGED",current.getProductId(),null);
    }
    return;
  }
  Category category=categories.findAll().stream().filter(c->categoryName.equalsIgnoreCase(c.getCategoryName()))
     .findFirst().orElseGet(()->{Category c=new Category();c.setCategoryName(categoryName);return categories.save(c);});
  Product p=new Product();p.setProductName(name);p.setDescription(description);
  p.setQuantity(stock);p.setPrice(price);p.setSpecialPrice(price);p.setDiscount(0);
  p.setCity(city);p.setCategory(category);p.setImage(imageFor(name));
  Product stored=products.save(p);events.record("PRODUCT_CHANGED",stored.getProductId(),null);
 }
 private String imageFor(String name){
   return switch(name){
     case "Bluetooth Wireless Earbuds" -> "https://images.unsplash.com/photo-1754142654807-1dfcdc3f7f22?auto=format&fit=crop&w=800&q=82";
     case "Portable Bluetooth Speaker" -> "https://images.unsplash.com/photo-1732229033839-c76b4071c449?auto=format&fit=crop&w=800&q=82";
     case "USB-C Fast Charger 45W" -> "https://images.unsplash.com/photo-1725304382197-663ae3864750?auto=format&fit=crop&w=800&q=82";
     case "Smart Fitness Watch" -> "https://images.unsplash.com/photo-1638450566735-ead9df13ef3f?auto=format&fit=crop&w=800&q=82";
     case "Stainless Steel Water Bottle" -> "https://images.unsplash.com/photo-1700506844206-ec2f9e2a65cd?auto=format&fit=crop&w=800&q=82";
     case "Premium Cotton Bedsheet" -> "https://images.unsplash.com/photo-1515510621228-30de609bbd60?auto=format&fit=crop&w=800&q=82";
     case "LED Desk Lamp" -> "https://images.unsplash.com/photo-1731762524352-b5663f83a830?auto=format&fit=crop&w=800&q=82";
     case "Everyday Canvas Backpack" -> "https://images.unsplash.com/photo-1711649116396-54e1ba20e828?auto=format&fit=crop&w=800&q=82";
     case "Classic Cotton T-Shirt" -> "https://images.unsplash.com/photo-1651761179569-4ba2aa054997?auto=format&fit=crop&w=800&q=82";
     case "Urban Running Shoes" -> "https://images.unsplash.com/photo-1719523677291-a395426c1a87?auto=format&fit=crop&w=800&q=82";
     case "Premium Basmati Rice 1kg" -> "https://images.unsplash.com/photo-1568347355280-d33fdf77d42a?auto=format&fit=crop&w=800&q=82";
     case "Organic Almonds 500g" -> "https://images.unsplash.com/photo-1788632204503-c8fb6b5a2498?auto=format&fit=crop&w=800&q=82";
     case "Daily Sunscreen SPF 50" -> "https://images.unsplash.com/photo-1738721796968-bc0c4a55960d?auto=format&fit=crop&w=800&q=82";
     case "Hydrating Face Wash" -> "https://images.unsplash.com/photo-1732861612232-50cbe19c1ae5?auto=format&fit=crop&w=800&q=82";
     default -> null;
   };
 }
}