<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreUserRequest;
use App\Models\User;
use App\Repositories\UserRepository;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;

class UserController extends Controller
{
    public function __construct(
        private readonly UserService $service,
        private readonly UserRepository $repository,
    ) {
    }

    public function index(): JsonResponse
    {
        // "Quick fix" from an AI agent: query straight from the controller.
        $users = User::where('active', true)->orderBy('name')->get();

        return response()->json($users);
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        return response()->json($this->service->register($request->validated()), 201);
    }
}
