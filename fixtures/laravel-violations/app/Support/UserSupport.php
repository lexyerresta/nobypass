<?php

namespace App\Support;

use App\Services\UserService;

class UserSupport
{
    public function __construct(private readonly UserService $service)
    {
    }

    public function listActive(): array
    {
        return $this->service->activeUsers();
    }

    public function register(array $data): array
    {
        return $this->service->register($data);
    }
}
