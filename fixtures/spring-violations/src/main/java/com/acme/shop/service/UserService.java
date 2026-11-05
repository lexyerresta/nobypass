package com.acme.shop.service;

import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    private final JdbcTemplate jdbc;

    public UserService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Map<String, Object>> activeUsers() {
        try {
            return jdbc.queryForList("SELECT email FROM users WHERE active = true");
        } catch (Exception e) {
            return List.of();
        }
    }
}
