package com.eshop.Ecommerce.Security.Services;

import com.eshop.Ecommerce.Model.User;
import com.eshop.Ecommerce.Repositories.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;



@Service
public class UserDetailsServiceImpl implements UserDetailsService {
    @Autowired
    UserRepository userRepository;

    @Override
    @Transactional
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        // Customers can sign in using their email or their established username.
        // This still requires the matching BCrypt password; unknown emails never authenticate.
        User user = userRepository.findByUserName(username)
                .or(() -> userRepository.findByEmailIgnoreCase(username))
                .orElseThrow(() -> new UsernameNotFoundException("Invalid email/username or password"));
        return UserDetailsImpl.build(user);
    }


}