-- Add GST party type and new fields to parties table

-- Add new columns if they don't exist
ALTER TABLE parties 
ADD COLUMN IF NOT EXISTS gst_percentage INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS current_text DECIMAL(10, 2) DEFAULT 0;

-- Update party_type enum to include 'gst'
ALTER TABLE parties 
MODIFY COLUMN party_type ENUM('sundry_debtor', 'sundry_creditor', 'gst') NOT NULL;

-- Make balance_type nullable for GST party type (since GST doesn't need debit/credit classification)
ALTER TABLE parties 
MODIFY COLUMN balance_type ENUM('debit', 'credit') NULL;