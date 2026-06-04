<?php
declare(strict_types=1);

define('ROOTPATH', __DIR__ . DIRECTORY_SEPARATOR);
define('APPPATH', ROOTPATH . 'app' . DIRECTORY_SEPARATOR);

require APPPATH . 'Helpers' . DIRECTORY_SEPARATOR . 'functions.php';

spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\';
    if (strpos($class, $prefix) !== 0) {
        return;
    }

    $relative = substr($class, strlen($prefix));
    $file = APPPATH . str_replace('\\', DIRECTORY_SEPARATOR, $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

$routes = require APPPATH . 'Config' . DIRECTORY_SEPARATOR . 'Routes.php';

$app = new App\Core\App($routes);
$app->run();
