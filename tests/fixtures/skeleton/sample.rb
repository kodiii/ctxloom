# Sample Ruby fixture for Skeletonizer coverage tests.
require 'json'

class UserService
  def initialize(db_path)
    @db_path = db_path
  end

  def get_user(id)
    raw = File.read(@db_path)
    # BODY_SENTINEL_DO_NOT_LEAK
    JSON.parse(raw)[id]
  end
end

def format_user(user)
  # BODY_SENTINEL_DO_NOT_LEAK
  "#{user['name']} <#{user['email']}>"
end
