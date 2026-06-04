<?php
declare(strict_types=1);

namespace App\Core;

final class View
{
    /**
     * @param array<string, mixed> $data
     */
    public static function render(string $view, array $data = [], string $layout = 'layout'): string
    {
        $viewFile = APPPATH . 'Views' . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $view) . '.php';
        if (!is_file($viewFile)) {
            return 'View tidak ditemukan: ' . e($view);
        }

        extract($data, EXTR_SKIP);

        ob_start();
        require $viewFile;
        $content = ob_get_clean();

        if ($layout === '') {
            return (string) $content;
        }

        $layoutFile = APPPATH . 'Views' . DIRECTORY_SEPARATOR . $layout . '.php';
        if (!is_file($layoutFile)) {
            return (string) $content;
        }

        ob_start();
        require $layoutFile;
        return (string) ob_get_clean();
    }
}
