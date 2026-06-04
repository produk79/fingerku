<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\AppData;

final class ShiftController extends BaseController
{
    public function index(): string
    {
        return $this->view('shifts/index', [
            'title' => 'Shift Kerja',
            'active' => 'shifts',
            'shifts' => AppData::shifts($this->db),
            'saved' => request_value('saved', '') === '1',
        ]);
    }

    public function store(): string
    {
        AppData::saveShift($_POST, $this->db);
        return $this->redirect('/shifts?saved=1');
    }

    public function delete(): string
    {
        AppData::deleteShift((string) request_value('shift_code', ''), $this->db);
        return $this->redirect('/shifts');
    }
}
