<?php

namespace App\Service;

use App\Entity\User;
use App\Repository\UserRepository;

class UserService
{
    public function __construct(private readonly UserRepository $repository)
    {
    }

    public function listActive(): array
    {
        return $this->repository->findActive();
    }

    public function register(string $email): User
    {
        $user = new User($email);
        $this->repository->save($user);

        return $user;
    }
}
