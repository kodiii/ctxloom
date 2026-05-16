// Sample Go fixture for Skeletonizer coverage tests.
package sample

import (
	"encoding/json"
	"os"
)

type User struct {
	ID    string
	Name  string
	Email string
}

type UserService struct {
	dbPath string
}

func NewUserService(dbPath string) *UserService {
	return &UserService{dbPath: dbPath}
}

func (s *UserService) GetUser(id string) (*User, error) {
	data, err := os.ReadFile(s.dbPath)
	if err != nil {
		return nil, err
	}
	// BODY_SENTINEL_DO_NOT_LEAK
	var u User
	if err := json.Unmarshal(data, &u); err != nil {
		return nil, err
	}
	return &u, nil
}

func FormatUser(u *User) string {
	// BODY_SENTINEL_DO_NOT_LEAK
	return u.Name + " <" + u.Email + ">"
}
