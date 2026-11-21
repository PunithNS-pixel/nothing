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
    @jakarta.validation.constraints.Pattern(regexp="[6-9][0-9]{9}", message="Use a valid ten-digit Indian mobile number")
    private String phoneNumber;

    // Preserve older callers using the original seven-argument DTO constructor.
    public AddressDTO(Long addressId,String street,String buildingName,String city,String state,String country,String pincode){
        this(addressId,street,buildingName,city,state,country,pincode,null);
    }
}