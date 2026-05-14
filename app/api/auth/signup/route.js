import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import jwt from "jsonwebtoken";
import masterDB from "@/lib/masterDB";

export async function POST(request) {
  try {
    const body = await request.json();
    const { company_name, company_type, email, mobile, password } = body;
    console.log("req reached:", body);

    // 1. Validate fields
    if (!company_name || !company_type || !email || !mobile || !password) {
      return NextResponse.json(
        { message: "All fields are required" },
        { status: 400 }
      );
    }

    // 2. Check if email already exists
    const [existing] = await masterDB.query(
      "SELECT id FROM users WHERE email = ?",
      [email]
    );
    if (existing.length > 0) {
      return NextResponse.json(
        { message: "Email already registered" },
        { status: 409 }
      );
    }
    console.log("store in master DB..");
    // 3. Insert user into master DB
    const [userResult] = await masterDB.query(
      `INSERT INTO users (company_name, company_type, email, mobile, password)
        VALUES (?, ?, ?, ?, ?)`,
      [company_name, company_type, email, mobile, password]
    );
    console.log("stored in master DB..");

    const userId = userResult.insertId;
    const db_name = `tenant_${userId}`;

    console.log("userId:", userId);
    console.log("db_name:", db_name);

    // 4. Create tenant database
    await masterDB.query(`CREATE DATABASE IF NOT EXISTS \`${db_name}\``);

    // 5. Connect to tenant DB and create tables
    const tenantConn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: db_name,
    });

    await tenantConn.query(`
  CREATE TABLE IF NOT EXISTS products (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    unit       VARCHAR(50) NOT NULL,
    price      DECIMAL(10,2) NOT NULL,
    stock      INT DEFAULT 0,
    HSN_code   VARCHAR(20) default '9988',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

    await tenantConn.query(`
  CREATE TABLE IF NOT EXISTS parties (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    mobile          VARCHAR(20),
    address         TEXT,
    city            VARCHAR(100),
    state           VARCHAR(100),
    gst_status      ENUM('GST', 'Non-GST') DEFAULT 'Non-GST',
    gst_number      VARCHAR(20) UNIQUE,
    gst_percentage  INT DEFAULT 0,
    current_tax    DECIMAL(10, 2) DEFAULT 0,
    creditLimit     DECIMAL(10,2) DEFAULT 0,
    opening_balance DECIMAL(10,2) DEFAULT 0,
    party_type      ENUM('sundry_debtor', 'sundry_creditor', 'gst') NOT NULL,
    balance_type    ENUM('debit', 'credit') NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
    await tenantConn.query(`
  CREATE TABLE IF NOT EXISTS Banks (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    account_number   VARCHAR(50) NOT NULL,
    IFSC_code        VARCHAR(20) NOT NULL,
    branch_name          VARCHAR(100) NOT NULL,
    current_balance DECIMAL(10,2) DEFAULT 0,
    opening_balance DECIMAL(10,2) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);
    await tenantConn.query(`
  CREATE TABLE IF NOT EXISTS cashInHand (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    current_balance DECIMAL(10,2) DEFAULT 0,
    opening_balance DECIMAL(10,2) DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`);

    await tenantConn.query(`
  CREATE TABLE IF NOT EXISTS expenses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    expense_date DATE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'Cash',
    account_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_expenses_account_id (account_id)
);
`);

    await tenantConn.query(`
      CREATE TABLE IF NOT EXISTS purchases (
  id INT AUTO_INCREMENT PRIMARY KEY,

  bill_number VARCHAR(100),

  party_id INT NOT NULL,
  date DATE NOT NULL,

  state VARCHAR(100),

  subtotal DECIMAL(10,2) DEFAULT 0,
  total_items INT DEFAULT 0,

  gst_percent DECIMAL(5,2) DEFAULT 0,
  gst_amount DECIMAL(10,2) DEFAULT 0,
  gst_party_id INT NULL,

  total_amount DECIMAL(10,2) DEFAULT 0,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (party_id) REFERENCES parties(id),
  FOREIGN KEY (gst_party_id) REFERENCES parties(id)
)
    `);

    await tenantConn.query(`
      CREATE TABLE IF NOT EXISTS purchase_items (
  id INT AUTO_INCREMENT PRIMARY KEY,

  purchase_id INT NOT NULL,
  item_id INT NOT NULL,

  quantity INT DEFAULT 1,
  price DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES products(id)
)
    `);
    await tenantConn.query(`
      CREATE TABLE IF NOT EXISTS sales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_number VARCHAR(100),
  party_id INT NOT NULL,
  date DATE NOT NULL,
  subtotal DECIMAL(10,2) DEFAULT 0,
  total_items INT DEFAULT 0,
  gst_percent DECIMAL(5,2) DEFAULT 0,
  gst_amount DECIMAL(10,2) DEFAULT 0,
  gst_party_id INT NULL,
  total_amount DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (party_id) REFERENCES parties(id),
  FOREIGN KEY (gst_party_id) REFERENCES parties(id)
)
    `);
    await tenantConn.query(`
     CREATE TABLE IF NOT EXISTS sale_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id INT NOT NULL,
  item_id INT NOT NULL,
  quantity INT DEFAULT 1,
  price DECIMAL(10,2) DEFAULT 0,
  total DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES products(id)
)
    `);
    await tenantConn.query(`
     CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  party_id INT NOT NULL,
  payment_date DATE NOT NULL,
  payment_type ENUM('received', 'paid') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  account_id INT NULL,
  reference_number VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (party_id) REFERENCES parties(id),
  INDEX idx_payments_account_id (account_id)
)
    `);

    await tenantConn.query(`
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
)
    `);

    await tenantConn.end();

    // 6. Save tenant mapping in master DB
    await masterDB.query(
      "INSERT INTO tenants (user_id, db_name) VALUES (?, ?)",
      [userId, db_name]
    );

    return NextResponse.json(
      {
        message: "Account created successfully",
        user: { id: userId, company_name, company_type, email },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
