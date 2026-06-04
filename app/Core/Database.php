<?php
declare(strict_types=1);

namespace App\Core;

use PDO;
use Throwable;

final class Database
{
    private ?PDO $pdo = null;
    private ?string $error = null;

    public function __construct()
    {
        $host = getenv('DB_HOST') ?: '127.0.0.1';
        $name = getenv('DB_DATABASE') ?: 'finger_ci4';
        $user = getenv('DB_USERNAME') ?: 'root';
        $pass = getenv('DB_PASSWORD') ?: '';

        try {
            $this->pdo = new PDO(
                "mysql:host={$host};dbname={$name};charset=utf8mb4",
                $user,
                $pass,
                [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                ]
            );
        } catch (Throwable $e) {
            $this->error = $e->getMessage();
            $this->pdo = null;
        }
    }

    public function connected(): bool
    {
        return $this->pdo instanceof PDO;
    }

    public function error(): ?string
    {
        return $this->error;
    }

    /**
     * @param array<string, mixed> $params
     * @return array<int, array<string, mixed>>
     */
    public function all(string $sql, array $params = []): array
    {
        if (!$this->pdo) {
            return [];
        }

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /**
     * @param array<string, mixed> $params
     */
    public function execute(string $sql, array $params = []): bool
    {
        if (!$this->pdo) {
            return false;
        }

        $stmt = $this->pdo->prepare($sql);
        return $stmt->execute($params);
    }

    public function lastInsertId(): string
    {
        return $this->pdo ? $this->pdo->lastInsertId() : '';
    }

    public function begin(): bool
    {
        return $this->pdo ? $this->pdo->beginTransaction() : false;
    }

    public function commit(): bool
    {
        return $this->pdo ? $this->pdo->commit() : false;
    }

    public function rollBack(): bool
    {
        return $this->pdo && $this->pdo->inTransaction() ? $this->pdo->rollBack() : false;
    }
}
