<?php
declare(strict_types=1);

namespace App\Controllers;

use App\Core\AppData;

final class DashboardController extends BaseController
{
    public function index(): string
    {
        return $this->view('dashboard', [
            'title' => 'Dashboard',
            'active' => 'dashboard',
            'settings' => AppData::settings($this->db),
            'stats' => AppData::dashboardStats($this->db),
            'devices' => array_slice(AppData::devices($this->db), 0, 5),
            'users' => AppData::fingerprintUsers($this->db),
            'recentAttendance' => array_slice(AppData::attendanceRows($this->db, 20), 0, 8),
        ]);
    }
}
