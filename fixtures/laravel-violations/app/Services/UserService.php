<?php

namespace App\Services;

use App\Repositories\UserRepository;
use Illuminate\Support\Facades\DB;

class UserService
{
    public function __construct(private readonly UserRepository $repository)
    {
    }

    public function activeUsers(): array
    {
        return DB::table('users')->where('active', true)->get()->all();
    }

    public function register(array $data): array
    {
        try {
            return $this->repository->create($data);
        } catch (\Throwable $e) {
            return [];
        }
    }
}
