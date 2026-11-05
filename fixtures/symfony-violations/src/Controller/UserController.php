<?php

namespace App\Controller;

use App\Entity\User;
use App\Repository\UserRepository;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

class UserController extends AbstractController
{
    public function __construct(
        private readonly EntityManagerInterface $em,
        private readonly UserRepository $users,
    ) {
    }

    #[Route('/users')]
    public function index(): JsonResponse
    {
        // "Quick fix" from an AI agent: query straight from the controller.
        return $this->json($this->em->getRepository(User::class)->findBy(['active' => true]));
    }
}
