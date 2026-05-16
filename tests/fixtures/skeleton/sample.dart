// Sample Dart fixture for Skeletonizer coverage tests.
import 'dart:convert';
import 'dart:io';

class User {
  final String id;
  final String name;
  final String email;
  User(this.id, this.name, this.email);
}

class UserService {
  final String dbPath;

  UserService(this.dbPath);

  Future<Map<String, dynamic>?> getUser(String id) async {
    final raw = await File(dbPath).readAsString();
    // BODY_SENTINEL_DO_NOT_LEAK
    final data = json.decode(raw) as Map<String, dynamic>;
    return data[id] as Map<String, dynamic>?;
  }
}

String formatUser(User user) {
  // BODY_SENTINEL_DO_NOT_LEAK
  return '${user.name} <${user.email}>';
}
