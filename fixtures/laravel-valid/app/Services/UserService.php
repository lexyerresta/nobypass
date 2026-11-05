<?php

namespace App\Services;

use App\Repositories\UserRepository;
use App\Services\Exceptions\RegistrationFailed;
use Illuminate\Support\Facades\DB;

class UserService
{
    public function __construct(private readonly UserRepository $repository)
    {
    }

    public function activeUsers(): array
    {
        return $this->repository->active();
    }

    public function register(array $data): array
    {
        return DB::transaction(function () use ($data) {
            try {
                return $this->repository->create($data);
            } catch (\Illuminate\Database\QueryException $e) { // nobypass-allow EXC001: wrap infrastructure error as a domain error
                throw new RegistrationFailed($data['email'], previous: $e);
            }
        });
    }
}
