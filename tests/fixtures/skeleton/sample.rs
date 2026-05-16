// Sample Rust fixture for Skeletonizer coverage tests.
use std::fs;
use std::io;

pub struct User {
    pub id: String,
    pub name: String,
    pub email: String,
}

pub struct UserService {
    db_path: String,
}

impl UserService {
    pub fn new(db_path: String) -> Self {
        UserService { db_path }
    }

    pub fn get_user(&self, _id: &str) -> io::Result<String> {
        let raw = fs::read_to_string(&self.db_path)?;
        // BODY_SENTINEL_DO_NOT_LEAK
        Ok(raw)
    }
}

pub fn format_user(user: &User) -> String {
    // BODY_SENTINEL_DO_NOT_LEAK
    format!("{} <{}>", user.name, user.email)
}
