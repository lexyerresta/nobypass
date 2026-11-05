<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Facades\App\Repositories\EloquentUserRepository;
use Illuminate\Http\JsonResponse;

class UserStatsController extends Controller
{
    public function __invoke(): JsonResponse
    {
        // A real-time facade looks harmless, but it reaches the repository directly.
        return response()->json(['active' => count(EloquentUserRepository::active())]);
    }
}
