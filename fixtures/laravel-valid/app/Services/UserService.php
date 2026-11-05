<?php

namespace App\Services;

use App\Repositories\Contracts\UserRepository;
use App\Services\Exceptions\RegistrationFailed;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

class UserService
{
    public function __construct(private readonly UserRepository $repository)
    {
    }

    public function listActive(): array
    {
        return $this->repository->active();
    }

    public function countActive(): int
    {
        return count($this->repository->active());
    }

    public function register(array $data): array
    {
        return DB::transaction(function () use ($data) {
            try {
                return $this->repository->create($data);
            } catch (QueryException $e) { // nobypass-allow EXC001: wrap infrastructure error as a domain error
                throw new RegistrationFailed($data['email'], $e);
            }
        });
    }
}
