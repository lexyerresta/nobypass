<?php

namespace App\Repositories\Contracts;

interface UserRepository
{
    public function active(): array;

    public function create(array $data): array;
}
