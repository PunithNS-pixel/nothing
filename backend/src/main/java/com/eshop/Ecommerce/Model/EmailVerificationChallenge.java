package com.eshop.Ecommerce.Model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import lombok.NoArgsConstructor;
import java.time.Instant;

/** Transient inbox challenge. Never stores a raw OTP or a raw proof token. */
@Entity
@Table(name="email_verification_challenges")
@Getter @Setter @NoArgsConstructor
public class EmailVerificationChallenge {
 @Id @Column(length=150)
 private String email;
 @Column(length=100) private String codeHash;
 @Column(length=64) private String proofHash;
 private Instant createdAt;
 private Instant expiresAt;
 private Instant proofExpiresAt;
 private int attempts;
}
