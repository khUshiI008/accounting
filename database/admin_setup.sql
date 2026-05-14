-- ============================================
-- Admin Table Setup for SaaS Application
-- ============================================
-- Run this in your MASTER database (not tenant databases)

-- Create admins table
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default admin
-- ⚠️ IMPORTANT: Change this password after first login!
INSERT INTO admins (email, password) 
VALUES ('admin@company.com', 'admin123')
ON DUPLICATE KEY UPDATE email = email;

-- ============================================
-- Verify the table was created
-- ============================================
SELECT * FROM admins;

-- ============================================
-- Additional Admin Management Queries
-- ============================================

-- Add a new admin
-- INSERT INTO admins (email, password) 
-- VALUES ('admin@example.com', 'secure_password');

-- Update admin password
-- UPDATE admins SET password = 'new_password' WHERE email = 'admin@company.com';

-- Delete an admin
-- DELETE FROM admins WHERE email = 'admin@example.com';

-- View all admins
-- SELECT * FROM admins;
