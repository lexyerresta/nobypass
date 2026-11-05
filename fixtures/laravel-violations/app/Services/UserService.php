<?php

namespace App\Services;

use App\Repositories\Contracts\UserRepository;
use Illuminate\Support\Facades\DB;

class UserService
{
    public function __construct(private readonly UserRepository $repository)
    {
    }

    public function listActive(): array
    {
        return DB::table('users')->where('active', true)->get()->all();
    }

    public function countActive(): int
    {
        return count($this->listActive());
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
