-- Migration: Create bank_vouchers table for account transfers
-- This table tracks money transfers between bank and cash accounts

CREATE TABLE IF NOT EXISTS bank_vouchers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  from_account_type ENUM('bank', 'cash') NOT NULL,
  from_account_id INT NOT NULL,
  to_account_type ENUM('bank', 'cash') NOT NULL,
  to_account_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  transfer_date DATE NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bank_vouchers_from (from_account_type, from_account_id),
  INDEX idx_bank_vouchers_to (to_account_type, to_account_id),
  INDEX idx_bank_vouchers_date (transfer_date)
);

-- Note: This table allows transfers between:
-- 1. Bank to Bank accounts
-- 2. Cash to Cash accounts  
-- 3. Bank to Cash accounts
-- 4. Cash to Bank accounts