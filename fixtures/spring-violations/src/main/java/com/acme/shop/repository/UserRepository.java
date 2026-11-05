package com.acme.shop.repository;

import com.acme.shop.entity.User;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, Long> {
    List<User> findByActiveTrue();
}
