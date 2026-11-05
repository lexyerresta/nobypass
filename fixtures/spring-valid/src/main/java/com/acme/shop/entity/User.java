package com.acme.shop.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;

@Entity
public class User {
    @Id
    private Long id;
    private String email;
    private boolean active;

    public String getEmail() { return email; }
}
