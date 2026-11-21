package com.eshop.Ecommerce.Security.Request;

import java.util.Set;

import jakarta.validation.constraints.*;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class SignupRequest {
    @NotBlank
    @Size(min = 3, max = 20)
    private String username;

    @NotBlank
    @Size(max = 50)
    @Email
    private String email;

    private Set<String> role;

    @NotBlank
    @Size(min = 10, max = 40)
    @Pattern(regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{10,40}$",
             message = "Password must have at least 10 characters, uppercase and lowercase letters and a number")
    private String password;

    // One-time proof from /api/auth/email/confirm when email verification is enabled.
    private String emailVerificationToken;

}