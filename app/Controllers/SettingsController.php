<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\AppData;

final class SettingsController extends BaseController
{
    public function index(): string
    {
        return $this->view('settings/index', [
            'title' => 'Pengaturan',
            'active' => 'settings',
            'settings' => AppData::settings($this->db),
            'timezones' => AppData::timezoneOptions(),
            'saved' => request_value('saved', '') === '1',
        ]);
    }

    public function save(): string
    {
        AppData::saveSettings($_POST, $this->db);
        return $this->redirect('/settings?saved=1');
    }
}
