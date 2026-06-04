-- CSL Fingerprint CI4/XAMPP schema
-- Database default: finger_ci4

CREATE DATABASE IF NOT EXISTS finger_ci4
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE finger_ci4;

CREATE TABLE IF NOT EXISTS app_users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE app_users MODIFY COLUMN role ENUM('admin','user') NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS devices (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  serial_number VARCHAR(120) NULL UNIQUE,
  ip_address VARCHAR(80) NULL,
  public_ip VARCHAR(80) NULL,
  tailscale_ip VARCHAR(80) NULL,
  preferred_host ENUM('auto','local','public','tailscale') NOT NULL DEFAULT 'auto',
  port INT UNSIGNED NOT NULL DEFAULT 4370,
  location VARCHAR(150) NULL,
  brand VARCHAR(80) NOT NULL DEFAULT 'ZKTeco Compatible',
  protocol VARCHAR(50) NOT NULL DEFAULT 'zk-tcp',
  timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Jakarta',
  adms_ip VARCHAR(80) NULL,
  adms_domain VARCHAR(180) NULL,
  adms_port INT UNSIGNED NULL,
  adms_url VARCHAR(180) NULL,
  last_detected_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_devices_active (is_active),
  INDEX idx_devices_address (ip_address, port),
  INDEX idx_devices_public (public_ip, port),
  INDEX idx_devices_tailscale (tailscale_ip, port)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS public_ip VARCHAR(80) NULL AFTER ip_address;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS tailscale_ip VARCHAR(80) NULL AFTER public_ip;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS preferred_host ENUM('auto','local','public','tailscale') NOT NULL DEFAULT 'auto' AFTER tailscale_ip;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS adms_ip VARCHAR(80) NULL AFTER protocol;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Jakarta' AFTER protocol;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS adms_domain VARCHAR(180) NULL AFTER adms_ip;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS adms_port INT UNSIGNED NULL AFTER adms_domain;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS adms_url VARCHAR(180) NULL AFTER adms_port;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_detected_at DATETIME NULL AFTER adms_url;
ALTER TABLE devices ADD INDEX IF NOT EXISTS idx_devices_public (public_ip, port);
ALTER TABLE devices ADD INDEX IF NOT EXISTS idx_devices_tailscale (tailscale_ip, port);

CREATE TABLE IF NOT EXISTS device_status (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id INT UNSIGNED NOT NULL,
  is_online TINYINT(1) NOT NULL DEFAULT 0,
  message TEXT NULL,
  checked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_status_device (device_id),
  CONSTRAINT fk_device_status_device
    FOREIGN KEY (device_id) REFERENCES devices(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fingerprint_users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_code VARCHAR(50) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  card_number VARCHAR(100) NULL,
  device_user_id VARCHAR(50) NULL,
  department VARCHAR(120) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_fingerprint_users_name (full_name),
  INDEX idx_fingerprint_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS device_users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id INT UNSIGNED NOT NULL,
  fingerprint_user_id INT UNSIGNED NULL,
  uid VARCHAR(50) NOT NULL,
  employee_code VARCHAR(50) NOT NULL,
  device_user_id VARCHAR(50) NULL,
  full_name VARCHAR(150) NOT NULL,
  card_number VARCHAR(100) NULL,
  privilege VARCHAR(50) NULL,
  password_value VARCHAR(80) NULL,
  fingerprint_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  raw_payload LONGTEXT NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_uid (device_id, uid),
  UNIQUE KEY uq_device_employee (device_id, employee_code),
  INDEX idx_device_users_employee (employee_code),
  CONSTRAINT fk_device_users_device
    FOREIGN KEY (device_id) REFERENCES devices(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_device_users_master
    FOREIGN KEY (fingerprint_user_id) REFERENCES fingerprint_users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE device_users ADD COLUMN IF NOT EXISTS fingerprint_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER password_value;

CREATE TABLE IF NOT EXISTS shifts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shift_code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_minutes INT UNSIGNED NOT NULL DEFAULT 60,
  late_tolerance_minutes INT UNSIGNED NOT NULL DEFAULT 5,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_shifts_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_shift_assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fingerprint_user_id INT UNSIGNED NOT NULL,
  shift_id INT UNSIGNED NOT NULL,
  effective_date DATE NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_shift_effective (fingerprint_user_id, shift_id, effective_date),
  CONSTRAINT fk_user_shift_user
    FOREIGN KEY (fingerprint_user_id) REFERENCES fingerprint_users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_user_shift_shift
    FOREIGN KEY (shift_id) REFERENCES shifts(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id INT UNSIGNED NULL,
  fingerprint_user_id INT UNSIGNED NULL,
  employee_code VARCHAR(50) NOT NULL,
  user_name VARCHAR(150) NULL,
  check_time DATETIME NOT NULL,
  punch_state ENUM('IN','OUT','BREAK_OUT','BREAK_IN','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
  raw_payload LONGTEXT NULL,
  source_key VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_attendance_source (source_key),
  INDEX idx_attendance_time (check_time),
  INDEX idx_attendance_employee_time (employee_code, check_time),
  INDEX idx_attendance_device_time (device_id, check_time),
  CONSTRAINT fk_attendance_device
    FOREIGN KEY (device_id) REFERENCES devices(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_attendance_user
    FOREIGN KEY (fingerprint_user_id) REFERENCES fingerprint_users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS source_key VARCHAR(255) NULL AFTER raw_payload;
ALTER TABLE attendance_logs ADD UNIQUE KEY IF NOT EXISTS uq_attendance_source (source_key);

CREATE TABLE IF NOT EXISTS device_action_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  device_id INT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  is_success TINYINT(1) NOT NULL DEFAULT 0,
  message TEXT NULL,
  payload LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_device_action_logs_device (device_id, created_at),
  CONSTRAINT fk_device_action_logs_device
    FOREIGN KEY (device_id) REFERENCES devices(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS adms_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  serial_number VARCHAR(120) NULL,
  remote_ip VARCHAR(80) NULL,
  request_method VARCHAR(12) NOT NULL,
  request_uri VARCHAR(255) NOT NULL,
  payload LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_adms_sn_date (serial_number, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fingerprint_templates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fingerprint_user_id INT UNSIGNED NOT NULL,
  device_id INT UNSIGNED NULL,
  finger_index TINYINT UNSIGNED NOT NULL DEFAULT 0,
  template_format VARCHAR(50) NULL,
  template_data LONGTEXT NOT NULL,
  template_size INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_template_user_device_finger (fingerprint_user_id, device_id, finger_index),
  CONSTRAINT fk_template_user
    FOREIGN KEY (fingerprint_user_id) REFERENCES fingerprint_users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_template_device
    FOREIGN KEY (device_id) REFERENCES devices(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS backups (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  backup_type VARCHAR(50) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_backups_type_date (backup_type, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_settings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_users (username, password_hash, full_name, role)
VALUES ('admin', '5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5', 'Administrator', 'admin')
ON DUPLICATE KEY UPDATE username = username;

INSERT INTO devices (device_code, name, serial_number, ip_address, tailscale_ip, public_ip, preferred_host, port, location, timezone, adms_ip, adms_domain, adms_port, adms_url)
VALUES ('mesin-1', 'Absen Kantor', 'SN-MESIN-1', '192.168.18.253', '', '', 'auto', 4370, 'Kantor Utama', 'Asia/Jakarta', '143.198.86.118', '', 8000, '/finger/csl/login')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO shifts (shift_code, name, start_time, end_time, break_minutes, late_tolerance_minutes)
VALUES
  ('shift-pagi', 'Shift Pagi', '08:00:00', '17:00:00', 60, 5),
  ('shift-siang', 'Shift Siang', '14:00:00', '22:00:00', 60, 5),
  ('shift-malam', 'Shift Malam', '21:00:00', '04:00:00', 60, 5)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO fingerprint_users (employee_code, full_name, card_number, device_user_id, department)
VALUES ('EMP001', 'Haris Yudha', '', '1', 'Admin')
ON DUPLICATE KEY UPDATE full_name = VALUES(full_name);

INSERT INTO app_settings (setting_key, setting_value)
VALUES
  ('app_name', 'CSL Fingerprint'),
  ('company_name', 'CSL Digital'),
  ('timezone', 'Asia/Jakarta'),
  ('work_start_time', '08:00'),
  ('receipt_footer', 'Data absensi tersimpan lokal di XAMPP.')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);
