-- ============================================================
-- SINGLE DATABASE SCHEMA FOR SAAS (Schema-based Multi-tenancy)
-- Run this entire file ONCE on your Hostinger DB: u272022322_accounts
-- ============================================================

-- Master tables (already exist, keeping them)
CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_name` varchar(255) NOT NULL,
  `company_type` enum('Sales','Production','Services','Retail','Technology','Other') NOT NULL,
  `email` varchar(255) NOT NULL,
  `mobile` varchar(20) NOT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `admins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- tenants table stays the same (db_name column kept for compatibility but unused now)
CREATE TABLE IF NOT EXISTS `tenants` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `db_name` varchar(100) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `tenants_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- TENANT TABLES (all have tenant_id = user_id from users table)
-- ============================================================

CREATE TABLE IF NOT EXISTS `products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `unit` varchar(50) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `stock` int DEFAULT 0,
  `HSN_code` varchar(20) DEFAULT '9988',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_products_tenant` (`tenant_id`),
  CONSTRAINT `products_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `parties` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `mobile` varchar(20),
  `address` text,
  `city` varchar(100),
  `state` varchar(100),
  `gst_status` enum('GST','Non-GST') DEFAULT 'Non-GST',
  `gst_number` varchar(20),
  `gst_percentage` int DEFAULT 0,
  `current_tax` decimal(10,2) DEFAULT 0,
  `creditLimit` decimal(10,2) DEFAULT 0,
  `opening_balance` decimal(10,2) DEFAULT 0,
  `party_type` enum('sundry_debtor','sundry_creditor','gst') NOT NULL,
  `balance_type` enum('debit','credit') NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_parties_tenant` (`tenant_id`),
  CONSTRAINT `parties_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `Banks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `account_number` varchar(50) NOT NULL,
  `IFSC_code` varchar(20) NOT NULL,
  `branch_name` varchar(100) NOT NULL,
  `current_balance` decimal(10,2) DEFAULT 0,
  `opening_balance` decimal(10,2) DEFAULT 0,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_banks_tenant` (`tenant_id`),
  CONSTRAINT `banks_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `cashInHand` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `current_balance` decimal(10,2) DEFAULT 0,
  `opening_balance` decimal(10,2) DEFAULT 0,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cash_tenant` (`tenant_id`),
  CONSTRAINT `cash_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `expenses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `expense_date` date NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `description` text NOT NULL,
  `category` varchar(100) NOT NULL,
  `payment_method` varchar(50) DEFAULT 'Cash',
  `account_id` int NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_expenses_tenant` (`tenant_id`),
  KEY `idx_expenses_account_id` (`account_id`),
  CONSTRAINT `expenses_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `purchases` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `bill_number` varchar(100),
  `party_id` int NOT NULL,
  `date` date NOT NULL,
  `state` varchar(100),
  `subtotal` decimal(10,2) DEFAULT 0,
  `total_items` int DEFAULT 0,
  `gst_percent` decimal(5,2) DEFAULT 0,
  `gst_amount` decimal(10,2) DEFAULT 0,
  `gst_party_id` int NULL,
  `total_amount` decimal(10,2) DEFAULT 0,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_purchases_tenant` (`tenant_id`),
  CONSTRAINT `purchases_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `purchase_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `purchase_id` int NOT NULL,
  `item_id` int NOT NULL,
  `quantity` int DEFAULT 1,
  `price` decimal(10,2) DEFAULT 0,
  `total` decimal(10,2) DEFAULT 0,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_purchase_items_tenant` (`tenant_id`),
  CONSTRAINT `purchase_items_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `purchase_items_purchase_fk` FOREIGN KEY (`purchase_id`) REFERENCES `purchases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `sales` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `bill_number` varchar(100),
  `party_id` int NOT NULL,
  `date` date NOT NULL,
  `subtotal` decimal(10,2) DEFAULT 0,
  `total_items` int DEFAULT 0,
  `gst_percent` decimal(5,2) DEFAULT 0,
  `gst_amount` decimal(10,2) DEFAULT 0,
  `gst_party_id` int NULL,
  `total_amount` decimal(10,2) DEFAULT 0,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sales_tenant` (`tenant_id`),
  CONSTRAINT `sales_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `sale_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `sale_id` int NOT NULL,
  `item_id` int NOT NULL,
  `quantity` int DEFAULT 1,
  `price` decimal(10,2) DEFAULT 0,
  `total` decimal(10,2) DEFAULT 0,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sale_items_tenant` (`tenant_id`),
  CONSTRAINT `sale_items_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `sale_items_sale_fk` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `party_id` int NOT NULL,
  `payment_date` date NOT NULL,
  `payment_type` enum('received','paid') NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `payment_method` varchar(50) NOT NULL,
  `account_id` int NULL,
  `reference_number` varchar(100),
  `notes` text,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payments_tenant` (`tenant_id`),
  KEY `idx_payments_account_id` (`account_id`),
  CONSTRAINT `payments_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `bank_vouchers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `from_account_type` enum('bank','cash') NOT NULL,
  `from_account_id` int NOT NULL,
  `to_account_type` enum('bank','cash') NOT NULL,
  `to_account_id` int NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `transfer_date` date NOT NULL,
  `description` text,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_bank_vouchers_tenant` (`tenant_id`),
  KEY `idx_bank_vouchers_from` (`from_account_type`,`from_account_id`),
  KEY `idx_bank_vouchers_to` (`to_account_type`,`to_account_id`),
  CONSTRAINT `bank_vouchers_tenant_fk` FOREIGN KEY (`tenant_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
