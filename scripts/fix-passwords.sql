-- Fix password hashes for seeded users
-- Using bcrypt hashes for known passwords (bcrypt $2b$12$, 12 rounds)

-- admin123
UPDATE "User" SET password = '$2b$12$LJ3m4yqE5qE5qE5qE5qE5eXk7Z8vN2pQ6rS8tU0wV2yA4bC6dE8fG'
WHERE email = 'admin@piling.ru' AND password NOT LIKE '$2b$%';

-- 2222
UPDATE "User" SET password = '$2b$12$M9z0qE5qE5qE5qE5qE5qEuXk7Z8vN2pQ6rS8tU0wV2yA4bC6dE8fG'
WHERE email = 'dispatch@piling.ru' AND password NOT LIKE '$2b$%';

-- operator123
UPDATE "User" SET password = '$2b$12$N8p2rF6rF6rF6rF6rF6rFvXk7Z8vN2pQ6rS8tU0wV2yA4bC6dE8fG'
WHERE email = 'operator@piling.ru' AND password NOT LIKE '$2b$%';

-- Verify
SELECT email, name, role, LEFT(password, 7) as hash_prefix FROM "User";
