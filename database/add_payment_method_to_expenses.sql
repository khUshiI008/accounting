-- Migration: Add payment method and account tracking to expenses table
-- This allows tracking which account was used to pay expenses

ALTER TABLE expenses 
ADD COLUMN payment_method VARCHAR(50) DEFAULT 'Cash' AFTER category,
ADD COLUMN account_id INT NULL AFTER payment_method,
ADD INDEX idx_expenses_account_id (account_id);

-- Note: We don't add foreign key constraints because account_id can reference
-- either Banks table or cashInHand table depending on payment_method