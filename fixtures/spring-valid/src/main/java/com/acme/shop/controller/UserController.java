package com.acme.shop.controller;

import com.acme.shop.dto.UserDto;
import com.acme.shop.service.UserService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserController {
    private final UserService users;

    public UserController(UserService users) {
        this.users = users;
    }

    @GetMapping("/users")
    public List<UserDto> list() {
        return users.activeUsers();
    }
}
