package com.acme.shop.controller;

import com.acme.shop.entity.User;
import com.acme.shop.repository.UserRepository;
import jakarta.persistence.EntityManager;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserController {
    private final UserRepository users;
    private final EntityManager em;

    public UserController(UserRepository users, EntityManager em) {
        this.users = users;
        this.em = em;
    }

    @GetMapping("/users")
    public List<User> list() {
        // "Quick fix" from an AI agent: query straight from the controller.
        return em.createQuery("select u from User u where u.active = true", User.class).getResultList();
    }
}
