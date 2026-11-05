<?php

namespace App\Services\Exceptions;

class RegistrationFailed extends \RuntimeException
{
    public function __construct(string $email, ?\Throwable $previous = null)
    {
        parent::__construct("Could not register {$email}", 0, $previous);
    }
}
