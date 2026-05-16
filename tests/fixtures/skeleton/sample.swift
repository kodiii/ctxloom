// Sample Swift fixture for Skeletonizer coverage tests.
import Foundation

struct User {
    let id: String
    let name: String
    let email: String
}

protocol UserRepository {
    func getUser(id: String) -> String?
}

class UserService: UserRepository {
    private let dbPath: String

    init(dbPath: String) {
        self.dbPath = dbPath
    }

    func getUser(id: String) -> String? {
        let raw = try? String(contentsOfFile: dbPath)
        // BODY_SENTINEL_DO_NOT_LEAK
        return raw
    }
}

func formatUser(user: User) -> String {
    // BODY_SENTINEL_DO_NOT_LEAK
    return "\(user.name) <\(user.email)>"
}
