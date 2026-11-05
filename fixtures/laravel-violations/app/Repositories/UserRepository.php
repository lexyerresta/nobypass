<?php

namespace App\Repositories;

use App\Models\User;
use App\Services\UserService;

class UserRepository
{
    public function create(array $data): array
    {
        return User::create($data)->toArray();
    }

    public function activeViaService(UserService $service): array
    {
        return $service->activeUsers();
    }
}
