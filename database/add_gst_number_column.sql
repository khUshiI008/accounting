-- Add gst_number column to parties table in all tenant databases
-- Run this for each tenant database

ALTER TABLE parties 
ADD COLUMN gst_number VARCHAR(15) NULL AFTER gst_status;

-- Verify the column was added
DESCRIBE parties;
