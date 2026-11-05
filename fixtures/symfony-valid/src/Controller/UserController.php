<?php

namespace App\Controller;

use App\Service\UserService;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\Routing\Attribute\Route;

class UserController extends AbstractController
{
    public function __construct(private readonly UserService $users)
    {
    }

    #[Route('/users')]
    public function index(): JsonResponse
    {
        return $this->json($this->users->listActive());
    }
}
