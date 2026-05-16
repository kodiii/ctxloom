<?php
// Sample PHP fixture for Skeletonizer coverage tests.
namespace SkeletonSample;

use Exception;

class UserService
{
    private string $dbPath;

    public function __construct(string $dbPath)
    {
        $this->dbPath = $dbPath;
    }

    public function getUser(string $id): ?array
    {
        $raw = file_get_contents($this->dbPath);
        // BODY_SENTINEL_DO_NOT_LEAK
        $data = json_decode($raw, true);
        return $data[$id] ?? null;
    }
}

function formatUser(array $user): string
{
    // BODY_SENTINEL_DO_NOT_LEAK
    return $user['name'] . ' <' . $user['email'] . '>';
}
