// Sample Java fixture for Skeletonizer coverage tests.
package com.example.skeleton;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

public class UserService {
    private final String dbPath;

    public UserService(String dbPath) {
        this.dbPath = dbPath;
    }

    public Optional<String> getUser(String id) throws Exception {
        String raw = new String(Files.readAllBytes(Path.of(dbPath)));
        // BODY_SENTINEL_DO_NOT_LEAK
        return Optional.of(raw);
    }

    public static String formatUser(String name, String email) {
        // BODY_SENTINEL_DO_NOT_LEAK
        return name + " <" + email + ">";
    }
}
