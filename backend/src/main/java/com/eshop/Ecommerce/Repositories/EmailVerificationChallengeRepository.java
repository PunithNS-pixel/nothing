package com.eshop.Ecommerce.Repositories;

import com.eshop.Ecommerce.Model.EmailVerificationChallenge;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EmailVerificationChallengeRepository extends JpaRepository<EmailVerificationChallenge,String> {}
