package com.acme.shop.service;

import com.acme.shop.dto.UserDto;
import com.acme.shop.repository.UserRepository;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    private final UserRepository users;

    public UserService(UserRepository users) {
        this.users = users;
    }

    public List<UserDto> activeUsers() {
        return users.findByActiveTrue().stream().map(u -> new UserDto(u.getEmail())).toList();
    }
}
