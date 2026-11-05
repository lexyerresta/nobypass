<?php

namespace App\Helpers;

class Formatting
{
    public static function money(int $cents): string
    {
        return number_format($cents / 100, 2);
    }
}
