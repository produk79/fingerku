<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\Database;
use App\Core\View;

abstract class BaseController
{
    protected Database $db;

    public function __construct()
    {
        $this->db = new Database();
    }

    /**
     * @param array<string, mixed> $data
     */
    protected function view(string $view, array $data = []): string
    {
        $data['dbConnected'] = $this->db->connected();
        $data['dbError'] = $this->db->error();
        return View::render($view, $data);
    }

    protected function redirect(string $path): string
    {
        header('Location: ' . url_to($path));
        return '';
    }
}
