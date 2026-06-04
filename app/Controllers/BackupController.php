<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\AppData;

final class BackupController extends BaseController
{
    public function index(): string
    {
        return $this->view('backup/index', [
            'title' => 'Backup Database',
            'active' => 'backup',
            'files' => AppData::backupFiles(),
            'created' => (string) request_value('created', ''),
        ]);
    }

    public function database(): string
    {
        $filename = AppData::createSchemaBackup();
        return $this->redirect('/backup?created=' . rawurlencode($filename));
    }
}
