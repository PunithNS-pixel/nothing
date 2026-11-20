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
  if(products.findAll().stream().anyMatch(p->name.equalsIgnoreCase(p.getProductName())))return;
  Category category=categories.findAll().stream().filter(c->categoryName.equalsIgnoreCase(c.getCategoryName()))
     .findFirst().orElseGet(()->{Category c=new Category();c.setCategoryName(categoryName);return categories.save(c);});
  Product p=new Product();p.setProductName(name);p.setDescription(description);
  p.setQuantity(stock);p.setPrice(price);p.setSpecialPrice(price);p.setDiscount(0);
  p.setCity(city);p.setCategory(category);
  Product stored=products.save(p);events.record("PRODUCT_CHANGED",stored.getProductId(),null);
 }
}