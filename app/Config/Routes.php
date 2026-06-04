<?php
declare(strict_types=1);

return [
    'GET /' => 'DashboardController@index',

    'GET /devices' => 'DeviceController@index',
    'GET /devices/edit' => 'DeviceController@edit',
    'POST /devices/store' => 'DeviceController@store',
    'POST /devices/delete' => 'DeviceController@delete',
    'GET /devices/detect' => 'DeviceController@detect',
    'POST /devices/detect' => 'DeviceController@detectPost',
    'POST /devices/ping-terminal' => 'DeviceController@pingTerminal',
    'POST /devices/register-detected' => 'DeviceController@registerDetected',
    'POST /devices/ping' => 'DeviceController@ping',
    'POST /devices/read-users' => 'DeviceController@readUsers',
    'GET /devices/users' => 'DeviceController@users',
    'POST /devices/delete-user' => 'DeviceController@deleteDeviceUser',
    'POST /devices/copy-users' => 'DeviceController@copyUsers',
    'POST /devices/enroll-finger' => 'DeviceController@enrollFinger',
    'POST /devices/cancel-capture' => 'DeviceController@cancelCapture',
    'POST /devices/reboot' => 'DeviceController@reboot',
    'POST /devices/read-adms' => 'DeviceController@readAdms',
    'POST /devices/set-adms' => 'DeviceController@setAdms',
    'POST /devices/set-time' => 'DeviceController@setTime',
    'POST /devices/set-timezone' => 'DeviceController@setTimezone',

    'GET /users' => 'UserController@index',
    'POST /users/store' => 'UserController@store',
    'POST /users/delete' => 'UserController@delete',

    'GET /attendance' => 'AttendanceController@index',
    'POST /attendance/store' => 'AttendanceController@store',
    'POST /attendance/pull' => 'AttendanceController@pullDevice',
    'POST /attendance/pull-all' => 'AttendanceController@pullAll',
    'POST /attendance/realtime-pull' => 'AttendanceController@realtimePull',
    'GET /attendance/report' => 'AttendanceController@report',

    'GET /shifts' => 'ShiftController@index',
    'POST /shifts/store' => 'ShiftController@store',
    'POST /shifts/delete' => 'ShiftController@delete',

    'GET /backup' => 'BackupController@index',
    'POST /backup/database' => 'BackupController@database',

    'GET /settings' => 'SettingsController@index',
    'POST /settings' => 'SettingsController@save',

    'GET /database-schema' => 'DatabaseController@schema',
    'GET /csl/login' => 'AdmsController@login',
    'POST /csl/login' => 'AdmsController@login',
];
