<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreUserRequest;
use App\Services\UserService;
use Illuminate\Http\JsonResponse;

class UserController extends Controller
{
    public function __construct(private readonly UserService $users)
    {
    }

    public function index(): JsonResponse
    {
        return response()->json($this->users->listActive());
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        return response()->json($this->users->register($request->validated()), 201);
    }
}
