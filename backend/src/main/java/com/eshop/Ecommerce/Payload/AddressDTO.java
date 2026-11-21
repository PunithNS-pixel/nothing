package com.eshop.Ecommerce.Payload;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class AddressDTO {
    private Long addressId;
    private String street;
    private String buildingName;
    private String city;
    private String state;
    private String country;
    private String pincode;
    @jakarta.validation.constraints.Size(max=80)
    private String recipientName;
    @jakarta.validation.constraints.Pattern(regexp="^$|\\+?[0-9]{10,15}$",message="Enter a valid 10-15 digit delivery phone number")
    private String phoneNumber;
    @jakarta.validation.constraints.Size(max=120)
    private String landmark;
    @jakarta.validation.constraints.Size(max=24)
    private String addressLabel;
}