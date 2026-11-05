<?php

namespace App\Service;

use App\Entity\User;
use Doctrine\ORM\EntityManagerInterface;

class UserService
{
    public function __construct(private readonly EntityManagerInterface $em)
    {
    }

    public function register(string $email): ?User
    {
        try {
            $user = new User($email);
            $this->em->persist($user);
            $this->em->flush();

            return $user;
        } catch (\Throwable $e) {
            return null;
        }
    }
}
