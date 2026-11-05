<?php

namespace App\Repositories;

use App\Models\User;
use App\Repositories\Contracts\UserRepository;
use App\Services\UserService;

class EloquentUserRepository implements UserRepository
{
    public function active(): array
    {
        return User::query()->where('active', true)->get()->all();
    }

    public function create(array $data): array
    {
        return User::create($data)->toArray();
    }

    public function activeViaService(UserService $service): array
    {
        return $service->listActive();
    }
}
