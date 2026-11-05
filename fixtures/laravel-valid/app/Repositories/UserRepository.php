<?php

namespace App\Repositories;

use App\Models\User;
use Illuminate\Support\Facades\DB;

class UserRepository
{
    public function active(): array
    {
        return User::query()->where('active', true)->orderBy('name')->get()->all();
    }

    public function create(array $data): array
    {
        $user = User::create($data);
        DB::table('audit_log')->insert(['event' => 'user.created', 'subject_id' => $user->id]);

        return $user->toArray();
    }
}
