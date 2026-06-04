<?php
declare(strict_types=1);

namespace App\Controllers;

final class DatabaseController extends BaseController
{
    public function schema(): string
    {
        $file = ROOTPATH . 'database' . DIRECTORY_SEPARATOR . 'ci4_schema.sql';
        if (!is_file($file)) {
            http_response_code(404);
            return 'Schema database belum tersedia.';
        }

        header('Content-Type: text/plain; charset=utf-8');
        return (string) file_get_contents($file);
    }
}
