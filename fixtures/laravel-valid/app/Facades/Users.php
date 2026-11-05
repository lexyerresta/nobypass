<?php

namespace App\Facades;

use App\Services\UserService;
use Illuminate\Support\Facades\Facade;

class Users extends Facade
{
    protected static function getFacadeAccessor(): string
    {
        return UserService::class;
    }
}
