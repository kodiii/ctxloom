// Sample C# fixture for Skeletonizer coverage tests.
using System;
using System.IO;

namespace SkeletonSample
{
    public interface IUserRepository
    {
        string GetUser(string id);
    }

    public class UserService : IUserRepository
    {
        private readonly string _dbPath;

        public UserService(string dbPath)
        {
            _dbPath = dbPath;
        }

        public string GetUser(string id)
        {
            var raw = File.ReadAllText(_dbPath);
            // BODY_SENTINEL_DO_NOT_LEAK
            return raw;
        }

        public static string FormatUser(string name, string email)
        {
            // BODY_SENTINEL_DO_NOT_LEAK
            return name + " <" + email + ">";
        }
    }
}
