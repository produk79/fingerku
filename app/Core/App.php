<?php
declare(strict_types=1);

namespace App\Core;

final class App
{
    /** @var array<string, string> */
    private array $routes;

    /**
     * @param array<string, string> $routes
     */
    public function __construct(array $routes)
    {
        $this->routes = $routes;
    }

    public function run(): void
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $path = $this->requestPath();
        $key = $method . ' ' . $path;

        if (!isset($this->routes[$key])) {
            http_response_code(404);
            echo View::render('errors/404', [
                'title' => 'Halaman Tidak Ditemukan',
                'active' => '',
                'path' => $path,
            ]);
            return;
        }

        [$controller, $action] = explode('@', $this->routes[$key], 2);
        $class = 'App\\Controllers\\' . $controller;

        if (!class_exists($class) || !method_exists($class, $action)) {
            http_response_code(500);
            echo 'Route handler tidak valid.';
            return;
        }

        $instance = new $class();
        echo $instance->{$action}();
    }

    private function requestPath(): string
    {
        $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $base = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? ''), '/\\');

        if ($base && $base !== '/' && strpos($uri, $base) === 0) {
            $uri = substr($uri, strlen($base));
        }

        $path = '/' . trim($uri, '/');
        return $path === '/' ? '/' : rtrim($path, '/');
    }
}
