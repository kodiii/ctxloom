// Sample Kotlin fixture for Skeletonizer coverage tests.
package com.example.skeleton

import java.io.File

data class User(val id: String, val name: String, val email: String)

class UserService(private val dbPath: String) {
    fun getUser(id: String): String {
        val raw = File(dbPath).readText()
        // BODY_SENTINEL_DO_NOT_LEAK
        return raw
    }

    suspend fun loadUser(id: String): String {
        // BODY_SENTINEL_DO_NOT_LEAK
        return getUser(id)
    }
}

fun formatUser(user: User): String {
    // BODY_SENTINEL_DO_NOT_LEAK
    return "${user.name} <${user.email}>"
}
