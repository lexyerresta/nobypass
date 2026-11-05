<?php

namespace App\Http\Controllers\Admin;

use App\Facades\Users;
use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;

class UserStatsController extends Controller
{
    public function __invoke(): JsonResponse
    {
        // A facade call is a call to the service behind it: allowed.
        return response()->json(['active' => Users::countActive()]);
    }
}
